import { NON_SPENDABLE_INCOME, chainedReturns, isIncome } from "./analytics";
import type { ClassPoint, NetWorthPoint, PortfolioPoint } from "./analytics";
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
    if (isIncome(t)) {
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

/* ── The year as a balance sheet, and what moved it ── */

export interface YearShape {
  year: string;
  complete: boolean;
  /** Where the money sits at the end of the year. */
  cash: number;
  bonds: number;
  stocks: number;
  crypto: number;
  pension: number;
  assets: number;
  /** What is owed, as a positive number. */
  liabilities: number;
  netWorth: number;
  openingNetWorth: number;
  /** What passed through the year. */
  income: number;
  expenses: number;
  /** Income less spending: the part of the change you can point at. */
  saved: number;
  /**
   * Everything else that moved net worth.
   *
   * Closing less opening, less what was saved. Named honestly: it is market
   * movement, but it is also pension accrual, a property revaluation and the
   * exchange rate, and calling it "investment return" would credit the
   * portfolio with all of them.
   */
  revaluation: number;
}

/**
 * Each year's closing balance sheet beside its cash flow.
 *
 * The two are usually shown apart — a spending page and a net worth chart —
 * which leaves the most interesting question unanswerable: of everything net
 * worth gained this year, how much did you put there and how much arrived on
 * its own? That is a subtraction, and it needs both halves in one place.
 */
export function yearShapes(
  rows: readonly YearRow[],
  classPoints: readonly ClassPoint[],
): YearShape[] {
  // The last month the record actually has for each year, not December: a year
  // still running ends in the month it has reached.
  const lastOf = new Map<string, ClassPoint>();
  for (const p of classPoints) {
    const year = p.key.slice(0, 4);
    lastOf.set(year, p);
  }

  const byYear = new Map(rows.map((r) => [r.year, r]));
  const ordered = [...rows].sort((a, b) => a.year.localeCompare(b.year));

  return ordered.map((r) => {
    const p = lastOf.get(r.year);
    const previous = byYear.get(String(Number(r.year) - 1));
    const openingNetWorth = previous?.netWorth ?? r.netWorth - (r.netWorthChange ?? 0);
    const saved = r.income - r.expenses;
    return {
      year: r.year,
      complete: r.complete,
      cash: p?.Cash ?? 0,
      bonds: p?.Bonds ?? 0,
      stocks: p?.Stocks ?? 0,
      crypto: p?.Crypto ?? 0,
      pension: p?.Pension ?? 0,
      assets: (p?.Cash ?? 0) + (p?.Bonds ?? 0) + (p?.Stocks ?? 0) + (p?.Crypto ?? 0) + (p?.Pension ?? 0),
      liabilities: p?.liabilities ?? 0,
      netWorth: r.netWorth,
      openingNetWorth,
      income: r.income,
      expenses: r.expenses,
      saved,
      revaluation: r.netWorth - openingNetWorth - saved,
    };
  });
}

/** One step of the year's move from opening net worth to closing. */
export interface WaterfallStep {
  label: string;
  /** Signed: what this step added or removed. Zero for the two totals. */
  delta: number;
  /** Where the bar sits, for a floating column. */
  base: number;
  top: number;
  kind: "total" | "up" | "down";
}

/**
 * The year as a single arithmetic sentence.
 *
 * Opening net worth, plus what came in, less what went out, plus everything
 * that moved without passing through either — and the closing figure has to be
 * what the balance sheet says it is. It balances by construction, which is the
 * point: any surprise in the chart is a surprise about the year, not about the
 * chart.
 */
export function yearWaterfall(shape: YearShape): WaterfallStep[] {
  const steps: WaterfallStep[] = [];
  let running = shape.openingNetWorth;

  steps.push({
    label: "Opened at",
    delta: 0,
    base: 0,
    top: shape.openingNetWorth,
    kind: "total",
  });

  const add = (label: string, delta: number) => {
    const from = running;
    running += delta;
    steps.push({
      label,
      delta,
      base: Math.min(from, running),
      top: Math.max(from, running),
      kind: delta >= 0 ? "up" : "down",
    });
  };

  add("Income", shape.income);
  add("Spending", -shape.expenses);
  add(shape.revaluation >= 0 ? "Growth" : "Decline", shape.revaluation);

  steps.push({ label: "Closed at", delta: 0, base: 0, top: shape.netWorth, kind: "total" });
  return steps;
}

/* ── What the year actually says ── */

export interface YearInsight {
  key: string;
  headline: string;
  detail: string;
  tone: "positive" | "negative" | "neutral";
}

/**
 * Observations a reader would have to do arithmetic to reach.
 *
 * A page of totals reports; this is the part that notices. Every one of these
 * is a subtraction or a ratio across two figures already on the page — which
 * is exactly why they are worth drawing out, because nobody does that
 * arithmetic while scrolling.
 *
 * Each is suppressed when its inputs cannot support it. A claim about a trend
 * needs a year to compare against, a rate needs a denominator, and a debt
 * projection needs the debt to actually be falling. Saying nothing beats
 * saying something the figures do not carry.
 */
export function yearInsights(
  shapes: readonly YearShape[],
  year: string,
): YearInsight[] {
  const here = shapes.find((s) => s.year === year);
  if (!here) return [];
  const before = shapes.find((s) => s.year === String(Number(year) - 1));
  const out: YearInsight[] = [];

  /*
   * The question the two halves of this page exist to answer together: of what
   * net worth gained, how much did you put there?
   *
   * Only when it grew. In a year that fell the same ratio reads as though
   * saving caused the fall, which is the opposite of what happened.
   */
  const gain = here.netWorth - here.openingNetWorth;
  if (gain > 0 && here.saved > 0) {
    const earned = Math.min(100, (here.saved / gain) * 100);
    out.push({
      key: "earned",
      headline: `${Math.round(earned)}% of the year's gain was money you added`,
      detail:
        earned >= 60
          ? "The rest is growth. Early on this is normal — a portfolio too small to move much is carried by contributions."
          : "The rest arrived on its own, which is what a portfolio starts doing once it is large enough to out-earn what you can add.",
      tone: "neutral",
    });
  }

  // What a dollar of income actually did.
  if (here.income > 0) {
    const kept = Math.round((here.saved / here.income) * 100);
    out.push({
      key: "kept",
      headline: `${Math.max(0, 100 - kept)}c of every dollar earned was spent`,
      detail:
        before && before.income > 0
          ? `Last year it was ${Math.max(0, 100 - Math.round((before.saved / before.income) * 100))}c.`
          : "The rest stayed.",
      tone: kept >= 20 ? "positive" : kept >= 0 ? "neutral" : "negative",
    });
  }

  /*
   * Debt, and when it ends. Projected only while it is falling and only from a
   * full year: a partial year's paydown annualises into a promise the record
   * cannot make.
   */
  if (before && here.liabilities > 0 && before.liabilities > here.liabilities && here.complete) {
    const paid = before.liabilities - here.liabilities;
    const years = here.liabilities / paid;
    out.push({
      key: "debt",
      headline: `Debt fell ${Math.round((paid / before.liabilities) * 100)}% this year`,
      detail:
        years <= 25
          ? `At the same pace it is clear around ${Number(year) + Math.ceil(years)}.`
          : "At this pace it is a long way from clear.",
      tone: "positive",
    });
  } else if (before && here.liabilities > before.liabilities) {
    out.push({
      key: "debt",
      headline: `Debt rose ${Math.round(((here.liabilities - before.liabilities) / Math.max(1, before.liabilities)) * 100)}% this year`,
      detail: "Borrowing arrives like income and is not income.",
      tone: "negative",
    });
  }

  // How much of the balance sheet you could actually reach.
  if (here.assets > 0) {
    const liquidShare = Math.round((here.cash / here.assets) * 100);
    out.push({
      key: "liquid",
      headline: `${liquidShare}% of assets are cash`,
      detail:
        here.expenses > 0
          ? `About ${(here.cash / (here.expenses / 12)).toFixed(1)} months of this year's spending.`
          : "Everything else is invested or locked away.",
      tone: liquidShare < 3 ? "negative" : "neutral",
    });
  }

  // Whether spending is drifting, which a single year's total cannot show.
  if (before && before.expenses > 0 && here.complete) {
    const change = ((here.expenses - before.expenses) / before.expenses) * 100;
    if (Math.abs(change) >= 5) {
      out.push({
        key: "spending",
        headline: `Spending ${change > 0 ? "rose" : "fell"} ${Math.abs(Math.round(change))}% against last year`,
        detail: `${fmtDelta(here.expenses - before.expenses)} on a year that cost ${Math.round(before.expenses).toLocaleString()}.`,
        tone: change > 0 ? "negative" : "positive",
      });
    }
  }

  return out;
}

function fmtDelta(n: number): string {
  const sign = n >= 0 ? "+" : "-";
  return `${sign}${Math.round(Math.abs(n)).toLocaleString()}`;
}
