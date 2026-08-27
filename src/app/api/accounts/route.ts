import { ensureDb } from "@/db/init";
import { insertAccount, nextPosition, parseAccount } from "@/db/repo";
import { accounts } from "@/db/schema";
import { handle, readJson } from "@/db/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(async () => {
    await ensureDb();
    const account = parseAccount(await readJson(req));
    const position = await nextPosition(accounts);
    await insertAccount(account, position);
    return { ok: true };
  });
}
