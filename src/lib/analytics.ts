"use client";

import {
  Account,
  Budget,
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
  let total = 0;
  for (const h of holdings) {
    const hist = h.historyCAD ?? h.history;
    const idx = hist.length - 1 - monthsAgoFromEnd;
    total += h.shares * (hist[Math.max(0, Math.min(hist.length - 1, idx))] ?? h.priceCAD ?? h.price);
  }
  return total;
}

export function netWorthSeries(
  accounts: Account[],
  holdings: Holding[],
  n = 18,
): NetWorthPoint[] {
  const keys = lastMonthKeys(n);
  return keys.map((key, i) => {
    let assets = 0;
    let liabilities = 0;
    for (const acc of accounts) {
      const v = accountValueAt(acc, key);
      if (isLiability(acc.kind)) liabilities += v;
      else assets += v;
    }
    const portfolio = portfolioValueAt(holdings, keys.length - 1 - i);
    return {
      key,
      label: labelMonth(key),
      assets,
      liabilities,
      portfolio,
      net: assets + portfolio - liabilities,
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
    if (t.type === "income") slot.income += t.amount;
    else slot.expenses += t.amount;
  }
  return keys.map((key) => {
    const { income, expenses } = map.get(key)!;
    return { key, label: labelMonth(key), income, expenses, net: income - expenses };
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
    totals.set(t.category, (totals.get(t.category) ?? 0) + t.amount);
  }
  return [...totals.entries()]
    .map(([name, value]) => ({ name, value }))
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
    const row: Record<string, number | string> = { key, label: labelMonth(key) };
    for (const c of categories) row[c] = 0;
    for (const t of transactions) {
      if (t.type !== "expense") continue;
      if (monthKeyOf(t.date) !== key) continue;
      if (!(t.category in row)) continue;
      row[t.category] = (row[t.category] as number) + t.amount;
    }
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
  const totalCost = holdings.reduce((s, h) => s + h.shares * (h.avgCostCAD ?? h.avgCost), 0);
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
    totals.set(h.assetClass, (totals.get(h.assetClass) ?? 0) + h.shares * px);
  }
  return [...totals.entries()].map(([name, value]) => ({ name, value }));
}

export function sectorExposure(
  holdings: Holding[],
): { sector: string; value: number }[] {
  const totals = new Map<string, number>();
  for (const h of holdings) {
    const px = h.priceCAD ?? h.price;
    totals.set(h.sector, (totals.get(h.sector) ?? 0) + h.shares * px);
  }
  const rows = [...totals.entries()].map(([sector, value]) => ({ sector, value }));
  rows.sort((a, b) => b.value - a.value);
  if (rows.length <= 6) return rows;
  const top = rows.slice(0, 5);
  const other = rows.slice(5).reduce((s, r) => s + r.value, 0);
  top.push({ sector: "Other", value: other });
  return top;
}

export interface HoldingRow {
  holding: Holding;
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

export function holdingRows(holdings: Holding[]): HoldingRow[] {
  const totalValue = holdings.reduce((s, h) => s + h.shares * (h.priceCAD ?? h.price), 0);
  return holdings
    .map((h) => {
      const px = h.priceCAD ?? h.price;
      const avgC = h.avgCostCAD ?? h.avgCost;
      const divs = h.dividendsReceivedCAD ?? h.dividendsReceived ?? 0;
      const hist = h.historyCAD ?? h.history;
      const marketValue = h.shares * px;
      const costBasis = h.shares * avgC;
      const prev =
        hist.length > 1 ? hist[hist.length - 2] : px;
      const gain = marketValue - costBasis;
      const totalReturn = gain + divs;
      const mwrr = computeMwrr(costBasis, marketValue, divs, 18);
      return {
        holding: h,
        marketValue,
        costBasis,
        gain,
        totalDividends: divs,
        totalReturn,
        mwrr,
        weightPct: totalValue > 0 ? (marketValue / totalValue) * 100 : 0,
        change1mPct: prev > 0 ? ((px - prev) / prev) * 100 : 0,
      };
    })
    .sort((a, b) => b.marketValue - a.marketValue);
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
      const spent = transactions
        .filter(
          (t) =>
            t.type === "expense" &&
            t.category === b.category &&
            monthKeyOf(t.date) === monthKey,
        )
        .reduce((s, t) => s + t.amount, 0);
      return {
        category: b.category,
        limit: b.limit,
        spent,
        remaining: b.limit - spent,
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
  let income = 0;
  let expenses = 0;
  for (const t of transactions) {
    if (monthKeyOf(t.date) !== monthKey) continue;
    if (t.type === "income") income += t.amount;
    else expenses += t.amount;
  }
  return {
    income,
    expenses,
    net: income - expenses,
    savingsRate: income > 0 ? ((income - expenses) / income) * 100 : 0,
  };
}
