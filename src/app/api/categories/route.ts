import { ensureDb } from "@/db/init";
import {
  insertCategory,
  nextPosition,
  parseCategory,
  parseRenameCategory,
  renameCategoryEverywhere,
} from "@/db/repo";
import { categories } from "@/db/schema";
import { handle, readJson } from "@/db/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(async () => {
    await ensureDb();
    const { name } = parseCategory(await readJson(req));
    const position = await nextPosition(categories);
    await insertCategory(name, position);
    return { ok: true };
  });
}

export async function PUT(req: Request) {
  return handle(async () => {
    await ensureDb();
    const { oldName, newName } = parseRenameCategory(await readJson(req));
    await renameCategoryEverywhere(oldName, newName);
    return { ok: true };
  });
}
