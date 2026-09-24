import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSessionCookieName } from "@/lib/auth";
import { resolveSession } from "@/lib/session-check";
import { ensureDb } from "./init";
import { findUser, type UserRow } from "./repo";

/**
 * Who is asking, for a route that needs to know.
 *
 * The route guard has already refused anything without a validly signed
 * cookie, but it cannot tell whether that cookie's user still exists or has
 * changed their password since it was issued — both need the database, and the
 * guard runs in front of every page. Routes query anyway, so this is where it
 * happens: the user must exist, and the cookie must carry their current
 * session epoch.
 */
export async function currentUser(): Promise<UserRow | null> {
  const cookie = (await cookies()).get(getSessionCookieName())?.value;
  await ensureDb();
  return resolveSession(cookie, findUser);
}

/** Thrown by `requireUser`, and turned into a 401 by `withUser`. */
class NotSignedIn extends Error {}

export async function requireUser(): Promise<UserRow> {
  const user = await currentUser();
  if (!user) throw new NotSignedIn();
  return user;
}

/**
 * Runs a route handler for the signed-in user, or answers 401.
 *
 * The one way a route learns who it is serving. Everything below it takes the
 * user as an argument, so a query cannot be written without deciding whose
 * rows it reads.
 */
export async function withUser(
  handler: (user: UserRow) => Promise<Response>,
): Promise<Response> {
  let user: UserRow;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof NotSignedIn) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    throw err;
  }
  return handler(user);
}
