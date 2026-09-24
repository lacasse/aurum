import { createHash, randomBytes } from "crypto";

/**
 * Invitations: how a second person gets an account on an installation that
 * already holds someone's money.
 *
 * Nobody can sign themselves up. An administrator creates an invitation and is
 * shown its link once; the link carries a random token, and the database keeps
 * only a hash of it — the same reason a password is stored hashed: the table
 * can be read, from a backup or a database console, and reading it must not
 * hand anybody an account. A token is good for one account, for a week.
 */

/** How long an invitation stays usable. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** A fresh token: 256 random bits, safe to put in a URL. */
export function newInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * The stored form of a token. A plain SHA-256 is enough here, unlike for a
 * password: the token is 256 random bits, so there is nothing to guess and no
 * need for a slow hash to make guessing expensive.
 */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Whether something is even shaped like a token, before touching the database. */
export function looksLikeToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export interface InviteRow {
  id: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  acceptedBy: string | null;
}

export type InviteStatus = "pending" | "accepted" | "expired";

export function inviteStatus(invite: Pick<InviteRow, "expiresAt" | "acceptedAt">, now: Date): InviteStatus {
  if (invite.acceptedAt) return "accepted";
  if (new Date(invite.expiresAt).getTime() <= now.getTime()) return "expired";
  return "pending";
}

/** Why a password cannot be used for a new account, or null if it can. */
export function passwordProblem(password: string): string | null {
  if (password.length < 12) return "Use at least 12 characters.";
  if (password.length > 200) return "That is longer than a password needs to be.";
  if (password.trim() !== password) return "A password cannot start or end with a space.";
  return null;
}
