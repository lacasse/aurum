"use client";

import {
  Account,
  Budget,
  Currency,
  Holding,
  isLiability,
  Transaction,
} from "./types";
import {
  currentMonthKey,
  labelMonth,
  lastMonthKeys,
  monthKeyOf,
} from "./format";
import {
  fromCents,
  roundMoney,
  subtractMoney,
  sumMoney,
  sumProducts,
  toCents,
} from "./money";


export interface NetWorthPoint {
  key: string;
  label: string;
  assets: number;
  liabilities: number;
  portfolio: number;
  net: number;
}

export function accountValueAt(acc: Account, monthKey: string): number {
  const pt = acc.history.find((p) => p.month === monthKey);
  if (pt) return pt.value;
  if (acc.history.length > 0) return acc.history[0].value; // backfill with earliest
  return acc.balance;
}

function portfolioValueAt(holdings: Holding[], monthsAgoFromEnd: number): number {
  return sumProducts(
    holdings.map((h) => {
      const hist = h.historyCAD ?? h.history;
      const idx = hist.length - 1 - monthsAgoFromEnd;
      const px =
        hist[Math.max(0, Math.min(hist.length - 1, idx))] ?? h.priceCAD ?? h.price;
      return [h.shares, px] as const;
    }),
  );
}

export function netWorthSeries(
  accounts: Account[],
  holdings: Holding[],
  n = 18,
): NetWorthPoint[] {
  const keys = lastMonthKeys(n);
  return keys.map((key, i) => {
    let assetCents = 0;
    let liabilityCents = 0;
    for (const acc of accounts) {
      const v = toCents(accountValueAt(acc, key));
      if (isLiability(acc.kind)) liabilityCents += v;
      else assetCents += v;
    }
    const portfolio = portfolioValueAt(holdings, keys.length - 1 - i);
    return {
      key,
      label: labelMonth(key),
      assets: fromCents(assetCents),
      liabilities: fromCents(liabilityCents),
      portfolio,
      net: fromCents(assetCents + toCents(portfolio) - liabilityCents),
    };
  });
}

export interface CashflowPoint {
  key: string;
  label: string;
  income: number;
  expenses: number;
  net: number;
}

export function cashflowSeries(transactions: Transaction[], n = 12): CashflowPoint[] {
  const keys = lastMonthKeys(n);
  const map = new Map<string, { income: number; expenses: number }>();
  for (const k of keys) map.set(k, { income: 0, expenses: 0 });
  for (const t of transactions) {
    const k = monthKeyOf(t.date);
    const slot = map.get(k);
    if (!slot) continue;
    if (t.type === "income") slot.income += toCents(t.amount);
    else if (t.type === "expense") slot.expenses += toCents(t.amount);
  }
  return keys.map((key) => {
    const { income, expenses } = map.get(key)!;
    return {
      key,
      label: labelMonth(key),
      income: fromCents(income),
      expenses: fromCents(expenses),
      net: fromCents(income - expenses),
    };
  });
}

export function spendByCategory(
  transactions: Transaction[],
  monthKey?: string,
): { name: string; value: number }[] {
  const totals = new Map<string, number>();
  for (const t of transactions) {
    if (t.type !== "expense") continue;
    if (monthKey && monthKeyOf(t.date) !== monthKey) continue;
    totals.set(t.category, (totals.get(t.category) ?? 0) + toCents(t.amount));
  }
  return [...totals.entries()]
    .map(([name, cents]) => ({ name, value: fromCents(cents) }))
    .sort((a, b) => b.value - a.value);
}

/** Monthly totals for each of the given categories (top-N spending). */
export function stackedSpend(
  transactions: Transaction[],
  categories: string[],
  n = 12,
): Record<string, number | string>[] {
  const keys = lastMonthKeys(n);
  return keys.map((key) => {
    const cents = new Map<string, number>(categories.map((c) => [c, 0]));
    for (const t of transactions) {
      if (t.type !== "expense") continue;
      if (monthKeyOf(t.date) !== key) continue;
      if (!cents.has(t.category)) continue;
      cents.set(t.category, cents.get(t.category)! + toCents(t.amount));
    }
    const row: Record<string, number | string> = { key, label: labelMonth(key) };
    for (const [category, total] of cents) row[category] = fromCents(total);
    return row;
  });
}

export interface PortfolioPoint {
  key: string;
  label: string;
  value: number;
  cost: number;
}

