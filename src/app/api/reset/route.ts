import { ensureDb } from "@/db/init";
import { getState, resetToSample } from "@/db/repo";
import { handle } from "@/db/http";
import { generateSampleData } from "@/lib/sample";

export const dynamic = "force-dynamic";

export async function POST() {
  return handle(async () => {
    await ensureDb();
    await resetToSample(generateSampleData());
    return getState();
  });
}
