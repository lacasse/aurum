import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { ensureDb } from "@/db/init";
import {
  InviteUnusableError,
  UsernameTakenError,
  acceptInvite,
  findUser,
  inviteIsUsable,
} from "@/db/repo";
import { createSession, hashPassword } from "@/lib/auth";
import { hashInviteToken, looksLikeToken, passwordProblem } from "@/lib/invites";
import { usernameProblem } from "@/lib/usernames";
import { uid } from "@/lib/ids";
import { clientIp } from "@/lib/client-ip";
import { isLoginLocked, recordLoginFailure, resetLoginFailures } from "@/lib/login-rate-limit";
import { DEMO_COOKIE } from "@/lib/demo";

export const dynamic = "force-dynamic";

/*
 * The one route besides signing in that answers without a session, because the
 * person using it has no account yet. What it can do is narrow: turn one valid,
 * unused, unexpired invitation into one member account. Failures count against
 * the same per-address limit as the login, since both are a door to an account.
 */
const acceptSchema = z.object({
  token: z.string().max(100),
  username: z.string().max(100),
  password: z.string().max(500),
});

const unusable = () =>
  NextResponse.json(
    { error: "This invitation has been used, has expired, or was never valid. Ask for a new one." },
    { status: 410 },
  );

/** Whether a link can still be used, so the page can say so before the form. */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!looksLikeToken(token)) return NextResponse.json({ usable: false });
  await ensureDb();
  return NextResponse.json({ usable: await inviteIsUsable(hashInviteToken(token)) });
}

export async function POST(request: Request) {
  const ip = clientIp(request);
  const lock = isLoginLocked(ip);
  if (lock.locked) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(lock.retryAfter) } },
    );
  }

  const parsed = acceptSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "A username and a password are required." }, { status: 400 });
  }
  const { token, username, password } = parsed.data;
  if (!looksLikeToken(token)) {
    recordLoginFailure(ip);
    return unusable();
  }
  const nameIssue = usernameProblem(username);
  if (nameIssue) return NextResponse.json({ error: nameIssue }, { status: 400 });
  const passwordIssue = passwordProblem(password);
  if (passwordIssue) return NextResponse.json({ error: passwordIssue }, { status: 400 });

  await ensureDb();
  const id = uid();
  try {
    await acceptInvite(hashInviteToken(token), {
      id,
      username,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    if (err instanceof InviteUnusableError) {
      recordLoginFailure(ip);
      return unusable();
    }
    if (err instanceof UsernameTakenError) {
      return NextResponse.json({ error: "That username is taken. Choose another." }, { status: 409 });
    }
    throw err;
  }
  resetLoginFailures(ip);

  // Signed straight in: the invitation already proved who this is for.
  const user = await findUser(id);
  const session = createSession(id, user?.sessionEpoch ?? 0);
  const jar = await cookies();
  jar.set(session.name, session.value, {
    httpOnly: session.httpOnly,
    secure: session.secure,
    sameSite: session.sameSite,
    path: session.path,
    maxAge: session.maxAge,
  });
  jar.delete(DEMO_COOKIE);
  return NextResponse.json({ ok: true });
}
