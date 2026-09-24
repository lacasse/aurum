import { handle, requireAdmin } from "@/db/http";
import { insertInvite, listInvites, listUsers } from "@/db/repo";
import { INVITE_TTL_MS, hashInviteToken, inviteStatus, newInviteToken } from "@/lib/invites";
import { uid } from "@/lib/ids";

export const dynamic = "force-dynamic";

/**
 * The people on this installation and the invitations out to others.
 * Administrators only: who has an account is not everybody's business.
 */
export async function GET() {
  return handle(async (user) => {
    requireAdmin(user);
    const [people, invites] = await Promise.all([listUsers(), listInvites()]);
    const nameOf = new Map(people.map((p) => [p.id, p.username]));
    const now = new Date();
    return {
      people: people.map((p) => ({
        username: p.username,
        role: p.role,
        createdAt: p.createdAt,
        you: p.id === user.id,
      })),
      invites: invites.map((i) => ({
        id: i.id,
        status: inviteStatus(i, now),
        createdBy: nameOf.get(i.createdBy) ?? null,
        createdAt: i.createdAt,
        expiresAt: i.expiresAt,
        acceptedBy: i.acceptedBy ? (nameOf.get(i.acceptedBy) ?? null) : null,
      })),
    };
  });
}

/**
 * A new invitation. The token is in the response and nowhere else — only its
 * hash is stored — so this is the one moment the link can be seen.
 */
export async function POST() {
  return handle(async (user) => {
    requireAdmin(user);
    const token = newInviteToken();
    const now = new Date();
    const invite = {
      id: uid(),
      tokenHash: hashInviteToken(token),
      createdBy: user.id,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + INVITE_TTL_MS).toISOString(),
    };
    await insertInvite(invite);
    return { id: invite.id, path: `/invite/${token}`, expiresAt: invite.expiresAt };
  });
}
