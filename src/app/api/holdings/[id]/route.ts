import { ensureDb } from "@/db/init";
import { deleteHoldingRow, parseHolding, replaceHolding } from "@/db/repo";
import { handle, readJson } from "@/db/http";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function PUT(req: Request, { params }: Ctx) {
  return handle(async (user) => {
    await ensureDb();
    const { id } = await params;
    const holding = parseHolding(await readJson(req));
    await replaceHolding(user.id, { ...holding, id });
    return { ok: true };
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async (user) => {
    await ensureDb();
    const { id } = await params;
    await deleteHoldingRow(user.id, id);
    return { ok: true };
  });
}
