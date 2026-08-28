import { ensureDb } from "@/db/init";
import { BadRequestError, deleteDemoData, getState } from "@/db/repo";
import { handle, readJson } from "@/db/http";
import { deleteDemoSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

/**
 * Removes the seeded sample rows. Destructive and irreversible, so it follows
 * the same rule as the other destructive endpoints and refuses to act without
 * an explicit confirmation token in the body.
 */
export async function DELETE(req: Request) {
  return handle(async () => {
    const body = deleteDemoSchema.safeParse((await readJson(req)) ?? {});
    if (!body.success) {
      throw new BadRequestError(
        'Deleting the demo data requires {"confirm":"DELETE"} in the request body.',
      );
    }
    await ensureDb();
    await deleteDemoData();
    return getState();
  });
}
