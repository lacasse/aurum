import { ensureDb } from "@/db/init";
import { insertAccount, nextPosition, parseAccount } from "@/db/repo";
import { accounts } from "@/db/schema";
import { handle, readJson } from "@/db/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(async (user) => {
    await ensureDb();
    const account = parseAccount(await readJson(req));
    const position = await nextPosition(user.id, accounts);
    await insertAccount(user.id, account, position);
    return { ok: true };
  });
}
