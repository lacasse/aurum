import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSession, verifyCredentials } from "@/lib/auth";
import {
  isLoginLocked,
  recordLoginFailure,
  resetLoginFailures,
} from "@/lib/login-rate-limit";

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

  let body: { username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const username = (body.username ?? "").trim();
  const password = (body.password ?? "").trim();

  if (!username || !password) {
    return NextResponse.json(
      { error: "Username and password are required" },
      { status: 400 },
    );
  }

  const valid = verifyCredentials(username, password);
  if (!valid) {
    recordLoginFailure(ip);
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  resetLoginFailures(ip);

  const session = createSession();
  (await cookies()).set(session.name, session.value, {
    httpOnly: session.httpOnly,
    secure: session.secure,
    sameSite: session.sameSite,
    path: session.path,
    maxAge: session.maxAge,
  });
  return NextResponse.json({ ok: true });
}
