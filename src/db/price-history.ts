import { eq, inArray, or, sql } from "drizzle-orm";
import { db } from "./index";
import { priceHistory } from "./schema";

/**
 * Where a close came from, in order of authority:
 *
 *   `snapshot`  — the user's own month-end record of what a position was worth
 *   `benchmark` — a published close shipped with the code, or read for it
 *   `provider`  — anything fetched incidentally from a price feed
 *
 * A provider close never overwrites either of the others.
 */
export type CloseSource = "snapshot" | "benchmark" | "provider";

export interface MonthlyClose {
  ticker: string;
  month: string;
  close: number;
  currency: string;
  source?: CloseSource;
}

/** Every stored close for the given tickers, oldest first. */
export async function readPriceHistory(
  tickers: readonly string[],
): Promise<MonthlyClose[]> {
  if (tickers.length === 0) return [];
  const rows = await db
    .select()
    .from(priceHistory)
    .where(inArray(priceHistory.ticker, [...tickers]));
  return rows
    .map((r) => ({ ...r, source: r.source as CloseSource }))
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
}

/**
 * Write closes, overwriting any month already stored.
 *
 * Overwriting rather than skipping because the newest month is a partial one:
 * it is written while the month is still running and has to keep moving until
 * it closes. Settled months are rewritten with the number they already held,
 * which costs nothing and removes the need to reason about which is which.
 *
 * With one exception: a figure from the user's own month-end record, or one
 * shipped as the benchmark series, is never overwritten by a fetched one. A
 * snapshot is what the position was actually worth and a benchmark close is a
 * published fact; a provider close is a price found later and multiplied by a
 * share count we reconstructed. When they disagree the fetched one is wrong,
 * so a backfill arriving afterwards must not quietly win.
 *
 * `excluded` is Postgres' name for the row the insert tried to add.
 */
export async function writePriceHistory(rows: MonthlyClose[]): Promise<void> {
  if (rows.length === 0) return;
  // Chunked: a single insert of several thousand rows exceeds the bind
  // parameter limit, and a five-year backfill is comfortably that big.
  const CHUNK = 500;
  const withSource = rows.map((r) => ({ ...r, source: r.source ?? "provider" }));
  for (let i = 0; i < withSource.length; i += CHUNK) {
    await db
      .insert(priceHistory)
      .values(withSource.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: [priceHistory.ticker, priceHistory.month],
        set: {
          close: sql`excluded."close"`,
          currency: sql`excluded."currency"`,
          source: sql`excluded."source"`,
        },
        setWhere: or(
          eq(priceHistory.source, "provider"),
          sql`excluded."source" <> 'provider'`,
        ),
      });
  }
}
