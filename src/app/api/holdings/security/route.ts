import { ensureDb } from "@/db/init";
import { parseSecurityUpdate, updateSecurity } from "@/db/repo";
import { handle, readJson } from "@/db/http";

export const dynamic = "force-dynamic";

/**
 * Edit a security rather than a position: ticker, name and asset class belong
 * to the thing owned, not to the account it sits in, so this applies to every
 * account holding it in one statement.
 */
export async function PUT(req: Request) {
  return handle(async () => {
    await ensureDb();
    const { from, ...next } = parseSecurityUpdate(await readJson(req));
    const updated = await updateSecurity(from, next);
    return { ok: true, updated };
  });
}
