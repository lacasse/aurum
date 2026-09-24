import { handle, requireAdmin } from "@/db/http";
import { revokeInvite } from "@/db/repo";

export const dynamic = "force-dynamic";

/** Stops an invitation working. The record of it stays. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async (user) => {
    requireAdmin(user);
    const { id } = await ctx.params;
    return { revoked: await revokeInvite(id) };
  });
}
