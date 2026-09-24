import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSession, verifyPassword } from "@/lib/auth";
import {
  isLoginLocked,
  recordLoginFailure,
  resetLoginFailures,
} from "@/lib/login-rate-limit";
import { loginSchema } from "@/lib/schemas";
import { DEMO_COOKIE } from "@/lib/demo";
import { ensureDb } from "@/db/init";
import { findUserByUsername } from "@/db/repo";

/* A real hash to compare against when the username is unknown, so that an
 * unknown name and a wrong password cost the same. */
const DUMMY_HASH =
  "00000000000000000000000000000000:" + "0".repeat(128);

function clientIp(request: Request): string | undefined {
  // Prefer X-Real-IP: nginx sets it to the real peer address (not spoofable
  // from outside). If we must use X-Forwarded-For, take the last entry, which
  // nginx appends and is therefore the true originating address — the leading
  // entries are client-supplied and can be spoofed to dodge the lockout.
  const real = request.headers.get("x-real-ip");
  if (real) return real;
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((s) => s.trim());
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return undefined;
}

export async function POST(request: Request) {
  const ip = clientIp(request);

  const lock = isLoginLocked(ip);
  if (lock.locked) {
    return NextResponse.json(
      { error: "Too many failed attempts. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(lock.retryAfter) },
      },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Deliberately not surfacing the schema's field-level issues here: the
  // response must not distinguish "no such user" from "wrong password".
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Username and password are required" },
      { status: 400 },
    );
  }
  const { username, password } = parsed.data;

  /*
   * Against the users table, not the environment.
   *
   * The answer is the same whether the name is unknown or the password is
   * wrong, and the work done is as close to the same as it can be: a missing
   * user still costs a hash comparison, so the response time does not say
   * which names exist.
   */
  await ensureDb();
  const user = await findUserByUsername(username);
  const valid = user
    ? verifyPassword(user.passwordHash, password)
    : verifyPassword(DUMMY_HASH, password) && false;
  if (!valid || !user) {
    recordLoginFailure(ip);
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  resetLoginFailures(ip);

  const session = createSession(user.id, user.sessionEpoch);
  (await cookies()).set(session.name, session.value, {
    httpOnly: session.httpOnly,
    secure: session.secure,
    sameSite: session.sameSite,
    path: session.path,
    maxAge: session.maxAge,
  });
  /*
   * Signing in ends any demo in this browser. The client clears it as well, but
   * the session is the authority: a demo cookie left beside a real session
   * would have the app load invented data over the record just signed into.
   */
  (await cookies()).delete(DEMO_COOKIE);
  return NextResponse.json({ ok: true });
}
