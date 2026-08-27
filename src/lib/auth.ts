import { createHmac, timingSafeEqual } from "crypto";

const SESSION_COOKIE = "aurum_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const SECRET = process.env.AUTH_SECRET || "aurum-dev-secret-change-me";

export function getAuthCredentials(): { username: string; password: string } {
  return {
    username: process.env.AUTH_USERNAME || "admin",
    password: process.env.AUTH_PASSWORD || "password",
  };
}

function sign(value: string): string {
  return createHmac("sha256", SECRET).update(value).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function verifyCredentials(
  username: string,
  password: string,
): boolean {
  const { username: u, password: p } = getAuthCredentials();
  return safeEqual(username, u) && safeEqual(password, p);
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

function cookieAttrs(maxAge: number): Omit<SessionCookie, "value"> {
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
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
    ...cookieAttrs(SESSION_TTL_MS / 1000),
    value: `${expiresAt}.${token}`,
  };
}

/** Cookie used to clear the session on logout. */
export function clearSession(): SessionCookie {
  return { ...cookieAttrs(0), value: "" };
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
  return safeEqual(token, sign(expiresAt));
}

export function getSessionCookieName(): string {
  return SESSION_COOKIE;
}
