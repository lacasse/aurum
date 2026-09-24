import { ensureDb } from "@/db/init";
import { parseTransaction, removeTransaction, updateTransactionRow } from "@/db/repo";
import { handle, readJson } from "@/db/http";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function PUT(req: Request, { params }: Ctx) {
  return handle(async (user) => {
    await ensureDb();
    const { id } = await params;
    const input = parseTransaction(await readJson(req));
    await updateTransactionRow(user.id, id, { ...input, id });
    return { ok: true };
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async (user) => {
    await ensureDb();
    const { id } = await params;
    await removeTransaction(user.id, id);
    return { ok: true };
  });
}
