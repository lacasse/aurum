import { NON_SPENDABLE_INCOME, chainedReturns, isIncome } from "./analytics";
import type { ClassPoint, NetWorthPoint, PortfolioPoint } from "./analytics";
import type { Account, AccountKind, Holding } from "./types";
import { Transaction } from "./types";
import { fromCents, roundMoney, toCents } from "./money";
import { labelMonth } from "./format";
import {
  SPEND_GROUP_LABELS,
  groupOf,
  type SpendGroup,
} from "./expenses";

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

/**
 * Two more observations, from the cash flow rather than the balance sheet.
 *
 * Kept apart from `yearInsights` because they need the transactions and it
 * does not — a page that has only the yearly totals still gets the first set.
 */
export function cashflowInsights(
  transactions: Transaction[],
  year: string,
  groupOf: (category: string) => "necessity" | "discretionary" | "excluded",
): YearInsight[] {
  const out: YearInsight[] = [];
  const here = incomeAllocation(transactions, year, groupOf);
  if (here.income <= 0) return out;

  /*
   * What the year would have cost with every choice removed.
   *
   * The useful reading of a necessity total is not the figure but the ratio to
   * income: it is the share of earnings already committed before any decision
   * is made, and the part of a salary that cannot absorb a shock.
   */
  const committed = Math.round((here.necessities / here.income) * 100);
  out.push({
    key: "committed",
    headline: `${committed}% of income was already committed`,
    detail:
      "Housing, food, transport and the rest of what arrives whether or not the year went well. The remainder is what any decision could move.",
    tone: committed > 70 ? "negative" : committed > 50 ? "neutral" : "positive",
  });

  /*
   * The single month that did the most work, and the one that undid it.
   *
   * A year is an average of twelve very different months, and the average is
   * the one figure that describes none of them. Naming the extremes says more
   * about what actually happened.
   */
  const byMonth = new Map<string, { income: number; spent: number }>();
  for (const t of transactions) {
    if (t.date.slice(0, 4) !== year) continue;
    const key = t.date.slice(0, 7);
    const slot = byMonth.get(key) ?? { income: 0, spent: 0 };
    if (isIncome(t)) slot.income += toCents(t.amount);
    else if (t.type === "expense") slot.spent += toCents(t.amount);
    byMonth.set(key, slot);
  }
  const months = [...byMonth.entries()]
    .map(([key, v]) => ({ key, kept: fromCents(v.income - v.spent) }))
    .sort((a, b) => b.kept - a.kept);

  if (months.length >= 3) {
    const best = months[0];
    const worst = months[months.length - 1];
    out.push({
      key: "months",
      headline: `${labelMonth(best.key)} kept the most; ${labelMonth(worst.key)} the least`,
      detail: `${fmtDelta(best.kept)} against ${fmtDelta(worst.kept)}. A year is an average of months that looked nothing like each other.`,
      tone: "neutral",
    });
  }

  return out;
}

function fmtDelta(n: number): string {
  const sign = n >= 0 ? "+" : "-";
  return `${sign}${Math.round(Math.abs(n)).toLocaleString()}`;
}

/* ── Where a year's income went ── */

export interface IncomeAllocation {
  income: number;
  necessities: number;
  discretionary: number;
  /** Debt repayment: money crossing the balance sheet rather than being spent. */
  debt: number;
  /** What was left. Negative in a year that spent more than it earned. */
  saved: number;
}

/**
 * Every dollar that came in, and what became of it.
 *
 * The savings rate is one number and hides the interesting part — a year that
 * kept a fifth of its income tells you nothing about whether the other four
 * fifths were rent or restaurants. Splitting the whole of income at once puts
 * the fixed cost of living, the discretionary part and the debt beside what
 * was kept, on the same bar.
 *
 * Debt repayment is separated rather than counted as spending. The money
 * leaves the account and lands on the other side of the balance sheet as debt
 * that no longer exists; calling it consumption both overstates what living
 * costs and understates what was saved.
 */