export function portfolioSeries(holdings: Holding[], n = 18): PortfolioPoint[] {
  const keys = lastMonthKeys(Math.min(n, 18));
  const totalCost = sumProducts(
    holdings.map((h) => [h.shares, h.avgCostCAD ?? h.avgCost] as const),
  );
  return keys.map((key, i) => ({
    key,
    label: labelMonth(key),
    value: portfolioValueAt(holdings, keys.length - 1 - i),
    cost: totalCost,
  }));
}

export function allocationByClass(
  holdings: Holding[],
): { name: string; value: number }[] {
  const totals = new Map<string, number>();
  for (const h of holdings) {
    const px = h.priceCAD ?? h.price;
    totals.set(h.assetClass, (totals.get(h.assetClass) ?? 0) + toCents(h.shares * px));
  }
  return [...totals.entries()].map(([name, cents]) => ({
    name,
    value: fromCents(cents),
  }));
}

export function sectorExposure(
  holdings: Holding[],
): { sector: string; value: number }[] {
  const totals = new Map<string, number>();
  for (const h of holdings) {
    const px = h.priceCAD ?? h.price;
    totals.set(h.sector, (totals.get(h.sector) ?? 0) + toCents(h.shares * px));
  }
  const rows = [...totals.entries()].map(([sector, cents]) => ({
    sector,
    value: fromCents(cents),
  }));
  rows.sort((a, b) => b.value - a.value);
  if (rows.length <= 6) return rows;
  const top = rows.slice(0, 5);
  const other = sumMoney(rows.slice(5).map((r) => r.value));
  top.push({ sector: "Other", value: other });
  return top;
}

/**
 * One row per security, pooling every account that holds it.
 *
 * Positions are stored per account because that is what is true — the same
 * ticker bought in a TFSA and in a non-registered account has a different cost
 * basis and a different tax treatment, and merging them in the database would
 * throw that away. But a portfolio is read per security: "how much NVDA do I
 * own, and how has it done" is one question, not one question per account. So
 * the pooling happens here, at the point of display, and `lots` keeps the
 * per-account detail available for anything that needs it.
 */
export interface HoldingRow {
  /** Every stored position for this ticker, one per account. */
  lots: Holding[];
  /** The accounts this ticker sits in — one tag each on the holdings page. */
  accountIds: string[];
  ticker: string;
  name: string;
  currency: Currency;
  /** Combined across accounts. */
  shares: number;
  /** Share-weighted across accounts, in CAD. */
  avgCostCAD: number;
  priceCAD: number;
  marketValue: number;
  costBasis: number;
  gain: number;
  totalDividends: number;
  totalReturn: number;
  mwrr: number; // annualized money-weighted rate of return (%)
  weightPct: number;
  change1mPct: number;
}

/** Annualized MWRR for a buy-and-hold position with dividends. */
function computeMwrr(
  costBasis: number,
  marketValue: number,
  dividendsReceived: number,
  months: number,
): number {
  if (costBasis <= 0 || months <= 0) return 0;
  const totalValue = marketValue + dividendsReceived;
  const periodReturn = (totalValue - costBasis) / costBasis;
  const annualized = (1 + periodReturn) ** (12 / months) - 1;
  return annualized * 100;
}

/**
 * Group stored positions by ticker.
 *
 * Cost basis is summed rather than averaged: the share-weighted average cost
 * falls out of dividing the pooled basis by the pooled share count, which is
 * the only way to combine two lots bought at different prices without
 * distorting either. MWRR then composes for free, since it is computed from
 * the pooled basis, value and dividends.
 */
