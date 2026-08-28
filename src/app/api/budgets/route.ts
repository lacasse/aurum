import { ensureDb } from "@/db/init";
import { parseBudget, upsertBudget } from "@/db/repo";
import { handle, readJson } from "@/db/http";

export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  return handle(async () => {
    await ensureDb();
    const { category, limit } = parseBudget(await readJson(req));
    await upsertBudget(category, limit);
    return { ok: true };
  });
}
