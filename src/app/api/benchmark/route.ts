import { and, asc, eq, inArray } from "drizzle-orm";
import { ensureDb } from "@/db/init";
import { db } from "@/db/index";
import { priceHistory } from "@/db/schema";
import { handle } from "@/db/http";
import { lastMonthKeys } from "@/lib/format";

export const dynamic = "force-dynamic";

const SYMBOL = "XEQT.TO";
const NAME = "iShares Core MSCI All-Country World Index ETF";

interface BenchmarkData {
  symbol: string;
  name: string;
  /** Kept for the client's badge; always false now that the series is stored. */
  simulated: boolean;
  note?: string;
  series: { month: string; price: number }[];
}

/*
 * The series is shipped with the code (see 0016) rather than fetched.
 *
 * It used to come from Yahoo, which refused nearly every request, and the
 * route answered with a deterministic simulation when that happened — so the
 * benchmark line was a random walk wearing XEQT's name. Month-end closes do
 * not change once the month is over, which makes them data, not a feed: there
 * is nothing to poll for, no quota to respect, and no failure mode where the
 * chart invents a comparison. Extending the series means editing a migration.
 */
export async function GET(req: Request) {
  return handle(async () => {
    await ensureDb();
    const monthsParam = Number(new URL(req.url).searchParams.get("months") ?? 18);
    const months = lastMonthKeys(Math.min(Math.max(monthsParam, 3), 120));

    const rows = await db
      .select({ month: priceHistory.month, close: priceHistory.close })
      .from(priceHistory)
      .where(
        and(
          eq(priceHistory.ticker, SYMBOL),
          eq(priceHistory.source, "benchmark"),
          inArray(priceHistory.month, months),
        ),
      )
      .orderBy(asc(priceHistory.month));

    /*
     * An empty answer is an honest one. The chart hides the benchmark rather
     * than drawing a line it cannot support — which is the whole point of
     * removing the simulation.
     */
    const series = rows
      .filter((r) => Number.isFinite(Number(r.close)) && Number(r.close) > 0)
      .map((r) => ({ month: r.month, price: Number(r.close) }));

    return {
      symbol: SYMBOL,
      name: NAME,
      simulated: false,
      series,
    } satisfies BenchmarkData;
  });
}
