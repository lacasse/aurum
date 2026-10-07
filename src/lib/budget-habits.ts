/**
 * The small, encouraging facts about keeping to a budget: a streak, a
 * category's best month, a row of months kept, and a year looked back on.
 *
 * Budgets are stored without a history — a limit is today's limit — so every
 * past month here is judged against the budgets as they stand now. The page
 * says so wherever it shows one of these.
 */
import { fromCents, toCents } from "./money";
import { expenseMonths, groupOf, monthlySpend, type SpendGroup } from "./expenses";
import { monthKeyOf } from "./format";
import type { Transaction } from "./types";

/** Expense cents by month, then by category. */
function spendByMonth(transactions: Transaction[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const t of transactions) {
    if (t.type !== "expense") continue;
    const key = monthKeyOf(t.date);
    const row = out.get(key) ?? new Map<string, number>();
    row.set(t.category, (row.get(t.category) ?? 0) + toCents(t.amount));
    out.set(key, row);
  }
  return out;
}

export interface BudgetMonth {
  key: string;
  /** Spent on the categories that have a budget. */
  spent: number;
  budgeted: number;
  under: boolean;
  /** Each budgeted category's month: what it cost, and whether it kept to its limit. */
  categories: Record<string, { spent: number; limit: number; under: boolean }>;
}

/**
 * Each of `months` against today's budgets. Only categories with a budget
 * count, the same rule as the budget comparison card.
 */
export function budgetHistory(
  transactions: Transaction[],
  limits: Map<string, number>,
  months: string[],
): BudgetMonth[] {
  if (limits.size === 0) return [];
  const byMonth = spendByMonth(transactions);
  const budgetedCents = [...limits.values()].reduce((s, l) => s + toCents(l), 0);
  return months.map((key) => {
    const row = byMonth.get(key);
    let spentCents = 0;
    const categories: BudgetMonth["categories"] = {};
    for (const [category, limit] of limits) {
      const c = row?.get(category) ?? 0;
      spentCents += c;
      categories[category] = {
        spent: fromCents(c),
        limit,
        under: c <= toCents(limit),
      };
    }
    return {
      key,
      spent: fromCents(spentCents),
      budgeted: fromCents(budgetedCents),
      under: spentCents <= budgetedCents,
      categories,
    };
  });
}

/**
 * The months a budget is judged on, as of the month being read: every month
 * on record up to and including it, but never one still running — a month
 * half spent is not under budget yet, it is only early.
 */
export function judgedMonths(months: readonly string[], selected: string, now: string): string[] {
  return months.filter((m) => m <= selected && m < now);
}

export interface StreakDot {
  key: string;
  spent: number;
  limit: number;
  under: boolean;
}

/**
 * One category's monthly streak: its last `n` judged months, oldest first,
 * each kept to its budget or not. A month the category had no spending in is
 * a month kept; a month with nothing on record at all is not a month here.
 */
export function categoryStreak(history: BudgetMonth[], category: string, n = 6): StreakDot[] {
  return history
    .slice(-n)
    .flatMap((m) => {
      const c = m.categories[category];
      return c ? [{ key: m.key, spent: c.spent, limit: c.limit, under: c.under }] : [];
    });
}

export interface Streak {
  /** Months in a row under budget, counting back from the newest. */
  run: number;
  /** Finished months judged at all, so "no record yet" reads differently from zero. */
  judged: number;
}

/**
 * The budget streak: every month under budget in a row adds one, counting
 * back from the newest finished month. A month over ends it.
 */
export function budgetStreak(history: BudgetMonth[]): Streak {
  let run = 0;
  for (let i = history.length - 1; i >= 0 && history[i].under; i--) run++;
  return { run, judged: history.length };
}

export interface PersonalBest {
  category: string;
  amount: number;
  /** How many months back it is the lowest of. */
  months: number;
}

/**
 * Categories that had their cheapest month in a while.
 *
 * Only a category that turns up nearly every month qualifies — something
 * bought twice a year is "cheapest" most months by not being bought — and it
 * has to beat every one of the months behind it, not tie.
 */
export function personalBests(
  transactions: Transaction[],
  month: string,
  overrides: Record<string, SpendGroup> = {},
  window = 12,
  minMonths = 6,
): PersonalBest[] {
  const byMonth = spendByMonth(transactions);
  const prior = [...byMonth.keys()]
    .filter((k) => k < month)
    .sort()
    .slice(-window);
  if (prior.length < minMonths || !byMonth.has(month)) return [];

  const categories = new Set<string>();
  for (const k of prior) for (const c of byMonth.get(k)!.keys()) categories.add(c);

  const out: PersonalBest[] = [];
  for (const category of categories) {
    if (groupOf(category, overrides) === "excluded") continue;
    const values = prior.map((k) => byMonth.get(k)!.get(category));
    const seen = values.filter((v) => v !== undefined).length;
    if (seen < prior.length - 1) continue;
    const now = byMonth.get(month)!.get(category) ?? 0;
    if (values.every((v) => now < (v ?? 0))) {
      out.push({ category, amount: fromCents(now), months: prior.length });
    }
  }
  return out.sort((a, b) => a.category.localeCompare(b.category));
}

