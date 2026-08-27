import { ensureDb } from "@/db/init";
import { deleteCategorySmart } from "@/db/repo";
import { handle } from "@/db/http";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ name: string }>;
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => {
    await ensureDb();
    const { name } = await params;
    await deleteCategorySmart(decodeURIComponent(name));
    return { ok: true };
  });
}