export function incomeAllocation(
  transactions: Transaction[],
  year: string,
  groupOf: (category: string) => "necessity" | "discretionary" | "excluded",
): IncomeAllocation {
  let income = 0;
  let necessities = 0;
  let discretionary = 0;
  let debt = 0;

  for (const t of transactions) {
    if (t.date.slice(0, 4) !== year) continue;
    const cents = toCents(t.amount);
    if (isIncome(t)) {
      income += cents;
      continue;
    }
    if (t.type !== "expense") continue;
    const group = groupOf(t.category);
    if (group === "necessity") necessities += cents;
    else if (group === "discretionary") discretionary += cents;
    else debt += cents;
  }

  return {
    income: fromCents(income),
    necessities: fromCents(necessities),
    discretionary: fromCents(discretionary),
    debt: fromCents(debt),
    saved: fromCents(income - necessities - discretionary - debt),
  };
}

/* ── What changed against last year ── */

export interface CategoryShift {
  category: string;
  now: number;
  before: number;
  change: number;
}

/**
 * The categories that moved, largest first.
 *
 * A year's total tells you it cost more than the last one; it never tells you
 * what did. This is the subtraction that answers it, and it is the one figure
 * on the page that can actually be acted on — a total is a fact about the past
 * and a category that doubled is a decision.
 *
 * Only complete years are worth comparing. Six months against twelve reports
 * every category as halved, which is arithmetic rather than news.
 */
export function categoryShifts(
  transactions: Transaction[],
  year: string,
  limit = 8,
): CategoryShift[] {
  const before = String(Number(year) - 1);
  const now = new Map<string, number>();
  const then = new Map<string, number>();

  for (const t of transactions) {
    if (t.type !== "expense") continue;
    const y = t.date.slice(0, 4);
    const into = y === year ? now : y === before ? then : null;
    if (!into) continue;
    into.set(t.category, (into.get(t.category) ?? 0) + toCents(t.amount));
  }

  const categories = new Set([...now.keys(), ...then.keys()]);
  return [...categories]
    .map((category) => {
      const a = fromCents(now.get(category) ?? 0);
      const b = fromCents(then.get(category) ?? 0);
      return { category, now: a, before: b, change: roundMoney(a - b) };
    })
    .filter((r) => Math.abs(r.change) >= 1)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, limit);
}

/* ── What you put in, against what it became ── */

export interface ContributionPoint {
  label: string;
  /** Everything paid into holdings up to the end of this year, less withdrawals. */
  contributed: number;
  /** What the portfolio was worth at that point. */
  value: number;
}

/**
 * The compounding story, which a single year cannot tell.
 *
 * The waterfall answers what one year did. This answers the question behind
 * it: the two lines start together and separate, and the gap between them is
 * every dollar the portfolio earned rather than received. Watching that gap
 * open is the only view in the app where compounding is a picture rather than
 * a percentage.
 *
 * A year the portfolio was not yet worth anything is dropped rather than drawn
 * as two lines at zero, which is a flat start that says nothing and squashes
 * the years that do.
 */
export function contributionsVsValue(rows: readonly YearRow[]): ContributionPoint[] {
  const ordered = [...rows].sort((a, b) => a.year.localeCompare(b.year));
  let running = 0;
  const out: ContributionPoint[] = [];
  for (const r of ordered) {
    running = roundMoney(running + r.investmentFlows);
    if (r.portfolio <= 0 && running <= 0) continue;
    out.push({ label: r.year, contributed: running, value: r.portfolio });
  }
  return out;
}

/* ── Where the income came from ── */

export interface IncomeMix {
  /** One row per year, with a key per source. */
  rows: Record<string, string | number>[];
  /** The sources present, largest first, for the chart's series. */
  sources: string[];
}

/**
 * Income by source, year over year.
 *
 * A salary is one source and one employer, and a record that shows only its
 * total cannot say whether that is changing. Split by source and stacked, the
 * question becomes visible: whether anything is growing beside the wage, and
 * how fast.
 *
 * Borrowing is excluded along with everything else `isIncome` refuses, because
 * money arriving from a lender is not income and drawing it as a source would
 * make a year of borrowing look like a year of earning.
 */
