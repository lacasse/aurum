import { ensureDb } from "@/db/init";
import { BadRequestError, upsertBudget } from "@/db/repo";
import { handle, readJson } from "@/db/http";

export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  return handle(async () => {
    await ensureDb();
    const b = (await readJson(req)) as Record<string, unknown>;
    const limit = Number(b.limit);
    if (typeof b.category !== "string" || !b.category.trim())
      throw new BadRequestError("category required");
    if (!Number.isFinite(limit) || limit <= 0)
      throw new BadRequestError("limit must be > 0");
    await upsertBudget(b.category.trim(), Math.round(limit * 100) / 100);
    return { ok: true };
  });
}
