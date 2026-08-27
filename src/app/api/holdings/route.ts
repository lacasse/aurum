import { ensureDb } from "@/db/init";
import { insertHolding, nextPosition, parseHolding } from "@/db/repo";
import { holdings } from "@/db/schema";
import { handle, readJson } from "@/db/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(async () => {
    await ensureDb();
    const holding = parseHolding(await readJson(req));
    const position = await nextPosition(holdings);
    await insertHolding(holding, position);
    return { ok: true };
  });
}
