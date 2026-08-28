import { ensureDb } from "@/db/init";
import { BadRequestError, getState, resetToSample } from "@/db/repo";
import { handle, readJson } from "@/db/http";
import { resetSchema } from "@/lib/schemas";
import { generateSampleData } from "@/lib/sample";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(async () => {
    const body = resetSchema.safeParse((await readJson(req)) ?? {});
    if (!body.success) {
      throw new BadRequestError(
        'Destructive reset requires {"confirm":"RESET"} in the request body.',
      );
    }
    await ensureDb();
    await resetToSample(generateSampleData());
    return getState();
  });
}
