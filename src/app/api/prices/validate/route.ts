import { handle } from "@/db/http";
import { priceSource, toEodhdSymbol, toTwelveDataSymbol } from "@/lib/market";
import { reserveTwelveDataCredits } from "@/lib/ratelimit";
import type { AssetClass, Currency } from "@/lib/types";

export const dynamic = "force-dynamic";

const TWELVE_DATA_KEY = process.env.TWELVEDATA_API_KEY ?? "";
const EODHD_TOKEN = process.env.EODHD_API_KEY ?? "";

async function fetchTwelveDataPrice(symbol: string): Promise<number | null> {
  if (!TWELVE_DATA_KEY) return null;
  if (!reserveTwelveDataCredits(1)) return null; // over rate/quota budget
  try {
    const res = await fetch(
      `https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbol)}&apikey=${TWELVE_DATA_KEY}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { price?: string };
    const px = data.price != null ? parseFloat(data.price) : NaN;
    return Number.isFinite(px) && px > 0 ? Math.round(px * 100) / 100 : null;
  } catch {
    return null;
  }
}

async function fetchEodhdPrice(symbol: string): Promise<number | null> {
  if (!EODHD_TOKEN) return null;
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 7);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  try {
    const res = await fetch(
      `https://eodhd.com/api/eod/${encodeURIComponent(symbol)}?api_token=${EODHD_TOKEN}&fmt=json&period=1d&from=${fmt(from)}&to=${fmt(to)}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { close?: number }[] | { Message?: string };
    if (!Array.isArray(data) || data.length === 0) return null;
    const last = data[data.length - 1];
    const px = last?.close;
    return px != null && Number.isFinite(px) && px > 0 ? Math.round(px * 100) / 100 : null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  return handle(async () => {
    const url = new URL(req.url);
    const ticker = (url.searchParams.get("ticker") ?? "").trim().toUpperCase();
    const ac = (url.searchParams.get("class") ?? "US Equity") as AssetClass;
    const cu = (url.searchParams.get("currency") ?? "USD") as Currency;

    if (!ticker) {
      return { valid: false, price: null, ticker: "" };
    }

    let price: number | null = null;

    if (priceSource(ac, cu) === "eodhd") {
      price = await fetchEodhdPrice(toEodhdSymbol(ticker));
    } else {
      price = await fetchTwelveDataPrice(toTwelveDataSymbol(ticker, ac));
    }

    return {
      valid: price != null && price > 0,
      price: price != null && price > 0 ? price : null,
      ticker,
    };
  });
}
