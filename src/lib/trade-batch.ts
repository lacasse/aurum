import { isCoinTicker } from "./market";
import { rewardFlows } from "./rewards";
import type { AssetClass, CashFlow, Currency, Holding } from "./types";

/**
 * What a batch of hand-entered trades does to the portfolio, worked out before
 * any of it is done.
 *
 * This used to live inside the trade form, which meant it could only run at
 * the moment the button was pressed. The monthly checklist needs the same
 * arithmetic an hour earlier — to show what a step *would* write while writing
 * nothing — so the calculation is separated from the act. `planTrades`
 * decides; the caller applies, whenever it likes.
 *
 * It is also the part most worth testing, and as UI code it never was.
 */

/** A row as the form holds it: strings, because that is what is typed. */
export interface TradeInput {
  date: string;
  action: "buy" | "sell" | "dividend" | "reward";
  ticker: string;
  quantity: string;
  price: string;
  accountId: string;
  currency: string;
  cadAmount: string;
}

/** Identity for a ticker nobody has held before, which no trade row carries. */
export interface NewPositionMeta {
  ticker: string;
  name: string;
  assetClass: AssetClass;
}

export interface HoldingChange {
  ticker: string;
  accountId: string;
  shares: number;
  avgCost: number;
  dividendsReceived: number;
  price: number;
  currency: Currency;
  flows: CashFlow[];
  /** The position being changed, or null when the batch opens a new one. */
  existing: Holding | null;
  /** Name and asset class, for a position being opened. */
  name: string;
  assetClass: AssetClass;
}

export interface TradeBatch {
  changes: HoldingChange[];
  /** Net cash movement per account, applied once rather than row by row. */
  cash: { accountId: string; delta: number }[];
  /** Rows that carried a trade, ignoring the blank one at the end. */
  trades: number;
  /** How many of the changes open a position that did not exist. */
  created: number;
}

export type TradePlan =
  | { ok: true; batch: TradeBatch }
  | { ok: false; error: string };

/** A trailing row nobody has touched yet is not a trade. */
export function isBlankTrade(row: TradeInput): boolean {
  return (
    !row.ticker.trim() &&
    !row.quantity.trim() &&
    !row.price.trim() &&
    !row.cadAmount.trim()
  );
}

/**
 * Tickers in the batch that no holding covers yet.
 *
 * Buying a ticker with no position behind it opens one, and a position needs a
 * name and an asset class that no trade row carries. Asked for once per
 * ticker rather than guessed: the asset class picks the price feed, and a coin
 * routed as an equity comes back rejected.
 */
/**
 * The exchange suffix a Canadian broker puts on a symbol, which the app's own
 * ticker may or may not carry.
 */
const EXCHANGE_SUFFIX = /\.(TO|TSX|NEO|NE|V|CN|CNQ|US)$/;

/** "TSLA.NEO" -> "TSLA". The symbol without the venue it traded on. */
export function baseTicker(ticker: string): string {
  return ticker.trim().toUpperCase().replace(EXCHANGE_SUFFIX, "");
}

/**
 * The ticker an imported row is really about, in the spelling already held.
 *
 * A broker's activity export writes the venue into the symbol — TSLA.NEO,
 * XEQT.TO — and a position opened under the plain symbol then looks like an
 * asset nobody owns, so a routine buy asked to describe a "new position" and
 * opened a second holding beside the first. Matching on the symbol without its
 * venue is what stops that.
 *
 * An exact match always wins. Where the venue-less symbol matches more than one
 * holding, the one in the same account decides; failing that the row is left
 * exactly as written, because guessing which of two positions a trade belongs
 * to is worse than asking.
 */
export function resolveTicker(
  raw: string,
  holdings: Holding[],
  accountId?: string,
): string {
  const t = raw.trim().toUpperCase();
  if (holdings.some((h) => h.ticker.toUpperCase() === t)) return t;

  const base = baseTicker(t);
  const matches = holdings.filter((h) => baseTicker(h.ticker) === base);
  if (matches.length === 0) return t;
  if (matches.length === 1) return matches[0].ticker.toUpperCase();

  const inAccount = matches.filter((h) => h.accountId === accountId);
  return inAccount.length === 1 ? inAccount[0].ticker.toUpperCase() : t;
}

