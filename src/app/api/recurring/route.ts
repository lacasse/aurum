import { ensureDb } from "@/db/init";
import {
  getState,
  insertRecurringRule,
  materializeRecurring,
  nextPosition,
  parseRecurringRule,
} from "@/db/repo";
import { recurringTransactions } from "@/db/schema";
import { handle, readJson } from "@/db/http";

export const dynamic = "force-dynamic";

/**
 * Returns the full state rather than `{ok:true}`: a new rule whose start date
 * is in the past immediately posts the occurrences it owes, so transactions
 * and account balances change too.
 */
export async function POST(req: Request) {
  return handle(async (user) => {
    await ensureDb();
    const rule = parseRecurringRule(await readJson(req));
    const position = await nextPosition(user.id, recurringTransactions);
    await insertRecurringRule(user.id, rule, position);
    await materializeRecurring(user.id);
    return getState(user.id);
  });
}
