import { ensureDb } from "@/db/init";
import { parseMerchantRule, upsertMerchantRule } from "@/db/repo";
import { handle, readJson } from "@/db/http";

export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  return handle(async (user) => {
    await ensureDb();
    const { merchant, category } = parseMerchantRule(await readJson(req));
    await upsertMerchantRule(user.id, merchant, category);
    return { ok: true };
  });
}
