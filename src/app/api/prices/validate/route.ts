import { handle } from "@/db/http";
import { eodhdUsage, recordEodhdFetched, reserveEodhdCalls } from "@/db/eodhd";
import { validateLimit } from "@/lib/eodhd-quota";
import {
  priceSource,
  toEodhdSymbol,
  toTwelveDataSymbol,
  toUsdCryptoSymbol,
} from "@/lib/market";
import { usdCadRate } from "@/lib/fx";
import { reserveTwelveDataCredits } from "@/db/twelvedata";
import type { AssetClass, Currency } from "@/lib/types";

export const dynamic = "force-dynamic";

const TWELVE_DATA_KEY = process.env.TWELVEDATA_API_KEY ?? "";
const EODHD_TOKEN = process.env.EODHD_API_KEY ?? "";

/**
 * A lookup either answered, or never happened.
 *
 * `checked: false` is the important case: no budget was left, or no key is
 * configured, so nothing was asked of the provider. Collapsing that into
 * "price is null" is what made an unspent quota look like a bad ticker.
 */
interface Lookup {
  price: number | null;
  checked: boolean;
}

const unchecked: Lookup = { price: null, checked: false };

async function fetchTwelveDataPrice(symbol: string): Promise<Lookup> {
  if (!TWELVE_DATA_KEY) return unchecked;
  if (!(await reserveTwelveDataCredits(1))) return unchecked; // over rate/quota budget
  try {
    const res = await fetch(
      `https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbol)}&apikey=${TWELVE_DATA_KEY}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return unchecked;
    const data = (await res.json()) as { price?: string };
    const px = data.price != null ? parseFloat(data.price) : NaN;
    return {
      price: Number.isFinite(px) && px > 0 ? Math.round(px * 100) / 100 : null,
      checked: true,
    };
  } catch {
    // A timeout or a network fault says nothing about the ticker.
    return unchecked;
  }
}

async function fetchEodhdPrice(symbol: string): Promise<Lookup> {
  if (!EODHD_TOKEN) return unchecked;
  /*
   * Validating spends one of the 20 daily calls, but draws against a lower
   * ceiling than the price refresh does: somebody typing a ticker must not be
   * able to exhaust the allowance every holding's price depends on.
   */
  if ((await reserveEodhdCalls(1, new Date(), validateLimit())) < 1) return unchecked;
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 7);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  try {
    const res = await fetch(
      `https://eodhd.com/api/eod/${encodeURIComponent(symbol)}?api_token=${EODHD_TOKEN}&fmt=json&period=1d&from=${fmt(from)}&to=${fmt(to)}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    // A 404 is EODHD's answer for an unknown symbol, and that is a real
    // answer; anything else is the request failing, which is not.
    if (res.status === 404) return { price: null, checked: true };
    if (!res.ok) return unchecked;
    const data = (await res.json()) as { close?: number }[] | { Message?: string };
    if (!Array.isArray(data)) return unchecked;
    if (data.length === 0) return { price: null, checked: true };
    const last = data[data.length - 1];
    const px = last?.close;
    return {
      price: px != null && Number.isFinite(px) && px > 0 ? Math.round(px * 100) / 100 : null,
      checked: true,
    };
  } catch {
    return unchecked;
  }
}

export async function GET(req: Request) {
  return handle(async () => {
    const url = new URL(req.url);
    const ticker = (url.searchParams.get("ticker") ?? "").trim().toUpperCase();
    const ac = (url.searchParams.get("class") ?? "US Equity") as AssetClass;
    const cu = (url.searchParams.get("currency") ?? "USD") as Currency;

    if (!ticker) {
      return { valid: false, checked: true, price: null, ticker: "" };
    }

    const usesEodhd = priceSource(ac, cu, ticker) === "eodhd";
    let result: Lookup;

    if (usesEodhd) {
      result = await fetchEodhdPrice(toEodhdSymbol(ticker));
      if (result.price != null) await recordEodhdFetched([ticker]);
    } else {
      result = await fetchTwelveDataPrice(toTwelveDataSymbol(ticker, ac, cu));
      // Same reason as the price route: a coin may not carry a CAD pair.
      if (result.price == null && ac === "Crypto" && cu === "CAD") {
        const usd = await fetchTwelveDataPrice(toUsdCryptoSymbol(ticker));
        if (usd.price != null) {
          const { rate } = await usdCadRate();
          result = { price: Math.round(usd.price * rate * 100) / 100, checked: true };
        } else if (usd.checked) {
          result = usd;
        }
      }
    }

    const valid = result.checked && result.price != null && result.price > 0;
    return {
      valid,
      /*
       * Lets the caller tell "no such ticker" from "nobody looked", which read
       * the same from a null price and had every ticker showing as rejected
       * once the day's EODHD calls were gone.
       */
      checked: result.checked,
      price: valid ? result.price : null,
      ticker,
      quotaExhausted: usesEodhd && !result.checked,
      quota: usesEodhd ? await eodhdUsage() : undefined,
    };
  });
}
