import type { AssetClass, Currency } from "./types";

/**
 * An exchange listing carries a venue suffix — XEQT.TO, RETL.NEO, CRYP-A.TO.
 * A bare ticker does not.
 */
function isExchangeListed(ticker: string): boolean {
  return ticker.trim().includes(".");
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

export function priceSource(
  assetClass: AssetClass,
  currency: Currency,
  ticker = "",
): "twelvedata" | "eodhd" {
  /*
   * A coin has no listing venue. It trades globally and around the clock, and
   * the currency a position is recorded in says where you count it, not where
   * it trades. Routing on currency alone sent BTC, ETH and SOL to the Canadian
   * equity feed as "BTC.TO", which has no price at all — so they showed as
   * permanently stale while quietly spending the 20-a-day EODHD allowance.
   */
  if (assetClass === "Crypto" && !isExchangeListed(ticker)) return "twelvedata";
  /*
   * A crypto ETF is an exchange listing like any other: CRYP-A.TO is a TSX
   * product and EODHD is the feed that carries it.
   */
  if (currency === "CAD") return "eodhd";
  return "twelvedata";
}
