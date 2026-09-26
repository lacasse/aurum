import { handle, readJson } from "@/db/http";
import { confirmPassword } from "@/db/confirm-password";
import { BadRequestError, eraseUserRecord } from "@/db/repo";
import { ERASE_PHRASE, isErasePhrase } from "@/lib/erase";

export const dynamic = "force-dynamic";

/**
 * Starts the signed-in person's record over from nothing. Only theirs: every
 * delete is filtered to their id, and other accounts are never read.
 *
 * Asks for the phrase and the password again. The page has already asked
 * twice; the server asks for itself, because a request does not have to come
 * from the page.
 */
export async function DELETE(req: Request) {
  return handle(async (user) => {
    const body = (await readJson(req)) as { password?: unknown; confirm?: unknown };
    if (!isErasePhrase(body.confirm)) {
      throw new BadRequestError(`Type "${ERASE_PHRASE}" to confirm.`);
    }
    await confirmPassword(req, user, body.password);
    await eraseUserRecord(user.id);
    return { ok: true };
  });
}
