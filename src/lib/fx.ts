import { reserveTwelveDataCredits } from "@/db/twelvedata";

/**
 * The USD→CAD rate, cached process-wide.
 *
 * Shared by the FX route and the price route rather than cached separately in
 * each: they ask the same question, and a second cache would mean a second call
 * against the same per-minute credit budget.
 */

const TWELVE_DATA_KEY = process.env.TWELVEDATA_API_KEY ?? "";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Used when the provider has never answered. Roughly right beats nothing. */
export const FALLBACK_USD_CAD = 1.37;

let cachedRate: number | null = null;
let cachedAt = 0;

export interface FxResult {
  rate: number;
  cached: boolean;
  stale?: boolean;
  fallback?: boolean;
}

export async function usdCadRate(now = Date.now()): Promise<FxResult> {
  if (cachedRate && now - cachedAt < CACHE_TTL_MS) {
    return { rate: cachedRate, cached: true };
  }

  if (!TWELVE_DATA_KEY || !(await reserveTwelveDataCredits(1))) {
    if (cachedRate) return { rate: cachedRate, cached: true, stale: true };
    return { rate: FALLBACK_USD_CAD, cached: false, fallback: true };
  }

  try {
    const res = await fetch(
      `https://api.twelvedata.com/exchange_rate?symbol=USD/CAD&apikey=${TWELVE_DATA_KEY}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) throw new Error(`Twelve Data responded ${res.status}`);
    const data = (await res.json()) as { rate?: number };
    const px = data.rate;
    if (typeof px !== "number" || !Number.isFinite(px) || px <= 0) {
      throw new Error("No rate in response");
    }
    cachedRate = Math.round(px * 10000) / 10000;
    cachedAt = now;
    return { rate: cachedRate, cached: false };
  } catch {
    if (cachedRate) return { rate: cachedRate, cached: true, stale: true };
    return { rate: FALLBACK_USD_CAD, cached: false, fallback: true };
  }
}
