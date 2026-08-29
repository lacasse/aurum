import type { AssetClass, Currency } from "./types";

/**
 * An exchange listing carries a venue suffix — XEQT.TO, RETL.NEO, CRYP-A.TO.
 * A bare ticker does not.
 */
export function isExchangeListed(ticker: string): boolean {
  return ticker.trim().includes(".");
}

/**
 * Bare tickers that are coins rather than listed securities.
 *
 * Needed because an import has no column saying so: it carries a ticker and a
 * currency, and nothing else. Without this, a coin is filed as an equity, which
 * routes it to the Canadian equity feed as "BTC.TO" — a symbol that does not
 * exist — and spends one of a strictly limited twenty daily calls on it every
 * time. An exchange-listed crypto product (CRYP-A.TO) is not in this set: it
 * really is a listed security.
 */
const COIN_TICKERS = new Set([
  "BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "DOT", "AVAX", "MATIC", "LINK",
  "LTC", "UNI", "ATOM", "NEAR", "FIL", "BCH", "TRX", "XLM", "ETC", "HBAR",
  "ICP", "APT", "ARB", "OP", "SUI", "INJ", "TIA", "SEI", "RNDR", "IMX",
]);

/** Whether a ticker names a coin traded directly, rather than a listed security. */
export function isCoinTicker(ticker: string): boolean {
  const t = ticker.trim().toUpperCase();
  if (t.includes(".")) return false; // a venue suffix means a listing
  return COIN_TICKERS.has(t.split("/")[0]);
}

/* ── Twelve Data symbols (US stocks, crypto, FX) ── */

/**
 * Crypto is quoted as a pair. The quote currency is the one the position is
 * recorded in, so a holding kept in CAD is priced in CAD rather than being
 * converted after the fact.
 */
export function toTwelveDataSymbol(
  ticker: string,
  assetClass: AssetClass,
  currency: Currency = "USD",
): string {
  const t = ticker.trim().toUpperCase();
  if (assetClass !== "Crypto" || isExchangeListed(t)) return t;
  if (t.includes("/")) return t; // already a pair
  return `${t}/${currency}`;
}

/** The same coin quoted in USD — every pair Twelve Data carries has one. */
export function toUsdCryptoSymbol(ticker: string): string {
  const t = ticker.trim().toUpperCase();
  if (t.includes("/")) return `${t.split("/")[0]}/USD`;
  return `${t}/USD`;
}

/* ── EODHD symbols (Canadian stocks on TSX/TSXV/NEO) ── */

export function toEodhdSymbol(ticker: string): string {
  const t = ticker.trim().toUpperCase();
  if (isExchangeListed(t)) return t; // already has suffix (XEQT.TO, AAPL.NEO)
  return `${t}.TO`; // default to TSX
}

/* ── Price source routing ── */

/**
 * Which feed quotes this ticker.
 *
 * The exchange suffix decides, and nothing else: "XEQT.TO" and "RETL.NEO" name
 * a Canadian listing, so EODHD answers for them; a bare "AAPL" or "REIT" does
 * not, so Twelve Data does.
 *
 * This used to route on the currency, which read well until you notice the
 * currency is a form field that defaults to CAD. Somebody typing a US stock
 * into a fresh trade row never said "Canadian" — the default did — and the app
 * went looking for "AAPL.TO", a symbol that does not exist, spending one of a
 * strictly limited twenty daily calls to find that out. A suffix is something
 * the user writes down on purpose, so routing on it replaces an inference with
 * a statement, and leaves no ambiguous case for the app to guess at.
 *
 * A coin is bare and lands on Twelve Data, which is where it belongs. An
 * exchange-listed crypto product (CRYP-A.TO) carries a suffix and stays on
 * EODHD, which is also where it belongs — the same rule reaches both.
 */
export function priceSource(ticker: string): "twelvedata" | "eodhd" {
  return isExchangeListed(ticker) ? "eodhd" : "twelvedata";
}

/**
 * Which of the requested tickers this refresh could not price.
 *
 * A ticker is stale when the response carries no price for it — the provider
 * refused, the request failed, or the day's allowance was gone — and the UI
 * therefore goes on showing the last value it holds. Anything served from the
 * server's cache counts as priced: it is a real quote inside its own lifetime,
 * not a gap.
 *
 * Both providers are covered. This used to look only at the EODHD side, a
 * leftover from when that was the only rationed feed, so a Twelve Data ticker
 * that failed to quote showed its last known price with nothing to say the
 * figure was not current. Rare, given Twelve Data's allowance is hundreds a day
 * against EODHD's twenty — but a missing guarantee rather than a small one.
 */
export function staleTickers(
  tickers: readonly string[],
  prices: Readonly<Record<string, number>>,
): string[] {
  return tickers.filter((ticker) => prices[ticker] === undefined);
}
