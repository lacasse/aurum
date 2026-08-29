import { desc } from "drizzle-orm";
import { handle } from "@/db/http";
import { db } from "@/db/index";
import { holdings as holdingsTable } from "@/db/schema";
import {
  readPriceHistory,
  writePriceHistory,
  type MonthlyClose,
} from "@/db/price-history";
import { currentMonthKey } from "@/lib/format";
import { fetchMonthlyCloses, toYahooSymbol, USD_CAD_SYMBOL } from "@/lib/yahoo";
import { FALLBACK_USD_CAD } from "@/lib/fx";
import type { Currency } from "@/lib/types";

export const dynamic = "force-dynamic";

/** The ticker the USD→CAD rate is stored under. */
const FX_TICKER = "USDCAD";

/*
 * A ticker is re-asked for at most twice a day.
 *
 * Without this, a symbol Yahoo has no current month for — a delisting, a
 * ticker that was reused by another company — looks permanently out of date
 * and would be re-fetched on every page load, forever. The guard is
 * per-process and deliberately not persisted: a restart re-asking once is
 * harmless, and it keeps the failure from needing a schema of its own.
 */
const ATTEMPT_TTL_MS = 12 * 60 * 60 * 1000;
const attempted = new Map<string, number>();

/*
 * How fast the backfill is allowed to go.
 *
 * Yahoo answers a burst from one address with 429s that then last for minutes,
 * and a first fill wants thirty symbols — so the pace, not the total, is what
 * has to be governed. A few symbols a minute fills a cold cache in a couple of
 * minutes and is never approached again: history does not change, so after the
 * first fill only the current month is ever re-asked for.
 *
 * The window is per-process and not persisted. A restart mid-fill resumes at
 * full pace once, which is well inside what Yahoo tolerates.
 */
const MAX_PER_WINDOW = Number(process.env.PRICE_HISTORY_PER_MINUTE ?? 6);
const WINDOW_MS = 60_000;
const SPACING_MS = 700;
/** Bound on one request, so a slow provider cannot hold the page open. */
const TIME_BUDGET_MS = 12_000;

/*
 * How long to leave Yahoo alone after it refuses.
 *
 * Its 429 is not a "try again now" — it holds for many minutes, and requests
 * sent during it appear to extend it, so the one thing that must not happen is
 * a poll loop knocking every few seconds. After a refusal the route stops
 * asking entirely and simply serves what is already stored.
 */
const COOLDOWN_MS = 20 * 60 * 1000;

let windowStartedAt = 0;
let windowCount = 0;
let refusedAt = 0;

/** How many symbols may still be fetched in the current minute. */
function fetchAllowance(now: number): number {
  if (now - refusedAt < COOLDOWN_MS) return 0;
  if (now - windowStartedAt > WINDOW_MS) {
    windowStartedAt = now;
    windowCount = 0;
  }
  return Math.max(0, MAX_PER_WINDOW - windowCount);
}

interface Target {
  ticker: string;
  currency: Currency;
}

/** Every ticker held, with the currency its position is recorded in. */
async function heldTickers(): Promise<Target[]> {
  const rows = await db
    .select({
      ticker: holdingsTable.ticker,
      currency: holdingsTable.currency,
    })
    .from(holdingsTable)
    .orderBy(desc(holdingsTable.ticker));
  const byTicker = new Map<string, Currency>();
  for (const row of rows) {
    byTicker.set(row.ticker.toUpperCase(), (row.currency as Currency) ?? "CAD");
  }
  return [...byTicker].map(([ticker, currency]) => ({ ticker, currency }));
}

export async function GET() {
  return handle(async () => {
    const targets = await heldTickers();
    const tickers = targets.map((t) => t.ticker);
    const thisMonth = currentMonthKey();

    let stored = await readPriceHistory([...tickers, FX_TICKER]);
    const newestByTicker = new Map<string, string>();
    for (const row of stored) newestByTicker.set(row.ticker, row.month);

    /*
     * Only tickers missing the current month are fetched. Settled months never
     * change, so a filled series costs nothing after the month it was written
     * in, and the whole five-year backfill happens once.
     */
    const now = Date.now();
    const due = [{ ticker: FX_TICKER, currency: "CAD" as Currency }, ...targets].filter(
      (t) =>
        newestByTicker.get(t.ticker) !== thisMonth &&
        now - (attempted.get(t.ticker) ?? 0) > ATTEMPT_TTL_MS,
    );

    const startedAt = Date.now();
    const allowance = fetchAllowance(startedAt);
    const fetched: MonthlyClose[] = [];
    let done = 0;
    for (const target of due) {
      if (done >= allowance || Date.now() - startedAt > TIME_BUDGET_MS) break;
      done++;
      windowCount++;
      const symbol =
        target.ticker === FX_TICKER
          ? USD_CAD_SYMBOL
          : toYahooSymbol(target.ticker, target.currency);
      const series = await fetchMonthlyCloses(symbol);
      /*
       * Only a real answer counts as having asked: a failed request must stay
       * due, or a throttled minute would shut a ticker out for half a day. And
       * one refusal ends the round — the limit is per address, so the symbols
       * behind it would only spend more requests to be refused too.
       */
      if (!series.ok) {
        refusedAt = Date.now();
        break;
      }
      attempted.set(target.ticker, Date.now());
      for (const [month, close] of series.closes) {
        fetched.push({
          ticker: target.ticker,
          month,
          close,
          currency: series.currency ?? target.currency,
        });
      }
      if (done < due.length) await new Promise((r) => setTimeout(r, SPACING_MS));
    }

    if (fetched.length > 0) {
      await writePriceHistory(fetched);
      stored = await readPriceHistory([...tickers, FX_TICKER]);
    }

    /*
     * Converted to CAD here rather than on the client, which would otherwise
     * have to carry the rate table and the same nearest-month rule.
     */
    const fx = new Map<string, number>();
    for (const row of stored) {
      if (row.ticker === FX_TICKER) fx.set(row.month, row.close);
    }
    const fxMonths = [...fx.keys()].sort();
    const rateFor = (month: string): number => {
      const exact = fx.get(month);
      if (exact) return exact;
      // Nearest month on record, preferring an earlier one: a rate from the
      // month before is a far better guess than today's for a 2022 valuation.
      let best: string | null = null;
      for (const m of fxMonths) {
        if (m <= month) best = m;
        else if (best === null) best = m;
      }
      return (best && fx.get(best)) || FALLBACK_USD_CAD;
    };

    const closes: Record<string, Record<string, number>> = {};
    for (const row of stored) {
      if (row.ticker === FX_TICKER) continue;
      const cad =
        row.currency === "USD" ? row.close * rateFor(row.month) : row.close;
      (closes[row.ticker] ??= {})[row.month] = Math.round(cad * 1e4) / 1e4;
    }

    return {
      closes,
      complete: done >= due.length,
      pending: Math.max(0, due.length - done),
      ts: Date.now(),
    };
  });
}
