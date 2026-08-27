import { ensureDb } from "@/db/init";
import { BadRequestError, insertCategory, nextPosition, renameCategoryEverywhere } from "@/db/repo";
import { categories } from "@/db/schema";
import { handle, readJson } from "@/db/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(async () => {
    await ensureDb();
    const b = (await readJson(req)) as Record<string, unknown>;
    if (typeof b.name !== "string" || !b.name.trim())
      throw new BadRequestError("name required");
    const position = await nextPosition(categories);
    await insertCategory(b.name.trim(), position);
    return { ok: true };
  });
}

export async function PUT(req: Request) {
  return handle(async () => {
    await ensureDb();
    const b = (await readJson(req)) as Record<string, unknown>;
    if (typeof b.oldName !== "string" || !b.oldName.trim())
      throw new BadRequestError("oldName required");
    if (typeof b.newName !== "string" || !b.newName.trim())
      throw new BadRequestError("newName required");
    await renameCategoryEverywhere(b.oldName.trim(), b.newName.trim());
    return { ok: true };
  });
}
