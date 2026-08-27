import { ensureDb } from "@/db/init";
import { deleteHoldingRow, parseHolding, replaceHolding } from "@/db/repo";
import { handle, readJson } from "@/db/http";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function PUT(req: Request, { params }: Ctx) {
  return handle(async () => {
    await ensureDb();
    const { id } = await params;
    const holding = parseHolding(await readJson(req));
    await replaceHolding({ ...holding, id });
    return { ok: true };
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => {
    await ensureDb();
    const { id } = await params;
    await deleteHoldingRow(id);
    return { ok: true };
  });
}
