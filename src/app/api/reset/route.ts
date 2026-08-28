import { ensureDb } from "@/db/init";
import { getState, resetToSample } from "@/db/repo";
import { handle, readJson } from "@/db/http";
import { generateSampleData } from "@/lib/sample";

export const dynamic = "force-dynamic";

const CONFIRM_PHRASE = "RESET";

export async function POST(req: Request) {
  return handle(async () => {
    const body = (await readJson(req)) as Partial<{ confirm?: unknown }>;
    if (body?.confirm !== CONFIRM_PHRASE) {
      return {
        error: `Destructive reset requires {"confirm":"${CONFIRM_PHRASE}"} in the request body.`,
      };
    }
    await ensureDb();
    await resetToSample(generateSampleData());
    return getState();
  });
}
