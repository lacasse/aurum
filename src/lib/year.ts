import {
  NON_SPENDABLE_INCOME,
  PASSIVE_INCOME_CATEGORIES,
  chainedReturns,
  isIncome,
} from "./analytics";
import type { ClassPoint, NetWorthPoint, PortfolioPoint } from "./analytics";
import type { Account, AccountKind, Holding } from "./types";
import { Transaction } from "./types";
import { fromCents, roundMoney, toCents } from "./money";
import { PENSION_CATEGORY } from "./pension";
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

/* ── One category, across the years ── */

export interface CategoryYears {
  /** The years drawn, oldest first, which is the order the bars go in. */
  years: string[];
  /** One row per category: its name, and a total under each year's key. */
  rows: Record<string, string | number>[];
}

/**
 * What each category cost, year against year.
 *
 * This replaced a chart of the change against the year before, which read
 * more directly — a difference is easier to see as a difference than as two
 * columns to subtract by eye — but could not show a direction: one bad year
 * and one good year are the same single step to it. Three or four years of a
 * category side by side is the thing that comparison kept almost saying.
 *
 * The tail is pooled rather than dropped, for the same reason it is pooled in
 * the flow chart: a chart of spending that quietly leaves some spending out
 * invites the reader to add up what they can see, and get the wrong answer.
 *
 * Years are capped because the bars are drawn side by side rather than
 * stacked, so every year added makes every bar thinner — past four the
 * categories stop being legible, and the year-by-year table is the better
 * tool for a long record anyway.
 */
