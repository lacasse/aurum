import { isCoinTicker } from "./market";
import type { Currency } from "./types";

/**
 * Monthly closing prices, from Yahoo's chart endpoint.
 *
 * A third feed alongside EODHD and Twelve Data, and the only one asked for
 * history rather than a current quote. It is here because the other two are
 * rationed — twenty EODHD calls a day, a per-minute credit budget on Twelve
 * Data — and a five-year monthly series for thirty tickers is far more than
 * either allowance can carry. Yahoo answers a whole series in one unmetered
 * request, which is exactly the shape of this question. The benchmark series
 * has been read this way since it was added; this generalises it.
 *
 * Nothing time-critical depends on it: prices shown as current still come from
 * the paid feeds, and a failure here costs history, not the live figure.
 */

const CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/**
 * The Yahoo spelling of a ticker this app stores.
 *
 * Two disagreements with our own notation:
 *
 *  - Cboe Canada is ".NE" to Yahoo and ".NEO" to EODHD. We store the EODHD
 *    spelling because that is what prices the live quote.
 *  - A coin is a pair, and the quote currency is the one the position is
 *    recorded in — so a BTC position held in CAD is read as "BTC-CAD" and
 *    needs no FX conversion afterwards.
 */
export function toYahooSymbol(ticker: string, currency: Currency = "CAD"): string {
  const t = ticker.trim().toUpperCase();
  if (isCoinTicker(t)) return `${t}-${currency}`;
  if (t.endsWith(".NEO")) return `${t.slice(0, -4)}.NE`;
  return t;
}

/** Yahoo's symbol for the USD→CAD rate. */
export const USD_CAD_SYMBOL = "CAD=X";

export interface MonthlySeries {
  /** Month key ("2024-03") to that month's closing price. */
  closes: Map<string, number>;
  /** Currency the closes are quoted in, as reported by Yahoo. */
  currency: string | null;
  /**
   * Whether Yahoo actually answered. False means the request failed, which is
   * not the same as a symbol it carries no prices for — the caller must not
   * remember a failure as "asked and answered", or a rate-limited minute would
   * lock a ticker out of the next attempt.
   */
  ok: boolean;
}

/**
 * Parse a chart payload into month-keyed closes.
 *
 * Split out from the fetch so it can be tested against a recorded payload
 * without a network call.
 */
export function parseMonthlyChart(json: unknown): MonthlySeries {
  const chart = json as {
    chart?: {
      result?: {
        meta?: { currency?: string };
        timestamp?: number[];
        indicators?: {
          adjclose?: { adjclose?: (number | null)[] }[];
          quote?: { close?: (number | null)[] }[];
        };
      }[];
    };
  };
  const result = chart.chart?.result?.[0];
  const ts = result?.timestamp ?? [];
  const raw =
    result?.indicators?.adjclose?.[0]?.adjclose ??
    result?.indicators?.quote?.[0]?.close ??
    [];
  const closes = new Map<string, number>();
  for (let i = 0; i < ts.length; i++) {
    const price = raw[i];
    if (price == null || !Number.isFinite(price) || price <= 0) continue;
    const d = new Date(ts[i] * 1000);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    // Later points win: with interval=1mo there is one per month, but a
    // partial current month can arrive twice around a month boundary.
    closes.set(key, Math.round(price * 1e6) / 1e6);
  }
  return { closes, currency: result?.meta?.currency ?? null, ok: true };
}

/**
 * Monthly closes for one symbol. Returns an empty series rather than throwing:
 * a ticker Yahoo cannot answer for (a delisting, a renamed symbol) should cost
 * that one line on the chart, not the whole request.
 *
 * A refusal is not retried, and that is deliberate. Yahoo throttles with a 429
 * that lasts minutes, not milliseconds, so an immediate second attempt only
 * spends another request against the limit it just hit — the caller backs off
 * for the round instead. A dropped connection is a different thing and does
 * get one more try.
 */
export async function fetchMonthlyCloses(
  symbol: string,
  range = "10y",
): Promise<MonthlySeries> {
  const url = `${CHART_BASE}/${encodeURIComponent(symbol)}?interval=1mo&range=${range}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) {
        console.warn(`[yahoo] ${symbol}: responded ${res.status}`);
        break;
      }
      return parseMonthlyChart(await res.json());
    } catch (err) {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 1_000));
        continue;
      }
      console.warn(`[yahoo] ${symbol}: ${(err as Error).message}`);
    }
  }
  return { closes: new Map(), currency: null, ok: false };
}