export function incomeMix(transactions: Transaction[], limit = 5): IncomeMix {
  const byYear = new Map<string, Map<string, number>>();
  const totals = new Map<string, number>();

  for (const t of transactions) {
    if (!isIncome(t)) continue;
    const year = t.date.slice(0, 4);
    const cents = toCents(t.amount);
    const slot = byYear.get(year) ?? new Map<string, number>();
    slot.set(t.category, (slot.get(t.category) ?? 0) + cents);
    byYear.set(year, slot);
    totals.set(t.category, (totals.get(t.category) ?? 0) + cents);
  }

  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const kept = ranked.slice(0, limit);
  const hasOther = ranked.length > kept.length;
  const sources = hasOther ? [...kept, "Other"] : kept;

  const rows = [...byYear.keys()]
    .sort()
    .map((year) => {
      const slot = byYear.get(year)!;
      const row: Record<string, string | number> = { label: year };
      for (const source of kept) row[source] = fromCents(slot.get(source) ?? 0);
      if (hasOther) {
        let rest = 0;
        for (const [category, cents] of slot) if (!kept.includes(category)) rest += cents;
        row.Other = fromCents(rest);
      }
      return row;
    });

  return { rows, sources };
}

/**
 * The share of a year's income that did not come from working.
 *
 * The figure worth watching rather than the total: a wage can only be traded
 * for time, and everything else compounds without asking. Null when the year
 * earned nothing, because a share of nothing is not zero.
 */
export const WORK_CATEGORIES = new Set([
  "Salary",
  "Additional Income",
  "Freelance",
  "RSP / Pension",
]);

export function unearnedShare(
  transactions: Transaction[],
  year: string,
  /*
   * What counts as working for it.
   *
   * A pension *contribution* belongs here: it is deferred pay, earned by the
   * same hours as the salary it comes off, and counting it as unearned would
   * report someone as further from living on their assets than they are the
   * more they save into a plan. A pension *payment* is the opposite — the plan
   * paying you whether you work or not — and is deliberately absent.
   *
   * Freelance income was absent by oversight, which flattered the figure.
   */
  workCategories = WORK_CATEGORIES,
): number | null {
  let total = 0;
  let unearned = 0;
  for (const t of transactions) {
    if (!isIncome(t) || t.date.slice(0, 4) !== year) continue;
    const cents = toCents(t.amount);
    total += cents;
    if (!workCategories.has(t.category)) unearned += cents;
  }
  return total > 0 ? (unearned / total) * 100 : null;
}

/**
 * The same mix as shares of each year rather than as amounts.
 *
 * Two different questions, and the amounts answer the wrong one. A salary that
 * rises every year makes every other source shrink on a chart of dollars, even
 * as those sources grow — the wage simply out-scales them. Normalising each
 * year to its own total asks what the income was *made of*, which is the thing
 * that changes slowly and matters.
 *
 * A year with no income keeps its row at zero rather than being dropped, so
 * the run of years stays unbroken and a gap reads as a gap.
 */
export function incomeMixShares(mix: IncomeMix): Record<string, string | number>[] {
  return mix.rows.map((row) => {
    const total = mix.sources.reduce((sum, s) => sum + (Number(row[s]) || 0), 0);
    const out: Record<string, string | number> = { label: row.label };
    for (const source of mix.sources) {
      out[source] = total > 0 ? ((Number(row[source]) || 0) / total) * 100 : 0;
    }
    return out;
  });
}

/**
 * Income split two ways: earned by working, and not.
 *
 * The full breakdown by source answers what the money was; this answers the
 * only question about it that changes a life. Active income stops when you do.
 * Passive income does not, and the share of one against the other is the
 * distance between having a job and not needing one.
 *
 * The same set of categories decides it as decides `unearnedShare`, so the
 * chart and the sentence beside it can never disagree — a pension
 * contribution is active, being deferred pay off the same hours, and a pension
 * paying out is passive.
 *
 * Shares rather than amounts, so a rising salary cannot make growing passive
 * income appear to shrink.
 */
/** The same split as amounts, for the figures beside the chart. */
export function incomeTypeAmounts(
  transactions: Transaction[],
  year: string,
): { Active: number; Passive: number } {
  let active = 0;
  let passive = 0;
  for (const t of transactions) {
    if (!isIncome(t) || t.date.slice(0, 4) !== year) continue;
    if (WORK_CATEGORIES.has(t.category)) active += toCents(t.amount);
    else passive += toCents(t.amount);
  }
  return { Active: fromCents(active), Passive: fromCents(passive) };
}