export function consolidateHoldings(holdings: Holding[]): HoldingRow[] {
  const groups = new Map<string, Holding[]>();
  for (const h of holdings) {
    const key = h.ticker.trim().toUpperCase();
    const bucket = groups.get(key);
    if (bucket) bucket.push(h);
    else groups.set(key, [h]);
  }

  const rows = [...groups.values()].map((lots) => {
    const shares = lots.reduce((sum, h) => sum + h.shares, 0);
    const costBasis = roundMoney(
      lots.reduce((sum, h) => sum + h.shares * (h.avgCostCAD ?? h.avgCost), 0),
    );
    const totalDividends = roundMoney(
      lots.reduce((sum, h) => sum + (h.dividendsReceivedCAD ?? h.dividendsReceived ?? 0), 0),
    );
    // Same security, so the price is the same wherever it is held; the lots
    // only disagree when one has never been priced.
    const priced = lots.find((h) => (h.priceCAD ?? h.price) > 0) ?? lots[0];
    const priceCAD = priced.priceCAD ?? priced.price;
    const hist = priced.historyCAD ?? priced.history;
    const prev = hist.length > 1 ? hist[hist.length - 2] : priceCAD;

    const marketValue = roundMoney(shares * priceCAD);
    const gain = subtractMoney(marketValue, costBasis);

    return {
      lots,
      // De-duplicated, because two lots of the same ticker in one account
      // would otherwise tag it twice.
      accountIds: [...new Set(lots.map((h) => h.accountId))],
      ticker: priced.ticker,
      name: priced.name,
      currency: priced.currency,
      shares: Math.round(shares * 1e8) / 1e8,
      avgCostCAD: shares > 0 ? costBasis / shares : 0,
      priceCAD,
      marketValue,
      costBasis,
      gain,
      totalDividends,
      totalReturn: roundMoney(gain + totalDividends),
      mwrr: computeMwrr(costBasis, marketValue, totalDividends, 18),
      weightPct: 0,
      change1mPct: prev > 0 ? ((priceCAD - prev) / prev) * 100 : 0,
    };
  });

  const totalValue = sumMoney(rows.map((r) => r.marketValue));
  for (const r of rows) {
    r.weightPct = totalValue > 0 ? (r.marketValue / totalValue) * 100 : 0;
  }
  return rows.sort((a, b) => b.marketValue - a.marketValue);
}

export function holdingRows(holdings: Holding[]): HoldingRow[] {
  return consolidateHoldings(holdings);
}

/** The columns the holdings table can be ordered by. */
export type SortKey =
  | "name"
  | "shares"
  | "avgCostCAD"
  | "priceCAD"
  | "marketValue"
  | "totalDividends"
  | "totalReturn"
  | "mwrr"
  | "weightPct";

/**
 * Order rows by one column.
 *
 * The name column sorts on the security's name, since that is what the table
 * now leads with, and falls back to the ticker for anything unnamed. Ties break
 * on market value so the order is stable and predictable rather than depending
 * on which lot happened to be stored first.
 */
export function sortHoldingRows(
  rows: HoldingRow[],
  key: SortKey,
  dir: "asc" | "desc",
): HoldingRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === "name") {
      const cmp = (a.name || a.ticker).localeCompare(b.name || b.ticker, undefined, {
        sensitivity: "base",
      });
      return cmp !== 0 ? cmp * sign : b.marketValue - a.marketValue;
    }
    const diff = a[key] - b[key];
    return diff !== 0 ? diff * sign : b.marketValue - a.marketValue;
  });
}

export interface BudgetRow {
  category: string;
  limit: number;
  spent: number;
  remaining: number;
  pct: number;
}

export function budgetRows(
  budgets: Budget[],
  transactions: Transaction[],
  monthKey = currentMonthKey(),
): BudgetRow[] {
  return budgets
    .map((b) => {
      const spent = sumMoney(
        transactions
          .filter(
            (t) =>
              t.type === "expense" &&
              t.category === b.category &&
              monthKeyOf(t.date) === monthKey,
          )
          .map((t) => t.amount),
      );
      return {
        category: b.category,
        limit: b.limit,
        spent,
        remaining: subtractMoney(b.limit, spent),
        pct: b.limit > 0 ? (spent / b.limit) * 100 : 0,
      };
    })
    .sort((a, b) => b.pct - a.pct);
}

export interface MonthTotals {
  income: number;
  expenses: number;
  net: number;
  savingsRate: number;
}

export function monthTotals(
  transactions: Transaction[],
  monthKey = currentMonthKey(),
): MonthTotals {
  let incomeCents = 0;
  let expenseCents = 0;
  for (const t of transactions) {
    if (monthKeyOf(t.date) !== monthKey) continue;
    if (t.type === "income") incomeCents += toCents(t.amount);
    else if (t.type === "expense") expenseCents += toCents(t.amount);
  }
  const income = fromCents(incomeCents);
  const expenses = fromCents(expenseCents);
  return {
    income,
    expenses,
    net: fromCents(incomeCents - expenseCents),
    savingsRate:
      incomeCents > 0
        ? ((incomeCents - expenseCents) / incomeCents) * 100
        : 0,
  };
}