export function newPositionsNeeded(
  rows: TradeInput[],
  holdings: Holding[],
): NewPositionMeta[] {
  const needed: NewPositionMeta[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (isBlankTrade(row)) continue;
    const ticker = resolveTicker(row.ticker, holdings, row.accountId);
    if ((row.action !== "buy" && row.action !== "reward") || seen.has(ticker)) continue;
    if (holdings.some((h) => h.ticker.toUpperCase() === ticker)) continue;
    seen.add(ticker);
    needed.push({
      ticker,
      name: "",
      assetClass: isCoinTicker(ticker) ? "Crypto" : "US Equity",
    });
  }
  return needed;
}

interface WorkingLot {
  ticker: string;
  existing: Holding | null;
  accountId: string;
  currency: string;
  shares: number;
  avgCost: number;
  dividends: number;
  price: number;
  flows: CashFlow[];
}

export function planTrades(
  rows: TradeInput[],
  meta: NewPositionMeta[],
  holdings: Holding[],
  usdCadRate: number,
): TradePlan {
  const byTicker = new Map(meta.map((m) => [m.ticker, m]));
  const active = rows.filter((r) => !isBlankTrade(r));
  if (active.length === 0) return { ok: false, error: "Enter at least one trade." };
  for (const row of active) {
    if (!row.ticker.trim()) {
      return { ok: false, error: "Ticker is required on every row." };
    }
  }

  const cashDeltas = new Map<string, number>();

  /*
   * A batch can touch the same position on several rows, but `holdings` is a
   * snapshot that does not move between them. Rows are replayed onto this
   * working copy and each position is written back exactly once, so a second
   * buy of the same ticker builds on the first rather than overwriting it —
   * or, for a ticker that is new, opening a duplicate.
   *
   * Keyed by ticker *and* account, because one ticker held in two accounts is
   * two positions with their own cost bases.
   */
  const lots = new Map<string, WorkingLot>();
  const lotFor = (ticker: string, row: TradeInput): WorkingLot => {
    const key = `${ticker} ${row.accountId}`;
    const found = lots.get(key);
    if (found) return found;
    const existing =
      holdings.find(
        (h) => h.ticker.toUpperCase() === ticker && h.accountId === row.accountId,
      ) ?? null;
    const lot: WorkingLot = {
      ticker,
      existing,
      accountId: row.accountId,
      currency: existing?.currency ?? row.currency,
      shares: existing?.shares ?? 0,
      avgCost: existing?.avgCost ?? 0,
      dividends: existing?.dividendsReceived ?? 0,
      price: existing?.price ?? 0,
      flows: [...(existing?.flows ?? [])],
    };
    lots.set(key, lot);
    return lot;
  };

  for (const row of active) {
    const ticker = resolveTicker(row.ticker, holdings, row.accountId);
    const qty = Number(row.quantity);
    const px = Number(row.price);
    const isUsd = row.currency === "USD";
    const lot = lotFor(ticker, row);
    const held = lot.existing != null || lot.shares > 0;

    if (row.action === "buy") {
      if (!Number.isFinite(qty) || qty <= 0) {
        return { ok: false, error: `Buy ${ticker}: quantity must be > 0.` };
      }
      if (!Number.isFinite(px) || px <= 0) {
        return { ok: false, error: `Buy ${ticker}: price must be > 0.` };
      }
      const costCad = isUsd ? Number(row.cadAmount) || qty * px * usdCadRate : qty * px;
      // The cash that paid for the shares leaves the account's balance; the
      // shares themselves are valued from the holding.
      cashDeltas.set(
        row.accountId,
        (cashDeltas.get(row.accountId) ?? 0) - Math.abs(costCad),
      );
      const newShares = lot.shares + qty;
      lot.avgCost =
        lot.shares > 0 ? (lot.shares * lot.avgCost + costCad) / newShares : costCad / qty;
      lot.shares = newShares;
      if (lot.price <= 0) lot.price = px;
      lot.flows.push({
        date: row.date,
        kind: "buy",
        amount: Math.abs(costCad),
        shares: qty,
      });
    } else if (row.action === "sell") {
      if (!Number.isFinite(qty) || qty <= 0) {
        return { ok: false, error: `Sell ${ticker}: quantity must be > 0.` };
      }
      if (!held) return { ok: false, error: `Sell ${ticker}: no position found.` };
      if (qty > lot.shares) {
        return {
          ok: false,
          error: `Sell ${ticker}: cannot sell ${qty} shares, only ${lot.shares} held.`,
        };
      }
      const proceedsCad = isUsd
        ? Number(row.cadAmount) || qty * px * usdCadRate
        : qty * px;
      cashDeltas.set(
        row.accountId,
        (cashDeltas.get(row.accountId) ?? 0) + Math.abs(proceedsCad),
      );
      lot.shares -= qty;
      lot.flows.push({
        date: row.date,
        kind: "sell",
        amount: Math.abs(proceedsCad),
        shares: -qty,
      });
    } else if (row.action === "reward") {
      /*
       * Tokens that arrived without being bought: income equal to what they
       * were worth that day, and an acquisition at that same value. Leaving
       * the price empty records the units and lists the reward for the figure
       * to be filled in later — better than calling them free, which is what
       * makes every dollar they later fetch look like profit.
       */
      if (!Number.isFinite(qty) || qty <= 0) {
        return { ok: false, error: `Reward ${ticker}: quantity must be > 0.` };
      }
      const perUnit = row.price.trim() === "" ? 0 : px;
      if (!Number.isFinite(perUnit) || perUnit < 0) {
        return {
          ok: false,
          error: `Reward ${ticker}: value must be a number, or left empty.`,
        };
      }
      const valueCad = isUsd
        ? Number(row.cadAmount) || qty * perUnit * usdCadRate
        : qty * perUnit;
      // No cash moves: a reward is paid in tokens, so nothing arrives in the
      // account's balance the way a distribution would.
      const newShares = lot.shares + qty;
      lot.avgCost =
        lot.shares > 0 ? (lot.shares * lot.avgCost + valueCad) / newShares : valueCad / qty;
      lot.shares = newShares;
      if (lot.price <= 0 && perUnit > 0) lot.price = perUnit;
      if (valueCad > 0) lot.dividends += valueCad;
      lot.flows.push(...rewardFlows(row.date, qty, valueCad));
    } else if (row.action === "dividend") {
      const cadAmount = isUsd ? Number(row.cadAmount) || 0 : Number(row.price) || 0;
      if (!Number.isFinite(cadAmount) || cadAmount <= 0) {
        return { ok: false, error: `Dividend ${ticker}: amount must be > 0.` };
      }
      if (!held) {
        return { ok: false, error: `Dividend ${ticker}: no position found to credit.` };
      }
      cashDeltas.set(
        row.accountId,
        (cashDeltas.get(row.accountId) ?? 0) + cadAmount,
      );
      lot.dividends += cadAmount;
      lot.flows.push({
        date: row.date,
        kind: "dividend",
        amount: cadAmount,
        shares: 0,
      });
    }
  }

  // Nothing below can fail, so a batch either plans completely or not at all:
  // an error above abandons the whole thing, and the cash must not move for
  // trades that were never posted.
  const changes: HoldingChange[] = [];
  let created = 0;
  for (const lot of lots.values()) {
    // A ticker already held in another account keeps that position's identity;
    // only one nobody has held before needs to be described.
    const sibling = holdings.find((h) => h.ticker.toUpperCase() === lot.ticker);
    const m = byTicker.get(lot.ticker);
    if (!lot.existing && !m && !sibling) {
      return { ok: false, error: `${lot.ticker}: missing position details.` };
    }
    if (!lot.existing) created++;
    changes.push({
      ticker: lot.ticker,
      accountId: lot.accountId,
      shares: Math.round(lot.shares * 1e8) / 1e8,
      avgCost: Math.round(lot.avgCost * 10000) / 10000,
      dividendsReceived: Math.round(lot.dividends * 100) / 100,
      price: lot.price,
      currency: lot.currency as Currency,
      flows: lot.flows,
      existing: lot.existing,
      name: m?.name ?? sibling?.name ?? lot.ticker,
      assetClass: m?.assetClass ?? sibling?.assetClass ?? "US Equity",
    });
  }

  return {
    ok: true,
    batch: {
      changes,
      cash: [...cashDeltas].map(([accountId, delta]) => ({
        accountId,
        delta: Math.round(delta * 100) / 100,
      })),
      trades: active.length,
      created,
    },
  };
}
