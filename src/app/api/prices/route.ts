import { handle } from "@/db/http";
import {
  eodhdLastFetched,
  eodhdUsage,
  recordEodhdFetched,
  reserveEodhdCalls,
} from "@/db/eodhd";
import { selectEodhdDue, utcDay } from "@/lib/eodhd-quota";
import {
  priceSource,
  toEodhdSymbol,
  toTwelveDataSymbol,
  toUsdCryptoSymbol,
} from "@/lib/market";
import { usdCadRate } from "@/lib/fx";
import { reserveTwelveDataCredits, twelveDataUsage } from "@/db/twelvedata";
import type { AssetClass, Currency } from "@/lib/types";

export const dynamic = "force-dynamic";

const TWELVE_DATA_KEY = process.env.TWELVEDATA_API_KEY ?? "";
const EODHD_TOKEN = process.env.EODHD_API_KEY ?? "";

/* ── Twelve Data (US equities + crypto + FX, batch endpoint, free 800/day) ── */

async function fetchTwelveData(
  items: { ticker: string; symbol: string }[],
): Promise<Map<string, number>> {
  if (items.length === 0 || !TWELVE_DATA_KEY) return new Map();
  const out = new Map<string, number>();
  // Batch in chunks that fit the remaining per-minute Quota; reserve credits
  // only for what we actually send, so a burst never exceeds 8/min.
  const CHUNK = 8;
  for (let start = 0; start < items.length; start += CHUNK) {
    const chunk = items.slice(start, start + CHUNK);
    if (!(await reserveTwelveDataCredits(chunk.length))) {
      console.warn(
        `[prices] Twelve Data skipped (rate/quota): ${chunk.length} credit(s)`,
      );
      break; // stop; remaining credits are budgeted out for now
    }
    const symbols = chunk.map((i) => i.symbol).join(",");
    let prices: Map<string, number>;
    try {
      const res = await fetch(
        `https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbols)}&apikey=${TWELVE_DATA_KEY}`,
        { signal: AbortSignal.timeout(10_000) },
      );
      if (!res.ok) {
        console.warn(`[prices] Twelve Data ${res.status}`);
        break;
      }
      const data = (await res.json()) as Record<string, { price?: string }>;
      prices = new Map();
      for (const item of chunk) {
        const raw = data[item.symbol]?.price;
        const px = raw != null ? parseFloat(raw) : NaN;
        if (Number.isFinite(px) && px > 0) {
          prices.set(item.ticker, Math.round(px * 100) / 100);
        }
      }
    } catch {
      break;
    }
    for (const [ticker, price] of prices) out.set(ticker, price);
    // Pace chunks so multiple chunks never exceed the per-minute budget anyway,
    // and to be polite to the API.
    if (start + CHUNK < items.length) await new Promise((r) => setTimeout(r, 250));
  }
  return out;
}

/* ── EODHD (Canadian equities, free 20/day, EOD only) ── */

