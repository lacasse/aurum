import {
  createHmac,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "crypto";

const SESSION_COOKIE = "aurum_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Read a required env var, failing loudly instead of defaulting. */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Set it in .env before starting Aurum.`,
    );
  }
  return value;
}

function getSecret(): string {
  return requireEnv("AUTH_SECRET");
}

export interface AuthCredentials {
  username: string;
  passwordHash?: string;
  passwordPlain?: string;
}

/**
 * Resolve credentials from env. Prefers a hashed password (AUTH_PASSWORD_HASH).
 * Falls back to plaintext AUTH_PASSWORD compared in constant time. Missing both
 * throws so the app refuses to run rather than shipping with a weak default.
 */
function getCredentials(): AuthCredentials {
  const username = requireEnv("AUTH_USERNAME");
  const passwordHash = process.env.AUTH_PASSWORD_HASH;
  const passwordPlain = process.env.AUTH_PASSWORD;
  if (!passwordHash && !passwordPlain) {
    throw new Error(
      "Missing AUTH_PASSWORD_HASH or AUTH_PASSWORD in .env. Refusing to start without a password.",
    );
  }
  return { username, passwordHash, passwordPlain };
}

/**
 * Constant-time comparison that does not leak the input length (hashes both
 * sides to a fixed size before comparing).
 */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Derive a signing key from the current credentials so that rotating the
 * password (or secret) invalidates every already-issued session cookie.
 */
/*
 * The secret alone signs sessions now.
 *
 * It used to be the secret mixed with the one user's password hash, which gave
 * a useful property for free: changing the password invalidated the session.
 * With several users that key would have to be looked up per request, and the
 * route guard that checks every page cannot reach the database. So the token
 * names its user and is signed with the secret, and signing everybody out is
 * done by changing AUTH_SECRET.
 */
function signingKey(): string {
  return getSecret();
}

function sign(value: string): string {
  return createHmac("sha256", signingKey()).update(value).digest("base64url");
}

/** Hash a password for storage in AUTH_PASSWORD_HASH (format: salt:hash hex). */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

function verifyScrypt(stored: string, password: string): boolean {
  const idx = stored.indexOf(":");
  if (idx <= 0) return false;
  const salt = Buffer.from(stored.slice(0, idx), "hex");
  const expected = Buffer.from(stored.slice(idx + 1), "hex");
  if (expected.length === 0) return false;
  const actual = scryptSync(password, salt, expected.length);
  return timingSafeEqual(expected, actual);
}

/**
 * Whether a password matches a stored hash.
 *
 * The same comparison the single-user login used, with the hash passed in
 * rather than read from the environment: users are rows now.
 */
export function verifyPassword(storedHash: string, password: string): boolean {
  try {
    return verifyScrypt(storedHash, password);
  } catch {
    return false;
  }
}

/**
 * The old single-user check, kept for the first-run bootstrap only.
 *
 * Nothing signs in through this any more — the login reads the users table —
 * but the credentials in the environment still create the first account, and
 * the tests that cover that path use this.
 */
export function verifyCredentials(
  username: string,
  password: string,
): boolean {
  const { username: expectedUser, passwordHash, passwordPlain } =
    getCredentials();
  const userOk = safeEqual(username, expectedUser);

  let passOk: boolean;
  if (passwordHash) {
    passOk = verifyScrypt(passwordHash, password);
  } else {
    passOk = safeEqual(password, passwordPlain ?? "");
  }

  // Evaluate both sides regardless so username timing is not observable.
  return userOk && passOk;
}

export type SessionCookie = {
  name: string;
  value: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
};

function cookieAttrs(maxAge: number, secure: boolean): Omit<SessionCookie, "value"> {
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge,
  };
}

/**
 * An authenticated session, for one user.
 *
 * The user's id travels in the cookie and is signed with it, so a request can
 * be attributed without a database lookup — which is what lets the route guard
 * stay in front of every page without becoming a query per page. It is an id
 * rather than a username: renaming a user must not sign them out, and an id
 * says nothing about who they are if the cookie is ever seen.
 */
export function createSession(userId: string): SessionCookie {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = `${userId}.${expiresAt}`;
  return {
    ...cookieAttrs(SESSION_TTL_MS / 1000, process.env.NODE_ENV === "production"),
    value: `${payload}.${sign(payload)}`,
  };
}

/** Cookie used to clear the session on logout. */
export function clearSession(): SessionCookie {
  return { ...cookieAttrs(0, process.env.NODE_ENV === "production"), value: "" };
}

/**
 * Who a session cookie says it belongs to, or null.
 *
 * Null covers every way a cookie can fail to prove anything: absent,
 * malformed, expired, tampered with, or signed with another secret. Callers
 * cannot tell those apart, which is deliberate — an unauthenticated request is
 * one answer, not a diagnosis.
 */
export function sessionUser(value: string | undefined): string | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [userId, expiresAt, token] = parts;
  if (!userId || !expiresAt) return null;
  const expires = Number(expiresAt);
  if (!Number.isFinite(expires) || expires <= Date.now()) return null;
  try {
    return safeEqual(token, sign(`${userId}.${expiresAt}`)) ? userId : null;
  } catch {
    // Missing or misconfigured secret: treat as unauthenticated.
    return null;
  }
}

/** Whether a session cookie is valid at all. The route guard needs no more. */
export function verifySession(value: string | undefined): boolean {
  return sessionUser(value) !== null;
}

export function getSessionCookieName(): string {
  return SESSION_COOKIE;
}
