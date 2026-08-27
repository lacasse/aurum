import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clearSession } from "@/lib/auth";

export async function POST() {
  const session = clearSession();
  (await cookies()).set(session.name, session.value, {
    httpOnly: session.httpOnly,
    secure: session.secure,
    sameSite: session.sameSite,
    path: session.path,
    maxAge: session.maxAge,
  });
  return NextResponse.json({ ok: true });
}