async function fetchEodhd(
  items: { ticker: string; symbol: string }[],
): Promise<Map<string, number>> {
  if (items.length === 0 || !EODHD_TOKEN) return new Map();
  const out = new Map<string, number>();

  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 7);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  /*
   * Every ticker reached for is recorded, whether or not a price came back.
   *
   * Recording only successes meant a symbol the provider cannot price — a
   * delisted holding, a wrong suffix — went back into the queue on the very
   * next poll and spent another call, every hour, until the day's twenty were
   * gone. Twenty calls for two prices. A failure now waits for tomorrow, which
   * is also what a stale price is supposed to mean.
   */
  const attempted: string[] = [];

  for (const item of items) {
    attempted.push(item.ticker);
    try {
      const url = `https://eodhd.com/api/eod/${encodeURIComponent(item.symbol)}?api_token=${EODHD_TOKEN}&fmt=json&period=1d&from=${fmt(from)}&to=${fmt(to)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        console.warn(`[prices] EODHD ${res.status} for ${item.symbol}`);
        continue;
      }
      const data = (await res.json()) as
        | { close?: number }[]
        | { Message?: string };
      if (!Array.isArray(data) || data.length === 0) continue;
      const last = data[data.length - 1];
      const px = last?.close;
      if (px != null && Number.isFinite(px) && px > 0) {
        out.set(item.ticker, Math.round(px * 100) / 100);
      }
    } catch {
      console.warn(`[prices] EODHD fetch failed for ${item.symbol}`);
    }
    if (items.length > 1) await new Promise((r) => setTimeout(r, 250));
  }
  await recordEodhdFetched(attempted);
  return out;
}

/* ── End-of-day gating for EODHD ── */

// North American equities close at 16:00 Eastern. EODHD only publishes the
// daily bar after the close, so we only fetch after that time. The polling
// loop (hourly) will then capture the day's close exactly once, and the
// 24h cache keeps it from being re-fetched until the next day's close.

const CLOSE_HOUR_ET = 16;

function isAfterMarketClose(now: Date): boolean {
  // 4pm Eastern (Toronto) is our close boundary.
  const est = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Toronto" }),
  );
  const hour = est.getHours();
  const minute = est.getMinutes();
  return hour > CLOSE_HOUR_ET || (hour === CLOSE_HOUR_ET && minute >= 0);
}

/* ── In-memory cache with per-source TTL ── */

interface CacheEntry {
  price: number;
  at: number;
}

const priceCache = new Map<string, CacheEntry>();

const CACHE_TTL: Record<string, number> = {
  twelvedata: 5 * 60_000,   // 5 minutes — real-time during market hours
  eodhd: 24 * 60 * 60_000,  // 24 hours — EOD data doesn't change intraday
};

/* ── GET handler ── */

export async function GET(req: Request) {
  return handle(async () => {
    const url = new URL(req.url);
    const tickers = (url.searchParams.get("tickers") ?? "")
      .split(",")
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 30);
    const classesRaw = url.searchParams.get("classes") ?? "";
    const currenciesRaw = url.searchParams.get("currencies") ?? "";
    const classes = classesRaw.split(",").map((c) => c.trim());
    const currencies = currenciesRaw.split(",").map((c) => c.trim());

    if (tickers.length === 0) {
      return { prices: {} as Record<string, number>, ts: Date.now() };
    }

    const now = Date.now();
    const nowDate = new Date(now);
    const afterClose = isAfterMarketClose(nowDate);

    const twelveDataItems: {
      ticker: string;
      symbol: string;
      assetClass: AssetClass;
      currency: Currency;
    }[] = [];
    const eodhdItems: { ticker: string; symbol: string }[] = [];
    const cachedPrices: Record<string, number> = {};

    for (let i = 0; i < tickers.length; i++) {
      const ac = (classes[i] ?? "US Equity") as AssetClass;
      const cu = (currencies[i] ?? "USD") as Currency;

      const cached = priceCache.get(tickers[i]);
      const source = priceSource(ac, cu, tickers[i]);
      const ttl = CACHE_TTL[source] ?? 60_000;
      if (cached && now - cached.at < ttl) {
        cachedPrices[tickers[i]] = cached.price;
        continue;
      }

      if (source === "eodhd") {
        // Deliberately no "fetch immediately when uncached" escape hatch here.
        // The cache is per-process, so after a restart every ticker looks new,
        // and with a 20-call day that one bypass could spend the entire
        // allowance in a single page load. A brand-new holding still gets a
        // price the moment it is added, from /api/prices/validate.
        eodhdItems.push({ ticker: tickers[i], symbol: toEodhdSymbol(tickers[i]) });
      } else {
        twelveDataItems.push({
          ticker: tickers[i],
          symbol: toTwelveDataSymbol(tickers[i], ac, cu),
          assetClass: ac,
          currency: cu,
        });
      }
    }

    /*
     * Spend the day's remaining EODHD calls on the tickers that have gone
     * longest without a refresh. With far more holdings than calls, taking
     * them in request order would refresh the same handful every day and
     * leave the rest permanently stale.
     */
    const lastFetched = await eodhdLastFetched();
    const eodhdDue = selectEodhdDue(eodhdItems, lastFetched, utcDay(nowDate));

    // EOD data only changes after the close, so before it there is nothing new
    // to buy with the allowance.
    const budget = afterClose ? await reserveEodhdCalls(eodhdDue.length) : 0;
    const eodhdToFetch = eodhdDue.slice(0, budget);

    const [twelvePrices, eodhdPrices] = await Promise.all([
      fetchTwelveData(twelveDataItems),
      fetchEodhd(eodhdToFetch),
    ]);

    /*
     * Twelve Data does not document which quote currencies each coin carries,
     * so a CAD pair may simply not exist. Rather than let that show as a stale
     * price, ask again in USD — every pair has one — and convert. Twelve Data's
     * allowance is 800 a day, so the retry is cheap; the EODHD cap is untouched.
     */
    const cryptoMissing = twelveDataItems.filter(
      (i) => i.assetClass === "Crypto" && i.currency === "CAD" && !twelvePrices.has(i.ticker),
    );
    if (cryptoMissing.length > 0) {
      const { rate } = await usdCadRate();
      const usdPrices = await fetchTwelveData(
        cryptoMissing.map((i) => ({ ...i, symbol: toUsdCryptoSymbol(i.ticker) })),
      );
      for (const [ticker, usd] of usdPrices) {
        twelvePrices.set(ticker, Math.round(usd * rate * 100) / 100);
      }
    }

    for (const [ticker, price] of twelvePrices)
      priceCache.set(ticker, { price, at: now });
    for (const [ticker, price] of eodhdPrices)
      priceCache.set(ticker, { price, at: now });

    const prices: Record<string, number> = { ...cachedPrices };
    for (const [ticker, price] of twelvePrices) prices[ticker] = price;
    for (const [ticker, price] of eodhdPrices) prices[ticker] = price;

    /*
     * Anything routed to EODHD that we could not price now keeps whatever the
     * client already holds — its last known price — and is reported as stale so
     * the UI can say so rather than showing a figure that looks current.
     */
    const stale = eodhdItems
      .map((i) => i.ticker)
      .filter((ticker) => prices[ticker] === undefined);

    return {
      prices,
      stale,
      quota: await eodhdUsage(nowDate),
      twelveData: await twelveDataUsage(nowDate),
      ts: now,
      afterClose,
    };
  });
}