export function incomeTypeShares(
  transactions: Transaction[],
): Record<string, string | number>[] {
  const byYear = new Map<string, { active: number; passive: number }>();
  for (const t of transactions) {
    if (!isIncome(t)) continue;
    const year = t.date.slice(0, 4);
    const slot = byYear.get(year) ?? { active: 0, passive: 0 };
    if (WORK_CATEGORIES.has(t.category)) slot.active += toCents(t.amount);
    else slot.passive += toCents(t.amount);
    byYear.set(year, slot);
  }
  return [...byYear.keys()].sort().map((year) => {
    const { active, passive } = byYear.get(year)!;
    const total = active + passive;
    return {
      label: year,
      Active: total > 0 ? (active / total) * 100 : 0,
      Passive: total > 0 ? (passive / total) * 100 : 0,
    };
  });
}

/* ── The whole year as one flow ── */

export interface FlowNode {
  name: string;
  /**
   * What this node is, so the chart can colour by meaning rather than by
   * guessing from the name or from which column the layout happened to put it
   * in. The data layer is the only place that knows a node is a necessity
   * rather than a choice.
   */
  role?:
    | "source"
    | "account"
    | "necessity"
    | "discretionary"
    | "debt"
    | "investing"
    | "kept"
    | "idle";
}
export interface FlowLink {
  source: number;
  target: number;
  value: number;
}
export interface YearFlow {
  nodes: FlowNode[];
  links: FlowLink[];
}

/** Accounts whose outflow is purchases rather than spending. */
const INVESTED_KINDS = new Set<AccountKind>(["investment", "crypto", "pension"]);

/**
 * All the invested accounts as one bar.
 *
 * Drawn separately they were four or five nodes that behaved identically —
 * money in, securities out — and the reader had to add them up by eye to learn
 * what the year invested. Which account a holding sits in is a tax question,
 * answered on the contribution card and on the accounts page; it is not what
 * this chart is for. Merged, the bar is the year's investing, and what it
 * bought hangs off it by asset class.
 *
 * Nothing about the arithmetic changes: summing the accounts sums their
 * inflows and their outflows together, so the one node reconciles exactly as
 * the several did. A transfer between two of them becomes a link from the node
 * to itself, which is no flow at all — and it never was.
 */
const INVESTMENTS = "Investments";

const SPENDING = "Spending";
/**
 * A purchase, which needs no node of its own.
 *
 * Buys used to pass through a single "Bought" node on the way to the classes.
 * It cost a column and it lost the thing worth seeing: every account's
 * purchases merged there before fanning out again, so which account bought the
 * bonds and which bought the equity was no longer on the chart. An investment
 * account is already the answer to "what was this for"; what it bought hangs
 * straight off it.
 */
const ASSET = "__asset";
/** Money moved to another of your own accounts, which is not a purpose. */
const DEPOSIT = "__deposit";
/** Selling a position, which is money arriving rather than leaving. */
const SOLD = "Sold investments";
/** What an invested account took in and has no purchases to account for. */
const UNITEMISED = "Not itemised";

const GROUP_ROLE: Record<string, FlowNode["role"]> = {
  [SPENDING]: "necessity",
};
/** The three ends of the spending branch, each its own colour. */
const LEAF_ROLE: Record<string, FlowNode["role"]> = {
  [SPEND_GROUP_LABELS.necessity]: "necessity",
  [SPEND_GROUP_LABELS.discretionary]: "discretionary",
  [SPEND_GROUP_LABELS.excluded]: "debt",
};