export function categoryByYear(
  transactions: Transaction[],
  { years = 4, limit = 8 }: { years?: number; limit?: number } = {},
): CategoryYears {
  const totals = new Map<string, Map<string, number>>();
  const seen = new Set<string>();
  for (const t of transactions) {
    if (t.type !== "expense") continue;
    const cents = toCents(t.amount);
    if (cents <= 0) continue;
    const y = t.date.slice(0, 4);
    seen.add(y);
    const row = totals.get(t.category) ?? new Map<string, number>();
    row.set(y, (row.get(y) ?? 0) + cents);
    totals.set(t.category, row);
  }

  const drawn = [...seen].sort().slice(-years);
  if (drawn.length === 0) return { years: [], rows: [] };
  const inRange = (m: Map<string, number>) =>
    drawn.reduce((a, y) => a + (m.get(y) ?? 0), 0);

  const ranked = [...totals.entries()]
    .map(([category, m]) => [category, m, inRange(m)] as const)
    .filter(([, , total]) => total > 0)
    .sort((a, b) => b[2] - a[2] || a[0].localeCompare(b[0]));

  /*
   * Pooling one category renames it and saves nothing, so below two the rule
   * does nothing — the same guard the flow chart's sources use.
   */
  const keep = ranked.length - limit === 1 ? ranked.length : limit;
  const shown = ranked.slice(0, keep);
  const rest = ranked.slice(keep);

  const rowOf = (name: string, m: Map<string, number>) => {
    const row: Record<string, string | number> = { category: name };
    for (const y of drawn) row[y] = fromCents(m.get(y) ?? 0);
    return row;
  };

  const rows = shown.map(([category, m]) => rowOf(category, m));
  if (rest.length > 0) {
    const pooled = new Map<string, number>();
    for (const [, m] of rest) {
      for (const y of drawn) pooled.set(y, (pooled.get(y) ?? 0) + (m.get(y) ?? 0));
    }
    rows.push(rowOf("Other", pooled));
  }
  return { years: drawn, rows };
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
/**
 * Three kinds, because "not active" was never the same thing as passive.
 *
 * Passive income is what your assets pay you while you do nothing: interest,
 * cashback and dividends — cashback lands under Interest, which is where the
 * record already keeps it. Read instead as everything that was not earned by
 * working, the band quietly collected gifts as well, and a year with a large
 * one reported a quarter of its income as coming from assets when the true
 * figure was near enough nothing. That is the one reading of this chart that
 * matters — how close the assets are to covering the year — and it was the
 * one being flattered.
 *
 * A gift is neither. It was not worked for and no asset produced it, and
 * forcing it into one of the two bands makes that band mean less. Refunds and
 * borrowing are not here at all: neither is income, and `NOT_INCOME` keeps
 * them out of every total that answers what came in.
 */
export function incomeTypeAmounts(
  transactions: Transaction[],
  year: string,
): { Active: number; Passive: number; Other: number } {
  let active = 0;
  let passive = 0;
  let other = 0;
  for (const t of transactions) {
    if (!isIncome(t) || t.date.slice(0, 4) !== year) continue;
    const cents = toCents(t.amount);
    if (WORK_CATEGORIES.has(t.category)) active += cents;
    else if (PASSIVE_INCOME_CATEGORIES.has(t.category)) passive += cents;
    else other += cents;
  }
  return {
    Active: fromCents(active),
    Passive: fromCents(passive),
    Other: fromCents(other),
  };
}

export function incomeTypeShares(
  transactions: Transaction[],
): Record<string, string | number>[] {
  const byYear = new Map<string, { active: number; passive: number; other: number }>();
  for (const t of transactions) {
    if (!isIncome(t)) continue;
    const year = t.date.slice(0, 4);
    const slot = byYear.get(year) ?? { active: 0, passive: 0, other: 0 };
    const cents = toCents(t.amount);
    if (WORK_CATEGORIES.has(t.category)) slot.active += cents;
    else if (PASSIVE_INCOME_CATEGORIES.has(t.category)) slot.passive += cents;
    else slot.other += cents;
    byYear.set(year, slot);
  }
  return [...byYear.keys()].sort().map((year) => {
    const { active, passive, other } = byYear.get(year)!;
    const total = active + passive + other;
    return {
      label: year,
      Active: total > 0 ? (active / total) * 100 : 0,
      Other: total > 0 ? (other / total) * 100 : 0,
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
    | "pension"
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

/**
 * Everything that arrived in an account you can spend from, as one bar.
 *
 * Arrived, not earned, and not new: in a year that outspends itself a drawn
 * balance lands here too, and it is neither. The plainest true word is the one
 * that survives that case, and it pairs with "Kept" at the other end.
 *
 * Five chequing and savings accounts down the middle answered "which one" for
 * a reader who was not asking, so the column says the kind of place the money
 * sat rather than which account it was.
 *
 * Cards belong in it, and drawing them apart was wrong rather than merely
 * busy. A card is paid off by a transfer from a chequing account, and this
 * chart drops transfers between your own accounts — so a card's spending had
 * no visible funding and was invented on the left as "From savings", while the
 * salary that really paid it sat in cash with nothing to buy and fell out the
 * far end as "Kept". Two errors of exactly the same size, cancelling, which is
 * why the chart balanced perfectly while telling you that money earned this
 * year had been saved in some earlier one.
 *
 * Merged, the payment becomes a link from the bar to itself, which is no flow
 * and needs no rule to exclude it, and a card expense is simply spending — the
 * thing it always was. What is lost is the distinction between paying now and
 * paying next month, which is a question about a balance rather than about a
 * year's spending, and the balance sheet answers it.
 */
const CASH = "Money in";
const CASH_KINDS = new Set<AccountKind>([
  "checking",
  "savings",
  "cash",
  "credit",
]);

/**
 * A pension contribution is not a purchase, and it is not idle cash either.
 *
 * The money arrives in a plan that has no trades to import — an entitlement
 * accrues instead — so measured against buys it looked like a shortfall, and
 * the year appeared to have funded its investing out of savings it never
 * touched. Pension is already its own class on the balance sheet beside cash,
 * bonds, stocks and crypto; this is the same class, seen as it is bought.
 */
const PENSION_ASSET = "Pension";

/** Where the categories too thin to draw go. */
const OTHER_INCOME = "Other income";

/**
 * Below this share of the year's income, a category is pooled rather than
 * drawn.
 *
 * Counting the categories and keeping the top few is the wrong measure: eight
 * sources can be eight readable bands one year and one band with seven
 * hairlines under it the next, because what matters is not how many there are
 * but how much of the total each one is. At a fiftieth, a band is a line a
 * pixel or two thick carrying a label and the padding around it — a row of
 * chart height spent on something that cannot be seen and does not move the
 * picture.
 *
 * The count cap stays as a ceiling for the case this misses: many categories
 * of similar, respectable size.
 */
const MIN_SOURCE_SHARE = 0.01;

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
/**
 * Spending that goes straight to what it was for, with no bar in between.
 *
 * Only the invested bar needs this, and only because it already stands in the
 * column the Spending bar stands in. See where it is set.
 */
const DIRECT = "__direct";
/** Selling a position, which is money arriving rather than leaving. */
const SOLD = "Sold investments";
/**
 * Money borrowed, which arrived without being earned.
 *
 * `isIncome` excludes a drawdown from every figure that answers "what came
 * in", and it is right to: a loan is a liability appearing on the other side
 * of the ledger at the same moment, and counting it as income makes a month of
 * borrowing look like a month of earning.
 *
 * A flow chart is not an average, though. The money did arrive in an account
 * and it did pay for things, so leaving it out does not make the chart
 * cautious — it makes it wrong. What it paid for still had to be drawn, so the
 * account came up short by exactly the amount borrowed and the difference was
 * drawn as a balance carried in. The chart balanced perfectly while saying the
 * year had dipped into savings, when it had borrowed and finished ahead.
 *
 * So it is drawn, in its own band, beside the sale proceeds: money in, plainly
 * not income, and plainly not savings either.
 */
const BORROWED = "Borrowed";
/**
 * Money of yours coming back — a refund, a reimbursement, a returned item.
 *
 * Not income, for the reason `NOT_INCOME` gives: the spending that sent it out
 * was already counted, so counting the return as earnings books one movement
 * twice. But it arrives in an account and it funds what comes next, so a flow
 * chart has to draw it or invent a balance to stand in for it.
 *
 * Told apart from borrowing because they are opposites. One is somebody else's
 * money arriving with a debt attached; the other is your own coming home.
 */
const RETURNED = "Money back";
/** What an invested account took in and has no purchases to account for. */
const UNITEMISED = "Not itemised";

/**
 * What arrived in a spendable account and was neither spent nor moved on.
 *
 * Not "Kept", which the savings-rate card already uses for income less
 * spending — a far larger figure, because money moved into investments is
 * kept by any ordinary reading of the word and this is only what stayed as
 * cash. One page cannot use one word for two numbers that differ by that much.
 *
 * It is a flow and not a balance: the year's cash in, less the year's cash
 * out. That is the change across the year rather than what sits in the account
 * at the end of it, which is this plus whatever the year opened with.
 */
const OPENING = "Opening balance";
const CLOSING = "Closing balance";
/**
 * What the record cannot explain about the year's cash.
 *
 * With the balances at both ends drawn, the bar has to reconcile against real
 * accounts rather than against itself: opening, plus everything that came in,
 * less everything that went out, ought to be closing. Where it is not, the
 * difference is a movement the record does not hold — an uncategorised
 * transfer, a month never imported, a balance corrected by hand.
 *
 * It used to be drawn as "From savings" on the way in and "Left in cash" on
 * the way out, which named a cause for it. Neither was known to be true; the
 * only honest thing to say about the gap is that it is one, and which way it
 * points.
 */
const UNEXPLAINED = "Not accounted for";
/**
 * What the difference is called when there are no balances to check against.
 *
 * Without them the bar can only balance against itself, and the difference is
 * simply the year's cash change — genuinely what was left over, or genuinely
 * what had to come from somewhere else. It is only once real balances are
 * drawn at both ends that an unexplained remainder can exist at all, so the
 * chart says the weaker thing when it knows the weaker thing.
 */
const LEFT_OVER = "Left in cash";
const FROM_BALANCE = "From savings";
/** A balance is drawn straight off the bar, with no purpose in between. */
const BALANCE = "__balance";

const GROUP_ROLE: Record<string, FlowNode["role"]> = {
  [SPENDING]: "necessity",
};
/** The three ends of the spending branch, each its own colour. */
const LEAF_ROLE: Record<string, FlowNode["role"]> = {
  [SPEND_GROUP_LABELS.necessity]: "necessity",
  [SPEND_GROUP_LABELS.discretionary]: "discretionary",
  [SPEND_GROUP_LABELS.excluded]: "debt",
  /* Money still there at the end is not something the year spent. */
  [CLOSING]: "kept",
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
  /**
   * The spendable balance at the start and end of the year.
   *
   * Given both, the bar reconciles against the accounts themselves rather than
   * against its own arithmetic, and whatever the transactions do not explain
   * is drawn as its own band instead of being folded silently into what was
   * kept. Omit either and the chart falls back to balancing itself.
   */
  openingCash?: number;
  closingCash?: number;
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
    openingCash,
    closingCash,
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
    if (INVESTED_KINDS.has(a.kind)) return INVESTMENTS;
    if (CASH_KINDS.has(a.kind)) return CASH;
    return a.name;
  };

  const incomeTotals = new Map<string, number>();
  const spendTotals = new Map<string, number>();
  const investTotals = new Map<string, number>();
  const hubTotals = new Map<string, number>();
  /** Whether the invested bar is on this year's chart at all. */
  let anyInvested = false;
  /** Contributions to a pension plan, and any purchases already recorded in one. */
  let pensionIn = 0;
  let pensionBuys = 0;
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
      /*
       * A pension contribution is decided by its category, not by the account
       * the row happens to name.
       *
       * `contributionsByMonth` reads the category to work out what the plan is
       * worth, and the import files a contribution under it whatever account
       * the statement line came from — payroll deducts it before the money
       * ever reaches an account you hold. Reading the destination instead meant
       * a contribution recorded against chequing, which is what payroll shows,
       * was drawn arriving in the spendable bar and then spent, so the plan it
       * actually went into never appeared on the chart at all.
       *
       * Two code paths were answering "is this a pension contribution" and only
       * one of them was right.
       */
      const contribution = t.category === PENSION_CATEGORY;
      const hub = contribution ? INVESTMENTS : hubOf(t.destinationAccountId);
      if (hub === INVESTMENTS) anyInvested = true;
      if (contribution || byId.get(t.destinationAccountId ?? "")?.kind === "pension") {
        pensionIn += cents;
      }
      note(incomeTotals, t.category, cents);
      note(hubTotals, hub, cents);
      rows.push({ from: t.category, to: hub, cents, stage: 1 });
    } else if (t.type === "income") {
      /*
       * Income by type but not by nature: borrowing. See BORROWED. It reaches
       * an account like anything else, so it is drawn arriving in one.
       */
      const hub = hubOf(t.destinationAccountId);
      if (hub === INVESTMENTS) anyInvested = true;
      const band = t.category === "Loan Proceeds" ? BORROWED : RETURNED;
      note(incomeTotals, band, cents);
      note(hubTotals, hub, cents);
      rows.push({ from: band, to: hub, cents, stage: 1 });
    } else if (t.type === "expense") {
      const hub = hubOf(t.sourceAccountId);
      note(spendTotals, SPEND_GROUP_LABELS[spendGroup(t.category)], cents);
      note(hubTotals, hub, cents);
      /*
       * A fee or a tax charged inside an investment account is spending, and it
       * came out of that account — but it must not pass through the Spending
       * bar on the way.
       *
       * That bar stands in the column after the accounts, so a link into it
       * from the invested bar, which is already in that column, pushes it into
       * the next one. The chart then runs five columns deep, every ordinary
       * link from an account to a category looks like it skips one, and each
       * gets a slot reserved for a crossing it was never making. Three
       * transactions out of a hundred and fifty rearranged the whole picture.
       *
       * Drawn straight to what it was for instead: the leaves still add up to
       * every dollar spent, and the Spending bar becomes what was spent out of
       * an account you can spend from, which is what the column beside it is
       * already about.
       */
      rows.push({
        from: hub,
        to: SPEND_GROUP_LABELS[spendGroup(t.category)],
        cents,
        stage: 2,
        group: hub === INVESTMENTS ? DIRECT : SPENDING,
      });
    } else if (t.type === "transfer") {
      const dest = byId.get(t.destinationAccountId ?? "");
      if (!dest || !INVESTED_KINDS.has(dest.kind)) continue;
      const hub = hubOf(t.sourceAccountId);
      // Moving between two invested accounts is not a flow through the year.
      if (hub === INVESTMENTS) continue;
      anyInvested = true;
      if (dest.kind === "pension") pensionIn += cents;
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
   * The balances at either end, so the bar answers to the accounts.
   *
   * Drawn only where the bar exists — a year with no spendable account has no
   * balance to open or close — and only when there is something to draw.
   */
  if (hubTotals.has(CASH)) {
    const opening = toCents(openingCash ?? 0);
    const closing = toCents(closingCash ?? 0);
    if (opening > 0) {
      note(incomeTotals, OPENING, opening);
      note(hubTotals, CASH, opening);
      rows.push({ from: OPENING, to: CASH, cents: opening, stage: 1 });
    }
    if (closing > 0) {
      note(hubTotals, CASH, closing);
      rows.push({ from: CASH, to: CLOSING, cents: closing, stage: 2, group: BALANCE });
    }
  }

  /*
   * The purchases and sales inside the accounts, netted over the year.
   *
   * Gross, a year that rotated one class into another put both legs on the
   * page — a sale on the left funding a purchase on the right — so a portfolio
   * that moved a fifth of itself drew several times the money that actually
   * crossed its boundary, and the salary and the spending were squeezed into
   * the margin by trading that left the portfolio the same size.
   *
   * Netted, a class bought and sold back within the year cancels and is not
   * drawn at all, which is the honest answer: nothing about the year's money
   * changed. What survives is what the year actually put into each class, and
   * a class sold down comes out negative — money the portfolio released, which
   * is a source, drawn on the left with the sale proceeds it is.
   *
   * Dividends are deliberately absent. A dividend is income under its own
   * category already, and the trade importer records the same payment against
   * the holding, so counting both would inflate the year by every one twice.
   */
  const netByClass = new Map<string, number>();
  for (const h of holdings) {
    const inPension = byId.get(h.accountId)?.kind === "pension";
    for (const f of h.flows ?? []) {
      if (f.date.slice(0, 4) !== year) continue;
      const cents = toCents(f.amount);
      if (cents <= 0) continue;
      const signed = f.kind === "buy" ? cents : f.kind === "sell" ? -cents : 0;
      if (signed === 0) continue;
      anyInvested = true;
      netByClass.set(h.assetClass, (netByClass.get(h.assetClass) ?? 0) + signed);
      if (inPension) pensionBuys += signed;
    }
  }
  /* What the portfolio released, whichever classes released it. */
  let soldDown = 0;
  for (const [assetClass, net] of netByClass) {
    if (net > 0) {
      note(hubTotals, INVESTMENTS, net);
      note(investTotals, assetClass, net);
      rows.push({ from: INVESTMENTS, to: assetClass, cents: net, stage: 2, group: ASSET });
    } else if (net < 0) {
      soldDown -= net;
    }
  }
  if (soldDown > 0) {
    note(incomeTotals, SOLD, soldDown);
    note(hubTotals, INVESTMENTS, soldDown);
    rows.push({ from: SOLD, to: INVESTMENTS, cents: soldDown, stage: 1 });
  }

  /*
   * What went into the plan and did not turn into a recorded purchase is the
   * entitlement itself. Subtracting the purchases keeps a plan that *does*
   * report its holdings from being counted twice.
   */
  const pensionAsset = Math.max(0, pensionIn - Math.max(0, pensionBuys));
  if (pensionAsset > 0) {
    note(investTotals, PENSION_ASSET, pensionAsset);
    rows.push({
      from: INVESTMENTS,
      to: PENSION_ASSET,
      cents: pensionAsset,
      stage: 2,
      group: ASSET,
    });
  }

  if (rows.length === 0) return { nodes: [], links: [] };

  /*
   * Past the limit, pooled rather than dropped. A chart that quietly omits the
   * long tail no longer adds up, and the whole value of a Sankey is that it
   * does. The hubs get a smaller allowance than the categories because they
   * are the spine: a dozen of them is a tangle, not a middle.
   */
  const pool = (
    totals: Map<string, number>,
    keep: number,
    other: string,
    minShare = 0,
  ) => {
    const ranked = [...totals.entries()]
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const total = ranked.reduce((a, [, v]) => a + v, 0);
    const floor = total * minShare;
    let kept = new Set(
      ranked.slice(0, keep).filter(([, v]) => v >= floor).map(([k]) => k),
    );
    /*
     * Pooling one thing renames it. "Other income" standing for a single
     * category says less than the category did and takes the same room, so
     * below two the rule does nothing.
     */
    if (ranked.length - kept.size === 1) kept = new Set(ranked.map(([k]) => k));
    return (name: string) => (kept.has(name) ? name : other);
  };
  /*
   * A sale is money arriving, but it is not an income category and must not
   * take one of their places in the ranking.
   */
  const categoryTotals = new Map(
    [...incomeTotals].filter(
      ([k]) => k !== SOLD && k !== BORROWED && k !== RETURNED && k !== OPENING,
    ),
  );
  const sourceName = pool(categoryTotals, limit, OTHER_INCOME, MIN_SOURCE_SHARE);
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
      const named =
        r.from === SOLD || r.from === BORROWED || r.from === RETURNED || r.from === OPENING;
      link(named ? r.from : sourceName(r.from), to, r.cents);
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
    if (group === ASSET || group === DIRECT || group === BALANCE) {
      // Straight off the account it came out of. See ASSET and DIRECT.
      link(from, leaf, r.cents);
      leaves.add(leaf);
      // A fee is still a fee: it keeps the colour and the place its category
      // has among the other spending, rather than joining the asset classes.
      if (group === ASSET) assetLeaves.add(leaf);
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
    .filter((n) => n !== SOLD && n !== BORROWED && n !== RETURNED && n !== OPENING)
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

  /*
   * Whether the bar was given real balances to answer to. See UNEXPLAINED.
   */
  const reconciled = openingCash !== undefined && closingCash !== undefined;
  const deficitName = reconciled ? UNEXPLAINED : FROM_BALANCE;
  const surplusName = reconciled ? UNEXPLAINED : LEFT_OVER;

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

  /*
   * An account with money left over goes to the foot of its column.
   *
   * What it did not spend runs to Kept, which sits below everything the money
   * was spent on — so from anywhere but the bottom that ribbon has to dive
   * past every other account's spending on the way. Ranked purely by size the
   * account that holds the salary is first, and with half a dozen others
   * under it the chart was six crossings that say nothing.
   *
   * Only what is left over decides this, not the size of the account: the one
   * with a remainder is the only one whose ribbon reaches past the column of
   * things the money became.
   */
  const holdsRemainder = (h: string) => spare.has(h) && !investedHubs.has(h);
  hubs.sort((a, b) => Number(holdsRemainder(a)) - Number(holdsRemainder(b)));

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
  /*
   * Sources by size, except that anything reaching past the first bar goes
   * under it.
   *
   * Most income lands in the spendable bar, but a pension contribution and the
   * proceeds of a sale go straight to the invested one — two columns along —
   * so their ribbons cross the first bar on the way. Ranked purely by size a
   * pension contribution sits near the top and its ribbon runs the width of
   * the spendable bar to get past it. Ordered by where they reach first and
   * only then by size, they sit below it and pass underneath.
   */
  const sourceTotals = new Map<string, number>();
  const reachesFirstBar = new Set<string>();
  const firstBars = new Set(hubs.filter((h) => !investedHubs.has(h)));
  for (const e of edgeList) {
    if (!hubs.includes(e.to) || hubs.includes(e.from)) continue;
    sourceTotals.set(e.from, (sourceTotals.get(e.from) ?? 0) + e.cents);
    if (firstBars.has(e.to)) reachesFirstBar.add(e.from);
  }
  if (shortfall.size > 0) {
    sourceTotals.set(
      deficitName,
      [...shortfall.values()].reduce((a, b) => a + b, 0),
    );
    for (const hub of shortfall.keys()) {
      if (firstBars.has(hub)) reachesFirstBar.add(deficitName);
    }
  }
  /*
   * Then each source sits beside the account it pays into.
   *
   * Moving the account with the remainder to the foot of its column is only
   * half of it: the salary that feeds that account has to come down with it,
   * or the crossing simply moves one column to the left, which is what
   * happened when the accounts were reordered on their own. Ordering a column
   * to agree with the next one is the whole rule, and it has to be applied to
   * every column or it buys nothing.
   *
   * Where a source pays into more than one account it follows the highest of
   * them, which is the only choice that cannot cross the ones above it.
   */
  const hubRank = new Map<string, number>();
  /*
   * Ranked among the bars in the first column only.
   *
   * `hubs` holds the invested bar as well, and it stands a column further
   * along, so ranking against the whole list let a source that pays a little
   * into investments as well as into cash take the invested bar's index and
   * sort above everything — which is how the pooled remainder ended up at the
   * top of the column it is supposed to sit at the foot of. The first
   * grouping already puts anything reaching past the first bar underneath; the
   * ordering within a group is only ever about the bars in that group.
   */
  const firstBarOrder = hubs.filter((h) => firstBars.has(h));
  for (const e of edgeList) {
    if (!firstBars.has(e.to) || hubs.includes(e.from)) continue;
    const rank = firstBarOrder.indexOf(e.to);
    hubRank.set(e.from, Math.min(hubRank.get(e.from) ?? rank, rank));
  }
  for (const hub of shortfall.keys()) {
    if (!firstBars.has(hub)) continue;
    const rank = firstBarOrder.indexOf(hub);
    hubRank.set(deficitName, Math.min(hubRank.get(deficitName) ?? rank, rank));
  }
  const rankOf = (name: string) => hubRank.get(name) ?? hubs.length;
  /*
   * Group first, then the account it lands in, then the pooled remainder,
   * then size. What is left over does not belong among the named things
   * ranked by weight — it is the floor of the group whatever it happens to
   * add up to, and a reader who finds it partway up the column has to check
   * that it is not a category.
   */
  const orderedSources = [...sourceTotals.entries()].sort(
    (a, b) =>
      Number(reachesFirstBar.has(b[0])) - Number(reachesFirstBar.has(a[0])) ||
      rankOf(a[0]) - rankOf(b[0]) ||
      Number(a[0] === OTHER_INCOME) - Number(b[0] === OTHER_INCOME) ||
      b[1] - a[1] ||
      a[0].localeCompare(b[0]),
  );
  for (const [name] of orderedSources) id(name, "source");
  /*
   * Spending before the invested bar, to match the column after it, where the
   * categories come before the asset classes. Two columns in the same order
   * is what keeps the ribbons between them from crossing.
   */
  for (const hub of hubs) {
    if (!investedHubs.has(hub)) id(hub, "account");
  }
  for (const g of [SPENDING]) if (groups.has(g)) id(g, GROUP_ROLE[g]);
  for (const hub of hubs) if (investedHubs.has(hub)) id(hub, "investing");
  for (const e of edgeList) {
    if (groups.has(e.from) && leaves.has(e.to)) {
      roleOfLeaf.set(e.to, LEAF_ROLE[e.to] ?? GROUP_ROLE[e.from]);
    }
  }
  /*
   * What was kept goes between the two sets of ends, not after them.
   *
   * It is the one band that reaches the last column without passing through
   * the one before it, so it crosses that column on the way — and wherever it
   * crosses, it runs behind whatever is standing there. Sat below the assets
   * it crossed the spending bar and read as something spending gave off.
   * Between the two, it crosses the gap between them instead.
   */
  for (const e of edgeList) {
    if (leaves.has(e.to) && !assetLeaves.has(e.to)) {
      id(e.to, roleOfLeaf.get(e.to) ?? LEAF_ROLE[e.to]);
    }
  }
  if (kept > 0) id(surplusName, reconciled ? "idle" : "kept");
  for (const e of edgeList) {
    if (assetLeaves.has(e.to)) {
      id(e.to, e.to === PENSION_ASSET ? "pension" : "investing");
    }
  }
  if (unitemised > 0) id(UNITEMISED, "idle");

  for (const e of edgeList) {
    links.push({ source: id(e.from), target: id(e.to), value: fromCents(e.cents) });
  }
  for (const [hub, gap] of shortfall) {
    links.push({ source: id(deficitName), target: id(hub), value: fromCents(gap) });
  }
  for (const [hub, left] of spare) {
    const target = investedHubs.has(hub) ? UNITEMISED : surplusName;
    links.push({ source: id(hub), target: id(target), value: fromCents(left) });
  }

  return { nodes, links };
}


