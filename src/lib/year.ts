import { NON_SPENDABLE_INCOME, chainedReturns } from "./analytics";
import type { NetWorthPoint, PortfolioPoint } from "./analytics";
import { Transaction } from "./types";
import { fromCents, roundMoney, toCents } from "./money";

/**
 * A year at a time.
 *
 * Everything here exists month by month somewhere in the app already. What a
 * year adds is the comparison: a month tells you how you are doing and a year
 * tells you whether that is better than last time, which is the question the
 * spreadsheet's own Year sheet was built to answer.
 *
 * The year in progress is included and flagged rather than hidden. It is the
 * one everybody actually wants to look at, and it is only misleading if it is
 * presented as finished.
 */

export interface YearRow {
  year: string;
  /** False for the year still running. */
  complete: boolean;
  income: number;
  expenses: number;
  /** Change in spending against the year before, as a percentage. */
  expenseGrowth: number | null;
  /** Everything in, less everything out. */
  netCashflow: number;
  /** The same, counting only income that lands somewhere spendable. */
  uncommittedLiquid: number;
  savingsRate: number | null;
  /** Net worth at the end of the year, or as it stands for the year running. */
  netWorth: number;
  netWorthChange: number | null;
  portfolio: number;
  costBasis: number;
  /** What the portfolio is worth above what it cost. */
  investmentProfit: number;
  /** Money put into holdings that year, less money taken out. */
  investmentFlows: number;
  /** The portfolio's return for the year, with the effect of deposits removed. */
  portfolioReturn: number | null;
  /** Compound annual growth in net worth since the record began. */
  cagr: number | null;
}

/** The last month of a year that the series actually covers. */
function lastMonthOf(year: string, months: string[]): string | undefined {
  let found: string | undefined;
  for (const m of months) if (m.startsWith(year)) found = m;
  return found;
}

export function yearRows(
  transactions: Transaction[],
  netWorth: readonly NetWorthPoint[],
  portfolio: readonly PortfolioPoint[],
  flowsByMonth: Readonly<Record<string, number>>,
  today = new Date().toISOString().slice(0, 10),
): YearRow[] {
  const months = netWorth.map((p) => p.key);
  const nwByMonth = new Map(netWorth.map((p) => [p.key, p]));
  const portByMonth = new Map(portfolio.map((p) => [p.key, p]));
  const currentYear = today.slice(0, 4);

  const cents = new Map<
    string,
    { income: number; expenses: number; spendable: number }
  >();
  for (const t of transactions) {
    const key = t.date.slice(0, 4);
    const slot = cents.get(key) ?? { income: 0, expenses: 0, spendable: 0 };
    const amount = toCents(t.amount);
    if (t.type === "income") {
      slot.income += amount;
      if (!NON_SPENDABLE_INCOME.has(t.category)) slot.spendable += amount;
    } else if (t.type === "expense") {
      slot.expenses += amount;
    }
    cents.set(key, slot);
  }

  /*
   * Every year either side has something to say: one with transactions but no
   * net worth on record, and one with a balance but nothing spent, are both
   * real years.
   */
  const years = [
    ...new Set([...cents.keys(), ...months.map((m) => m.slice(0, 4))]),
  ].sort();

  const rows: YearRow[] = [];
  let base: { year: number; netWorth: number } | null = null;

  for (const [i, y] of years.entries()) {
    const money = cents.get(y) ?? { income: 0, expenses: 0, spendable: 0 };
    const income = fromCents(money.income);
    const expenses = fromCents(money.expenses);
    const end = lastMonthOf(y, months);
    const nw = end ? (nwByMonth.get(end)?.net ?? 0) : 0;
    const port = end ? portByMonth.get(end) : undefined;

    const previous = rows[rows.length - 1];
    const previousExpenses = previous?.expenses ?? 0;

    let flows = 0;
    for (const [month, amount] of Object.entries(flowsByMonth)) {
      if (month.startsWith(y)) flows += toCents(amount);
    }

    /*
     * The year's return is chained from its months, with the opening value
     * taken from the December before it — a year that begins where the last
     * one ended, rather than from its own first close.
     */
    const window = portfolio.filter(
      (p) => p.key.startsWith(y) || p.key === lastMonthOf(String(Number(y) - 1), months),
    );
    const chained = window.length > 1 ? chainedReturns(window, flowsByMonth) : [];
    const portfolioReturn = chained.length > 1 ? chained[chained.length - 1] : null;

    if (base === null && nw > 0) base = { year: Number(y), netWorth: nw };
    const span = base ? Number(y) - base.year : 0;
    const cagr =
      base && span > 0 && nw > 0
        ? (Math.pow(nw / base.netWorth, 1 / span) - 1) * 100
        : null;

    rows.push({
      year: y,
      complete: y < currentYear,
      income,
      expenses,
      expenseGrowth:
        i > 0 && previousExpenses > 0
          ? ((expenses - previousExpenses) / previousExpenses) * 100
          : null,
      netCashflow: fromCents(money.income - money.expenses),
      uncommittedLiquid: fromCents(money.spendable - money.expenses),
      savingsRate:
        money.income > 0
          ? ((money.income - money.expenses) / money.income) * 100
          : null,
      netWorth: nw,
      netWorthChange: previous ? roundMoney(nw - previous.netWorth) : null,
      portfolio: port?.value ?? 0,
      costBasis: port?.cost ?? 0,
      investmentProfit: roundMoney((port?.value ?? 0) - (port?.cost ?? 0)),
      investmentFlows: fromCents(flows),
      portfolioReturn,
      cagr,
    });
  }

  return rows.reverse();
}

export interface Milestone {
  amount: number;
  month: string;
  /** Months since the milestone before it. Null for the first one crossed. */
  monthsFromPrevious: number | null;
}

/**
 * The month each round number of net worth was first passed.
 *
 * A history of pace rather than of level: the gap between one and the next is
 * how long that step took, which is the part a rising line does not say. Only
 * the first crossing counts — a milestone passed, lost and passed again was
 * still reached when it was first reached.
 */
export function milestones(
  points: readonly { key: string; net: number }[],
  step = 50000,
): Milestone[] {
  const out: Milestone[] = [];
  let next = step;
  let previousMonth: string | null = null;
  for (const p of points) {
    while (p.net >= next) {
      out.push({
        amount: next,
        month: p.key,
        monthsFromPrevious: previousMonth ? monthsBetween(previousMonth, p.key) : null,
      });
      previousMonth = p.key;
      next += step;
    }
  }
  return out;
}

function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}
