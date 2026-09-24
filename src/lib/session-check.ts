import { sessionUser } from "./auth";

/**
 * The route-side half of a session check, apart from the framework so it can
 * be tested: a validly signed cookie is only good if its user still exists and
 * the epoch it was issued with is still theirs.
 */
export async function resolveSession<U extends { sessionEpoch: number }>(
  cookie: string | undefined,
  lookup: (userId: string) => Promise<U | null>,
): Promise<U | null> {
  const claim = sessionUser(cookie);
  if (!claim) return null;
  const user = await lookup(claim.userId);
  if (!user || user.sessionEpoch !== claim.epoch) return null;
  return user;
}
