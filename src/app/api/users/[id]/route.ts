import { ForbiddenError, handle, readJson, requireAdmin } from "@/db/http";
import { confirmPassword } from "@/db/confirm-password";
import { BadRequestError, deleteUser, findUser, firstAdmin } from "@/db/repo";

export const dynamic = "force-dynamic";

/**
 * Removes someone's account and their whole record. Administrators only.
 *
 * Two accounts cannot be removed this way. Your own, because an administrator
 * locking themselves out is not a mistake that should take one click. And the
 * installation's owner — the first administrator — because the deployment's
 * own keys and its first record belong to that account.
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async (user) => {
    requireAdmin(user);
    const { id } = await ctx.params;
    const target = await findUser(id);
    if (!target) throw new BadRequestError("That account no longer exists.");
    if (target.id === user.id) throw new ForbiddenError("You cannot delete your own account.");
    if ((await firstAdmin())?.id === target.id) {
      throw new ForbiddenError("The installation's owner cannot be deleted.");
    }
    const body = (await readJson(req)) as { password?: unknown; confirm?: unknown };
    if (typeof body.confirm !== "string" || body.confirm.trim().toLowerCase() !== target.username) {
      throw new BadRequestError("Type the account's username to confirm.");
    }
    await confirmPassword(req, user, body.password);
    await deleteUser(target.id);
    return { ok: true };
  });
}
