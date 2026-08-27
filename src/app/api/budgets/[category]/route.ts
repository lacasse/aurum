import { ensureDb } from "@/db/init";
import { deleteBudgetRow } from "@/db/repo";
import { handle } from "@/db/http";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ category: string }>;
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => {
    await ensureDb();
    const { category } = await params;
    await deleteBudgetRow(decodeURIComponent(category));
    return { ok: true };
  });
}
