import { and, desc, eq } from "drizzle-orm";
import { db } from "./index";
import { appMeta, priceHistory } from "./schema";
import { reserveEodhdCalls } from "./eodhd";
import { utcDay, validateLimit } from "@/lib/eodhd-quota";
import {
  BENCHMARK_SOURCE,
  BENCHMARK_TICKER,
  missingMonths,
  parseMonthlyBars,
} from "@/lib/benchmark";
import { writePriceHistory } from "./price-history";

const EODHD_TOKEN = process.env.EODHD_API_KEY ?? "";

/** `app_meta` key holding the UTC date the gap was last attempted. */
const ATTEMPT_KEY = "benchmark_fill_attempt";

/** The newest month the benchmark series holds, or null if it holds none. */
export async function lastBenchmarkMonth(): Promise<string | null> {
  const [row] = await db
    .select({ month: priceHistory.month })
    .from(priceHistory)
    .where(
      and(
        eq(priceHistory.ticker, BENCHMARK_TICKER),
        eq(priceHistory.source, BENCHMARK_SOURCE),
      ),
    )
    .orderBy(desc(priceHistory.month))
    .limit(1);
  return row?.month ?? null;
}

/** Whether the gap has already been reached for today. */
async function attemptedToday(today: string): Promise<boolean> {
  const [row] = await db
    .select({ value: appMeta.value })
    .from(appMeta)
    .where(eq(appMeta.key, ATTEMPT_KEY));
  return row?.value === today;
}

async function markAttempted(today: string): Promise<void> {
  await db
    .insert(appMeta)
    .values({ key: ATTEMPT_KEY, value: today })
    .onConflictDoUpdate({ target: appMeta.key, set: { value: today } });
}

/**
 * Bring the benchmark series up to the current month, if it has fallen behind.
 *
 * The series ships with the code, so it is current on the day it is released
 * and drifts from there — someone pulling six months later would otherwise
 * find the comparison line simply stopping. This closes that gap without
 * anyone having to think about it.
 *
 * It is careful with a scarce allowance in four ways:
 *
 *   - It costs **one** call however wide the gap. EODHD's EOD endpoint takes a
 *     date range and `period=m` returns one bar per month, so a year of
 *     missing months arrives in a single response.
 *   - It runs only when a month is actually missing, which is at most once a
 *     month. The ordinary case reads one row and stops.
 *   - It draws against the same reserved ceiling as ticker validation, so it
 *     can never spend the last calls that price refreshes depend on. If the
 *     day is spent it simply waits.
 *   - It marks the day whether or not it succeeded, so a provider having a bad
 *     afternoon costs one call rather than one per page load.
 *
 * Returns how many months were written.
 */
export async function fillBenchmarkGap(now: Date = new Date()): Promise<number> {
  if (!EODHD_TOKEN) return 0;

  const last = await lastBenchmarkMonth();
  const missing = missingMonths(last);
  if (missing.length === 0) return 0;

  const today = utcDay(now);
  if (await attemptedToday(today)) return 0;

  // Reserved ceiling, not the full cap: the benchmark is a background nicety
  // and must never be the reason a holding shows a stale price.
  if ((await reserveEodhdCalls(1, now, validateLimit())) < 1) return 0;
  await markAttempted(today);

  const from = `${missing[0]}-01`;
  const to = now.toISOString().slice(0, 10);
  const url =
    `https://eodhd.com/api/eod/${encodeURIComponent(BENCHMARK_TICKER)}` +
    `?api_token=${EODHD_TOKEN}&fmt=json&period=m&from=${from}&to=${to}`;

  let bars: Map<string, number>;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      console.warn(`[benchmark] EODHD ${res.status}`);
      return 0;
    }
    bars = parseMonthlyBars(await res.json());
  } catch {
    console.warn("[benchmark] EODHD fetch failed");
    return 0;
  }

  const wanted = new Set(missing);
  const rows = [...bars]
    .filter(([month]) => wanted.has(month))
    .map(([month, close]) => ({
      ticker: BENCHMARK_TICKER,
      month,
      close,
      currency: "CAD",
      source: "benchmark" as const,
    }));
  if (rows.length === 0) return 0;

  await writePriceHistory(rows);
  return rows.length;
}