export interface YearReview {
  year: number;
  /** Months of the year with spending on record. */
  months: number;
  total: number;
  previousTotal: number | null;
  cheapest: { key: string; total: number } | null;
  priciest: { key: string; total: number } | null;
  /** The category that dropped the most a month against the year before. */
  improved: { category: string; before: number; after: number } | null;
  /** The category that cost the most over the year. */
  largest: { category: string; total: number } | null;
  /** Finished months judged against today's budgets, and how many kept to them. */
  judged: number;
  monthsUnder: number;
  /** What those months came in under budget by, added up. Over months add nothing. */
  kept: number;
}

/** The year, read back: what it cost, its best and worst months, and the budget. */
export function yearReview(
  transactions: Transaction[],
  year: number,
  overrides: Record<string, SpendGroup>,
  limits: Map<string, number>,
  finishedBefore: string,
): YearReview {
  const prefix = `${year}-`;
  const prevPrefix = `${year - 1}-`;
  const spend = monthlySpend(transactions, overrides);
  const thisYear = spend.filter((m) => m.key.startsWith(prefix));
  const lastYear = spend.filter((m) => m.key.startsWith(prevPrefix));
  const sum = (ms: typeof spend) =>
    fromCents(ms.reduce((s, m) => s + toCents(m.total), 0));

  const byTotal = [...thisYear].sort((a, b) => a.total - b.total);

  // A category's cost per month on record in each year, consumption only.
  const byMonth = spendByMonth(transactions);
  const perMonth = (p: string) => {
    const keys = [...byMonth.keys()].filter((k) => k.startsWith(p));
    const totals = new Map<string, number>();
    for (const k of keys) {
      for (const [c, v] of byMonth.get(k)!) {
        if (groupOf(c, overrides) === "excluded") continue;
        totals.set(c, (totals.get(c) ?? 0) + v);
      }
    }
    return { months: keys.length, totals };
  };
  const now = perMonth(prefix);
  const before = perMonth(prevPrefix);

  let improved: YearReview["improved"] = null;
  if (now.months > 0 && before.months >= 3) {
    let best = 0;
    for (const [c, cents] of before.totals) {
      const was = cents / before.months;
      const is = (now.totals.get(c) ?? 0) / now.months;
      if (was - is > best) {
        best = was - is;
        improved = {
          category: c,
          before: fromCents(Math.round(was)),
          after: fromCents(Math.round(is)),
        };
      }
    }
  }

  let largest: YearReview["largest"] = null;
  for (const [c, cents] of now.totals) {
    if (!largest || cents > toCents(largest.total)) largest = { category: c, total: fromCents(cents) };
  }

  const judgedKeys = thisYear.map((m) => m.key).filter((k) => k < finishedBefore);
  const history = budgetHistory(transactions, limits, judgedKeys);
  const kept = history.reduce(
    (s, m) => s + Math.max(0, toCents(m.budgeted) - toCents(m.spent)),
    0,
  );

  return {
    year,
    months: thisYear.length,
    total: sum(thisYear),
    previousTotal: lastYear.length > 0 ? sum(lastYear) : null,
    cheapest: byTotal[0] ? { key: byTotal[0].key, total: byTotal[0].total } : null,
    priciest: byTotal.length
      ? { key: byTotal[byTotal.length - 1].key, total: byTotal[byTotal.length - 1].total }
      : null,
    improved,
    largest,
    judged: history.length,
    monthsUnder: history.filter((m) => m.under).length,
    kept: fromCents(kept),
  };
}

/**
 * A budget for every category from what it has actually cost: its total over
 * the last twelve finished months on record, divided by the number of those
 * months, rounded to the dollar. The same window and the same division as the
 * 12-month average on the expenses page, so the two agree.
 *
 * A month still running is never part of it, nor is anything marked as not
 * consumption — debt repayment is not something to budget down. A category
 * that cost nothing over the window is left out rather than given a budget of
 * nothing.
 */
export function averageBudgets(
  transactions: Transaction[],
  overrides: Record<string, SpendGroup>,
  now: string,
  window = 12,
): Map<string, number> {
  const months = expenseMonths(transactions)
    .filter((m) => m < now)
    .slice(-window);
  const out = new Map<string, number>();
  if (months.length === 0) return out;
  const keys = new Set(months);
  const totals = new Map<string, number>();
  for (const t of transactions) {
    if (t.type !== "expense" || !keys.has(monthKeyOf(t.date))) continue;
    if (groupOf(t.category, overrides) === "excluded") continue;
    totals.set(t.category, (totals.get(t.category) ?? 0) + toCents(t.amount));
  }
  for (const [category, cents] of totals) {
    const perMonth = Math.round(cents / months.length / 100);
    if (perMonth > 0) out.set(category, perMonth);
  }
  return out;
}

/**
 * The budgets in force: the ones set by hand, or — while the owner has asked
 * for budgets to follow the 12-month average — that average, recomputed as
 * the months go by. Every reader of a budget takes it from here, so the
 * expenses page and the year's review can never disagree about what it was.
 *
 * Following the average never writes over the budgets set by hand; they are
 * simply not read while it is on.
 */
export function effectiveLimits(
  budgets: readonly { category: string; limit: number }[],
  followAverage: boolean,
  transactions: Transaction[],
  overrides: Record<string, SpendGroup>,
  now: string,
): Map<string, number> {
  if (!followAverage) return new Map(budgets.map((b) => [b.category, b.limit]));
  return averageBudgets(transactions, overrides, now);
}
