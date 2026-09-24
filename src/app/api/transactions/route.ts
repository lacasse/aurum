import { ensureDb } from "@/db/init";
import { insertTransaction, parseTransaction } from "@/db/repo";
import { handle, readJson } from "@/db/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(async (user) => {
    await ensureDb();
    const txn = parseTransaction(await readJson(req));
    await insertTransaction(user.id, txn);
    return { ok: true };
  });
}
