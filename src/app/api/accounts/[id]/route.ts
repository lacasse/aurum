import { ensureDb } from "@/db/init";
import { deleteAccountRow, parseAccount, replaceAccount } from "@/db/repo";
import { handle, readJson } from "@/db/http";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function PUT(req: Request, { params }: Ctx) {
  return handle(async (user) => {
    await ensureDb();
    const { id } = await params;
    const account = parseAccount(await readJson(req));
    await replaceAccount(user.id, { ...account, id });
    return { ok: true };
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async (user) => {
    await ensureDb();
    const { id } = await params;
    await deleteAccountRow(user.id, id);
    return { ok: true };
  });
}
