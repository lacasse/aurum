import { isCoinTicker } from "./market";
import { rewardFlows } from "./rewards";
import type { AssetClass, CashFlow, Currency, Holding } from "./types";
import { movementApplies } from "./types";

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
  /**
   * Faults in the positions this batch would leave behind — see
   * `holdingProblems`. Carried rather than thrown: the batch is still valid
   * arithmetic, and the caller is the one that can put the warning in front of
   * someone before it is committed.
   */
  warnings: string[];
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
 * The suffix this app writes on a Canadian Depositary Receipt.
 *
 * A CDR is not the US share on another venue. It is a separate instrument with
 * its own price, its own currency and its own cost base: a receipt can trade
 * near thirty Canadian dollars while the share it tracks trades near five
 * hundred US. Holding one says nothing about holding the other, and a
 * trade in one has no bearing on the basis of the other.
 */
const CDR_SUFFIX = ".NEO";

/**
 * Whether a security row from a broker export describes a CDR.
 *
 * The export is not as clear as it looks: it writes a CDR under the **bare**
 * symbol, so `TSLA` in an activity file is the CAD-hedged receipt, not the US
 * share. The symbol alone therefore cannot tell them apart, and matching on it
 * is wrong the moment someone holds both.
 *
 * The name can. Every CDR is named as one — "Tesla CDR (CAD Hedged)" — and the
 * currency corroborates it. The name is the test rather than the currency
 * because plenty of ordinary securities trade in Canadian dollars; only a
 * receipt says CDR.
 */
export function isCdr(name: string, currency?: string): boolean {
  if (!/\bCDR\b/i.test(name)) return false;
  // A row naming itself a CDR but settling in US dollars is not one this app
  // knows how to file, so it is left as an ordinary US listing.
  return currency === undefined || currency.trim().toUpperCase() === "CAD";
}

/**
 * The ticker a broker's security row should be filed under.
 *
 * This is where the export's own information is used instead of discarded. A
 * CDR becomes `SYMBOL.NEO`, matching how the position is kept; anything else
 * keeps the symbol as written.
 */
export function tickerForSecurity(
  symbol: string,
  name = "",
  currency?: string,
): string {
  const s = symbol.trim().toUpperCase();
  if (!s) return s;
  if (!isCdr(name, currency)) return s;
  return s.endsWith(CDR_SUFFIX) ? s : `${s}${CDR_SUFFIX}`;
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
  currency?: string,
): string {
  const t = raw.trim().toUpperCase();
  /*
   * A match may never cross currencies.
   *
   * Stripping the venue is right for a venue — a broker writing XEQT where the
   * position is XEQT.TO — and wrong for a CDR, because `.NEO` is not a venue
   * there. `baseTicker("ZQX.NEO")` is "ZQX", so a trade in the US listing
   * matched the Canadian receipt and was absorbed into it — shares filed as
   * receipts and priced as receipts, at a twentieth of what they were worth,
   * showing a loss that never happened.
   *
   * The listing currency is what separates them, and it is on every row of the
   * export. Two securities quoted in different currencies are two securities,
   * whatever their symbols share.
   */
  const cur = currency?.trim().toUpperCase();
  const candidates = cur
    ? holdings.filter((h) => (h.currency ?? "").toUpperCase() === cur)
    : holdings;

  if (candidates.some((h) => h.ticker.toUpperCase() === t)) return t;

  const base = baseTicker(t);
  const matches = candidates.filter((h) => baseTicker(h.ticker) === base);
  if (matches.length === 0) return t;
  if (matches.length === 1) return matches[0].ticker.toUpperCase();

  const inAccount = matches.filter((h) => h.accountId === accountId);
  return inAccount.length === 1 ? inAccount[0].ticker.toUpperCase() : t;
}

/**
 * Ways a set of holdings can be wrong that no single row looks wrong in.
 *
 * Every trade that produced the fault this checks for was individually
 * correct: the right security, the right quantity, the right price. What was
 * wrong was which position they landed on, and that is only visible once the
 * positions are looked at together — which is why it went unnoticed for
 * fourteen months and roughly seventeen thousand dollars of misvaluation.
 *
 * Reported rather than thrown. The caller decides whether this is a refusal
 * (an import, which can be corrected before it commits) or a warning (a record
 * already stored, where the fix is a repair and not a rejection).
 */
export function holdingProblems(holdings: Holding[]): string[] {
  const problems: string[] = [];

  // A receipt is CAD-hedged by construction. One denominated in anything else
  // is a US listing wearing a receipt's ticker, which is exactly the fault.
  for (const h of holdings) {
    const t = h.ticker.trim().toUpperCase();
    if (t.endsWith(CDR_SUFFIX) && (h.currency ?? "").toUpperCase() !== "CAD") {
      problems.push(`${h.ticker} is a CDR ticker but is held in ${h.currency}`);
    }
  }

  // Two positions in one account that differ only by venue are the duplicate
  // this app already had once. Differing by currency is not a duplicate: that
  // is a receipt and its underlying, legitimately held side by side.
  const byKey = new Map<string, Holding[]>();
  for (const h of holdings) {
    const key = `${baseTicker(h.ticker)}|${(h.currency ?? "").toUpperCase()}|${h.accountId}`;
    byKey.set(key, [...(byKey.get(key) ?? []), h]);
  }
  for (const [, group] of byKey) {
    if (group.length > 1) {
      problems.push(
        `${group.map((h) => h.ticker).join(" and ")} are the same security in one account`,
      );
    }
  }

  return problems;
}

export function newPositionsNeeded(
  rows: TradeInput[],
  holdings: Holding[],
): NewPositionMeta[] {
  const needed: NewPositionMeta[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (isBlankTrade(row)) continue;
    const ticker = resolveTicker(row.ticker, holdings, row.accountId, row.currency);
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
  /*
   * The day each account's balance was last stated by hand. A trade dated on
   * or before it is already inside that figure, so its cash side is dropped —
   * the position is still built from it. Defaults to no anchor anywhere, which
   * is the behaviour every caller had before.
   */
  balanceAnchorFor: (accountId: string) => string | null | undefined = () => null,
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
  const moveCash = (accountId: string, delta: number, onDate: string) => {
    if (!movementApplies({ balanceAsOf: balanceAnchorFor(accountId) }, onDate)) return;
    cashDeltas.set(accountId, (cashDeltas.get(accountId) ?? 0) + delta);
  };

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
    const ticker = resolveTicker(row.ticker, holdings, row.accountId, row.currency);
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
      moveCash(row.accountId, -Math.abs(costCad), row.date);
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
      moveCash(row.accountId, Math.abs(proceedsCad), row.date);
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
      moveCash(row.accountId, cadAmount, row.date);
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

  /*
   * Check the positions this batch would leave, not the rows that make it up.
   * Every row of the import that filed US shares onto a Canadian receipt was
   * individually correct; what was wrong was only visible once the positions
   * were looked at together.
   */
  const touched = new Set(
    changes.map((c) => c.existing?.id ?? `new|${c.ticker}|${c.accountId}`),
  );
  const projected: Holding[] = [
    ...holdings.filter((h) => !touched.has(h.id)),
    ...changes.map(
      (c) =>
        ({
          id: c.existing?.id ?? `new|${c.ticker}|${c.accountId}`,
          ticker: c.ticker,
          accountId: c.accountId,
          currency: c.currency,
          shares: c.shares,
        }) as Holding,
    ),
  ];

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
      warnings: holdingProblems(projected),
    },
  };
}
