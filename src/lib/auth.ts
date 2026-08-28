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
function signingKey(): string {
  const { username, passwordHash, passwordPlain } = getCredentials();
  const credential = passwordHash ?? passwordPlain!;
  return createHmac("sha256", getSecret())
    .update(`${username}\0${credential}`)
    .digest("base64url");
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

/** Create an authenticated session cookie. */
export function createSession(): SessionCookie {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const token = sign(String(expiresAt));
  return {
    ...cookieAttrs(SESSION_TTL_MS / 1000, process.env.NODE_ENV === "production"),
    value: `${expiresAt}.${token}`,
  };
}

/** Cookie used to clear the session on logout. */
export function clearSession(): SessionCookie {
  return { ...cookieAttrs(0, process.env.NODE_ENV === "production"), value: "" };
}

/** Verify an incoming session cookie value. Returns true if valid. */
export function verifySession(value: string | undefined): boolean {
  if (!value) return false;
  const sep = value.indexOf(".");
  if (sep < 0) return false;
  const expiresAt = value.slice(0, sep);
  const token = value.slice(sep + 1);
  const expires = Number(expiresAt);
  if (!Number.isFinite(expires) || expires <= Date.now()) return false;
  try {
    return safeEqual(token, sign(expiresAt));
  } catch {
    // Missing/misconfigured env: treat as unauthenticated.
    return false;
  }
}

export function getSessionCookieName(): string {
  return SESSION_COOKIE;
}