/**
 * Every dollar of a year, from where it came to where it went.
 *
 * Four columns. Money arrives on the left, lands in a named account, leaves
 * that account for something, and that something is broken down. A
 * two-column version drew a year as one undifferentiated pool, which is not
 * how anybody holds money: "which account is this coming out of" is the
 * question a cash flow is actually asked.
 *
 * Every account reconciles on its own, so the chart cannot show more leaving
 * one than reached it. Where an account paid out more than it took in, the
 * difference is drawn as its own source, because the money did come from
 * somewhere — a balance carried in, or borrowing — and a chart that balanced
 * by shrinking the spending would be lying about the part that matters.
 *
 * Rows with no account on them still work: they route through a single node
 * named for the year, which is what the whole chart used to be. A month
 * imported as a sheet total has nowhere else to go and should not vanish.
 *
 * ## The invested side
 *
 * A deposit into an investment account and a purchase inside it are two
 * different events, and drawing both as outflows of the same account would be
 * the same dollar twice. So they are drawn as what they are: a transfer moves
 * money from one account to another, and a *buy* is how an investment account
 * spends what it holds. The breakdown is then by asset class rather than by
 * account, which is what a portfolio is actually divided into — the account is
 * a container, and two of them holding the same fund is not a distinction
 * worth a column.
 *
 * A sale is money arriving, so it is a source on the left beside the salary,
 * exactly as a shortfall is. That is the only way a flow diagram can carry an
 * outflow from a position: a ribbon cannot run backwards, and netting sales
 * off the buys would leave a class that was sold down with a negative width
 * and nothing to draw. It also makes a year that paid for itself by selling
 * legible, which the previous version could not show at all.
 *
 * Dividends are deliberately *not* taken from the trade history. A dividend
 * landing in a chequing account is already an income row under "Dividends",
 * and the trade importer records the same payment against the holding, so
 * counting both would inflate the year by every distribution twice.
 *
 * Where an investment account took money in and has no purchases to account
 * for it, the remainder is "Not itemised" rather than "Kept". It is either
 * cash sitting in the account or a purchase whose trade history was never
 * imported, and those are not the same thing as money deliberately unspent.
 */
export interface YearFlowOptions {
  accounts?: Pick<Account, "id" | "name" | "kind">[];
  /** Positions, for the purchases and sales inside the invested accounts. */
  holdings?: Pick<Holding, "accountId" | "assetClass" | "flows">[];
  /** How many leaves a branch draws before the tail is pooled. */
  limit?: number;
  /** Which side of the necessity line a category falls, overrides included. */
  spendGroup?: (category: string) => SpendGroup;
}

