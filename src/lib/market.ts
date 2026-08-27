import type { AssetClass, Currency } from "./types";

/* ── Twelve Data symbols (US stocks, crypto, FX) ── */

const CRYPTO_MAP: Record<string, string> = {
  BTC: "BTC/USD",
  ETH: "ETH/USD",
  SOL: "SOL/USD",
  XRP: "XRP/USD",
  ADA: "ADA/USD",
  DOGE: "DOGE/USD",
  DOT: "DOT/USD",
  AVAX: "AVAX/USD",
  MATIC: "MATIC/USD",
  LINK: "LINK/USD",
  LTC: "LTC/USD",
  UNI: "UNI/USD",
  ATOM: "ATOM/USD",
  NEAR: "NEAR/USD",
  FIL: "FIL/USD",
};

export function toTwelveDataSymbol(ticker: string, assetClass: AssetClass): string {
  const t = ticker.trim().toUpperCase();
  if (assetClass === "Crypto") {
    return CRYPTO_MAP[t] ?? `${t}/USD`;
  }
  return t;
}

/* ── EODHD symbols (Canadian stocks on TSX/TSXV/NEO) ── */

export function toEodhdSymbol(ticker: string): string {
  const t = ticker.trim().toUpperCase();
  if (t.includes(".")) return t; // already has suffix (XEQT.TO, AAPL.NEO)
  return `${t}.TO`; // default to TSX
}

/* ── Price source routing ── */

export function priceSource(
  assetClass: AssetClass,
  currency: Currency,
): "twelvedata" | "eodhd" {
  if (currency === "CAD") return "eodhd";
  return "twelvedata";
}
