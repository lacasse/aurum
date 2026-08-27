import { NextResponse } from "next/server";
import { reserveTwelveDataCredits } from "@/lib/ratelimit";

const TWELVE_DATA_KEY = process.env.TWELVEDATA_API_KEY ?? "";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let cachedRate: number | null = null;
let cachedAt = 0;

export async function GET() {
  const now = Date.now();
  if (cachedRate && now - cachedAt < CACHE_TTL_MS) {
    return NextResponse.json({ rate: cachedRate, cached: true });
  }

  if (!TWELVE_DATA_KEY || !reserveTwelveDataCredits(1)) {
    if (cachedRate) {
      return NextResponse.json({ rate: cachedRate, cached: true, stale: true });
    }
    return NextResponse.json({ rate: 1.37, cached: false, fallback: true });
  }

  try {
    const res = await fetch(
      `https://api.twelvedata.com/exchange_rate?symbol=USD/CAD&apikey=${TWELVE_DATA_KEY}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) throw new Error(`Twelve Data responded ${res.status}`);
    const data = (await res.json()) as { rate?: number };
    const px = data.rate;
    if (typeof px !== "number" || !Number.isFinite(px) || px <= 0) throw new Error("No rate in response");
    cachedRate = Math.round(px * 10000) / 10000;
    cachedAt = now;
    return NextResponse.json({ rate: cachedRate, cached: false });
  } catch {
    if (cachedRate) {
      return NextResponse.json({ rate: cachedRate, cached: true, stale: true });
    }
    return NextResponse.json({ rate: 1.37, cached: false, fallback: true });
  }
}