export function yearFlow(
  transactions: Transaction[],
  year: string,
  {
    accounts = [],
    holdings = [],
    limit = 8,
    spendGroup = (c) => groupOf(c),
  }: YearFlowOptions = {},
): YearFlow {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const TRUNK = year;

  /**
   * The account a row touched, or the year itself when it names none. Every
   * invested account answers to one name; see INVESTMENTS.
   */
  const hubOf = (id: string | undefined) => {
    const a = byId.get(id ?? "");
    if (!a) return TRUNK;
    return INVESTED_KINDS.has(a.kind) ? INVESTMENTS : a.name;
  };

  const incomeTotals = new Map<string, number>();
  const spendTotals = new Map<string, number>();
  const investTotals = new Map<string, number>();
  const hubTotals = new Map<string, number>();
  /** Whether the invested bar is on this year's chart at all. */
  let anyInvested = false;
  const rows: {
    from: string;
    to: string;
    cents: number;
    stage: 1 | 2;
    group?: string;
  }[] = [];

  const note = (m: Map<string, number>, k: string, v: number) =>
    m.set(k, (m.get(k) ?? 0) + v);

  for (const t of transactions) {
    if (t.date.slice(0, 4) !== year) continue;
    const cents = toCents(t.amount);
    if (cents <= 0) continue;
    if (isIncome(t)) {
      const hub = hubOf(t.destinationAccountId);
      if (hub === INVESTMENTS) anyInvested = true;
      note(incomeTotals, t.category, cents);
      note(hubTotals, hub, cents);
      rows.push({ from: t.category, to: hub, cents, stage: 1 });
    } else if (t.type === "expense") {
      const hub = hubOf(t.sourceAccountId);
      note(spendTotals, SPEND_GROUP_LABELS[spendGroup(t.category)], cents);
      note(hubTotals, hub, cents);
      rows.push({
        from: hub,
        to: SPEND_GROUP_LABELS[spendGroup(t.category)],
        cents,
        stage: 2,
        group: SPENDING,
      });
    } else if (t.type === "transfer") {
      const dest = byId.get(t.destinationAccountId ?? "");
      if (!dest || !INVESTED_KINDS.has(dest.kind)) continue;
      const hub = hubOf(t.sourceAccountId);
      // Moving between two invested accounts is not a flow through the year.
      if (hub === INVESTMENTS) continue;
      anyInvested = true;
      note(hubTotals, hub, cents);
      note(hubTotals, INVESTMENTS, cents);
      /*
       * Account to account, with no purpose node between them. The deposit is
       * not spending and it is not yet a purchase — it is the money moving to
       * where the buying happens, and the buying is the next column.
       */
      rows.push({ from: hub, to: INVESTMENTS, cents, stage: 2, group: DEPOSIT });
    }
  }

  /*
   * The purchases and sales inside the accounts. A buy is how an investment
   * account spends; a sale is money arriving in one.
   */
  for (const h of holdings) {
    for (const f of h.flows ?? []) {
      if (f.date.slice(0, 4) !== year) continue;
      const cents = toCents(f.amount);
      if (cents <= 0) continue;
      anyInvested = true;
      note(hubTotals, INVESTMENTS, cents);
      if (f.kind === "buy") {
        note(investTotals, h.assetClass, cents);
        rows.push({ from: INVESTMENTS, to: h.assetClass, cents, stage: 2, group: ASSET });
      } else if (f.kind === "sell") {
        note(incomeTotals, SOLD, cents);
        rows.push({ from: SOLD, to: INVESTMENTS, cents, stage: 1 });
      }
      // Dividends are income already, under their own category. See above.
    }
  }

  if (rows.length === 0) return { nodes: [], links: [] };

  /*
   * Past the limit, pooled rather than dropped. A chart that quietly omits the
   * long tail no longer adds up, and the whole value of a Sankey is that it
   * does. The hubs get a smaller allowance than the categories because they
   * are the spine: a dozen of them is a tangle, not a middle.
   */
  const pool = (totals: Map<string, number>, keep: number, other: string) => {
    const ranked = [...totals.entries()]
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const kept = new Set(ranked.slice(0, keep).map(([k]) => k));
    return (name: string) => (kept.has(name) ? name : other);
  };
  const sourceName = pool(incomeTotals, limit, "Other income");
  /*
   * Neither the spending nor the invested side needs pooling in practice --
   * three necessity groups and four asset classes -- but the tail is capped
   * anyway so a future class or group cannot quietly widen the chart.
   */
  const leafName: Record<string, (name: string) => string> = {
    [ASSET]: pool(investTotals, limit, "Other assets"),
  };
  // The year node is the spine for account-less rows and never pools away.
  const hubName = (() => {
    const named = new Map([...hubTotals].filter(([k]) => k !== TRUNK));
    const collapse = pool(named, 6, "Other accounts");
    return (name: string) => (name === TRUNK ? TRUNK : collapse(name));
  })();

  const edges = new Map<string, number>();
  const inflow = new Map<string, number>();
  const outflow = new Map<string, number>();
  const groups = new Set<string>();
  const leaves = new Set<string>();
  const assetLeaves = new Set<string>();
  const link = (from: string, to: string, cents: number) => {
    if (from === to) return;
    edges.set(`${from}\u0000${to}`, (edges.get(`${from}\u0000${to}`) ?? 0) + cents);
  };
  for (const r of rows) {
    if (r.stage === 1) {
      const to = hubName(r.to);
      link(r.from === SOLD ? SOLD : sourceName(r.from), to, r.cents);
      note(inflow, to, r.cents);
      continue;
    }
    const from = hubName(r.from);
    if (r.group === DEPOSIT) {
      /*
       * One link, not two. A deposit lands in an account that is itself a
       * column of this chart, so it needs no purpose node in between — and
       * the receiving account's own inflow is what the purchases below it
       * have to reconcile against.
       */
      const to = hubName(r.to);
      link(from, to, r.cents);
      note(outflow, from, r.cents);
      note(inflow, to, r.cents);
      continue;
    }
    const group = r.group ?? SPENDING;
    const leaf = (leafName[group] ?? ((n: string) => n))(r.to);
    if (group === ASSET) {
      // Straight off the account that bought it. See ASSET.
      link(from, leaf, r.cents);
      leaves.add(leaf);
      assetLeaves.add(leaf);
      note(outflow, from, r.cents);
      continue;
    }
    /*
     * Two links for one row: the account to what it was for, and that to the
     * thing itself. The pair is what puts a column between them, and because
     * both carry the same amount the account still balances exactly as it did
     * when it paid the destination directly.
     */
    link(from, group, r.cents);
    link(group, leaf, r.cents);
    groups.add(group);
    leaves.add(leaf);
    note(outflow, from, r.cents);
  }

  const hubs = [...new Set([...inflow.keys(), ...outflow.keys()])]
    .filter((n) => n !== SOLD)
    .sort(
      (a, b) =>
        (inflow.get(b) ?? 0) + (outflow.get(b) ?? 0) -
          ((inflow.get(a) ?? 0) + (outflow.get(a) ?? 0)) || a.localeCompare(b),
    );

  /*
   * One node is the invested side, whatever arrived in it. Deciding by the
   * transfer left a pension that was paid into directly reading as a chequing
   * account, so its contributions came out as money deliberately unspent.
   */
  const investedHubs = new Set(
    anyInvested && hubs.includes(INVESTMENTS) ? [INVESTMENTS] : [],
  );

  const shortfall = new Map<string, number>();
  const spare = new Map<string, number>();
  for (const hub of hubs) {
    const gap = (outflow.get(hub) ?? 0) - (inflow.get(hub) ?? 0);
    if (gap > 0) shortfall.set(hub, gap);
    else if (gap < 0) spare.set(hub, -gap);
  }
  const kept = [...spare]
    .filter(([h]) => !investedHubs.has(h))
    .reduce((a, [, v]) => a + v, 0);
  const unitemised = [...spare]
    .filter(([h]) => investedHubs.has(h))
    .reduce((a, [, v]) => a + v, 0);

  const nodes: FlowNode[] = [];
  const index = new Map<string, number>();
  const id = (name: string, role?: FlowNode["role"]) => {
    const existing = index.get(name);
    if (existing !== undefined) return existing;
    const next = nodes.push(role ? { name, role } : { name }) - 1;
    index.set(name, next);
    return next;
  };
  /** A leaf is whatever its branch is: a necessity, a choice, an asset. */
  const roleOfLeaf = new Map<string, FlowNode["role"]>();

  /*
   * Nodes in reading order — sources, then hubs, then what the money was for,
   * then the detail — so the layout has no reason to cross ribbons that need
   * not cross.
   */
  const links: FlowLink[] = [];
  const edgeList = [...edges].map(([k, v]) => {
    const [from, to] = k.split("\u0000");
    return { from, to, cents: v };
  });
  for (const e of edgeList) if (hubs.includes(e.to) && !hubs.includes(e.from)) id(e.from, "source");
  if (shortfall.size > 0) id("From savings", "source");
  for (const hub of hubs) id(hub, investedHubs.has(hub) ? "investing" : "account");
  for (const g of [SPENDING]) if (groups.has(g)) id(g, GROUP_ROLE[g]);
  for (const e of edgeList) {
    if (groups.has(e.from) && leaves.has(e.to)) {
      roleOfLeaf.set(e.to, LEAF_ROLE[e.to] ?? GROUP_ROLE[e.from]);
    }
  }
  for (const e of edgeList) {
    if (leaves.has(e.to)) {
      id(e.to, assetLeaves.has(e.to) ? "investing" : roleOfLeaf.get(e.to));
    }
  }
  if (kept > 0) id("Kept", "kept");
  if (unitemised > 0) id(UNITEMISED, "idle");

  for (const e of edgeList) {
    links.push({ source: id(e.from), target: id(e.to), value: fromCents(e.cents) });
  }
  for (const [hub, gap] of shortfall) {
    links.push({ source: id("From savings"), target: id(hub), value: fromCents(gap) });
  }
  for (const [hub, left] of spare) {
    const target = investedHubs.has(hub) ? UNITEMISED : "Kept";
    links.push({ source: id(hub), target: id(target), value: fromCents(left) });
  }

  return { nodes, links };
}


