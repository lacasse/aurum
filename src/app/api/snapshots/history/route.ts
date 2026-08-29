import { ensureDb } from "@/db/init";
import { getSnapshotHistory } from "@/db/repo";
import { handle } from "@/db/http";

export const dynamic = "force-dynamic";

/**
 * Every recorded month-end value, pooled per ticker.
 *
 * Separate from `/api/snapshots`, which answers for one month and keys by
 * holding for the monthly checklist. This one is the charts' question — the
 * whole history at once, by security — and answering it from the same route
 * would mean two shapes behind one URL.
 */
export async function GET() {
  return handle(async () => {
    await ensureDb();
    const months = await getSnapshotHistory();
    return { months, ts: Date.now() };
  });
}
