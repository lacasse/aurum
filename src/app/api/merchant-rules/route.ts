import { ensureDb } from "@/db/init";
import { BadRequestError, upsertMerchantRule } from "@/db/repo";
import { handle, readJson } from "@/db/http";

export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  return handle(async () => {
    await ensureDb();
    const b = (await readJson(req)) as Record<string, unknown>;
    if (typeof b.merchant !== "string" || !b.merchant.trim())
      throw new BadRequestError("merchant required");
    if (typeof b.category !== "string" || !b.category.trim())
      throw new BadRequestError("category required");
    await upsertMerchantRule(b.merchant.trim().toLowerCase(), b.category.trim());
    return { ok: true };
  });
}
