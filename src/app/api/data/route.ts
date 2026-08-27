import { ensureDb } from "@/db/init";
import { getState } from "@/db/repo";
import { handle } from "@/db/http";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    await ensureDb();
    return getState();
  });
}
