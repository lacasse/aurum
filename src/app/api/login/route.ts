import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSession, verifyCredentials } from "@/lib/auth";

export async function POST(request: Request) {
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
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

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
