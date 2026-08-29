import { lastMonthKeys } from "@/lib/format";
import { handle } from "@/db/http";
import { fetchMonthlyCloses } from "@/lib/yahoo";

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

/*
 * How long to leave Yahoo alone after it refuses.
 *
 * Only successes used to be cached, so a refusal meant asking again on the
 * very next page load — and Yahoo answers a burst from one address with 429s
 * that last minutes, so retrying on sight is what keeps the refusal alive.
 * Backing off for half an hour turns a failed fetch into one failed fetch.
 */
const FAILURE_TTL = 30 * 60 * 1000;
let failedAt = 0;

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
  /*
   * Ten years, not two. The charts run back to the first recorded trade, and a
   * benchmark that stops short of that would silently shorten the comparison
   * to whatever both lines happened to cover. One request costs the same
   * either way.
   */
  const { closes } = await fetchMonthlyCloses(SYMBOL, "10y");
  if (closes.size === 0) throw new Error("empty chart payload");
  const series = months
    .filter((m) => closes.has(m))
    .map((m) => ({ month: m, price: closes.get(m)! }));
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

    if (Date.now() - failedAt < FAILURE_TTL) return simulate(months);

    try {
      const data = await fetchLive(months);
      cache = { at: Date.now(), data };
      failedAt = 0;
      return data;
    } catch (err) {
      console.error("[benchmark] live fetch failed, using simulation:", err);
      failedAt = Date.now();
      return simulate(months);
    }
  });
}
