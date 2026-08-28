import { ensureDb } from "@/db/init";
import { getState, materializeRecurring } from "@/db/repo";
import { handle } from "@/db/http";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    await ensureDb();
    // Recurring rules are caught up on load rather than by a scheduler: this
    // app only runs while someone is looking at it, and the work is driven by
    // each rule's own next date, so it is idempotent and usually a no-op.
    await materializeRecurring();
    return getState();
  });
}
