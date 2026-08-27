import { lastMonthKeys } from "@/lib/format";
import { handle } from "@/db/http";

export const dynamic = "force-dynamic";

const SYMBOL = "XEQT.TO";
const NAME = "iShares Core MSCI All-Country World Index ETF";

interface BenchmarkData {
  symbol: string;
  name: string;
  simulated: boolean;
  note?: string;
  series: { month: string; price: number }[];
}

interface Cached {
  at: number;
  data: BenchmarkData;
}

const TTL = 12 * 60 * 60 * 1000;
let cache: Cached | null = null;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic stand-in with a global-equity profile (~6.5%/yr drift, ~9% vol). */
function simulate(months: string[]): BenchmarkData {
  const rng = mulberry32(20260825);
  const drift = Math.pow(1.065, 1 / 12);
  let p = 100;
  const series = months.map((month) => {
    const price = Math.round(p * 100) / 100;
    p *= drift * (1 + (rng() - 0.5) * 0.09);
    return { month, price };
  });
  return {
    symbol: SYMBOL,
    name: `${NAME} (simulated)`,
    simulated: true,
    note: "Live market data unavailable — showing a deterministic simulation.",
    series,
  };
}

async function fetchLive(months: string[]): Promise<BenchmarkData> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${SYMBOL}?interval=1mo&range=2y`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`yahoo responded ${res.status}`);
  const json = (await res.json()) as {
    chart?: {
      result?: {
        timestamp?: number[];
        indicators?: {
          adjclose?: { adjclose?: (number | null)[] }[];
          quote?: { close?: (number | null)[] }[];
        };
      }[];
    };
  };
  const result = json.chart?.result?.[0];
  const ts = result?.timestamp ?? [];
  const raw =
    result?.indicators?.adjclose?.[0]?.adjclose ??
    result?.indicators?.quote?.[0]?.close ??
    [];
  if (ts.length === 0 || raw.length === 0) throw new Error("empty chart payload");

  // bucket closes by YYYY-MM, keeping the last non-null price per month
  const byMonth = new Map<string, number>();
  for (let i = 0; i < ts.length; i++) {
    const price = raw[i];
    if (price == null || !Number.isFinite(price)) continue;
    const d = new Date(ts[i] * 1000);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    byMonth.set(key, price);
  }
  const series = months
    .filter((m) => byMonth.has(m))
    .map((m) => ({ month: m, price: byMonth.get(m)! }));
  if (series.length < 3) throw new Error("not enough benchmark history");
  return { symbol: SYMBOL, name: NAME, simulated: false, series };
}

export async function GET(req: Request) {
  return handle(async () => {
    const monthsParam = Number(new URL(req.url).searchParams.get("months") ?? 18);
    const months = lastMonthKeys(Math.min(Math.max(monthsParam, 3), 60));

    if (cache && !cache.data.simulated && Date.now() - cache.at < TTL) {
      const map = new Map(cache.data.series.map((p) => [p.month, p.price]));
      const series = months.filter((m) => map.has(m)).map((m) => ({ month: m, price: map.get(m)! }));
      if (series.length >= 3) return { ...cache.data, series };
    }

    try {
      const data = await fetchLive(months);
      cache = { at: Date.now(), data };
      return data;
    } catch (err) {
      console.error("[benchmark] live fetch failed, using simulation:", err);
      return simulate(months);
    }
  });
}
