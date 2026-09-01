import {
  labelMonth,
  lastMonthKeys,
  monthKeyOf,
  previousMonthKey,
} from "./format";
import { fromCents, roundMoney, toCents } from "./money";
import type { Transaction } from "./types";

/**
 * Spending, looked at as spending.
 *
 * The dashboard answers "how much is left"; this answers "where it goes and
 * whether that is changing". The two need different arithmetic: a cash-flow
 * figure wants the month in progress excluded and everything netted, while a
 * category breakdown wants one named month held still and compared against
 * what a normal month looks like.
 */

/* ── Necessity and discretion ── */

export type SpendGroup = "necessity" | "discretionary" | "excluded";

export const SPEND_GROUPS: SpendGroup[] = [
  "necessity",
  "discretionary",
  "excluded",
];

export const SPEND_GROUP_LABELS: Record<SpendGroup, string> = {
  necessity: "Necessity",
  discretionary: "Discretionary",
  excluded: "Not consumption",
};

/**
 * Which categories are the ones you cannot simply stop paying.
 *
 * The line is drawn at commitment rather than at pleasure: rent, food,
 * getting to work, keeping a body and a dog alive are obligations that arrive
 * whether or not the month went well. Dining, travel and gifts are choices
 * made one at a time, and they are the ones a bad quarter can actually move.
 *
 * Every one of these is arguable — donations may feel less optional than
 * groceries — which is why the split is a default rather than a rule, and can
 * be reassigned per category. Anything not listed is treated as
 * discretionary, so a new category shows up on the side that gets scrutiny.
 */
export const DEFAULT_SPEND_GROUPS: Record<string, SpendGroup> = {
  Housing: "necessity",
  Groceries: "necessity",
  Transport: "necessity",
  Utilities: "necessity",
  Health: "necessity",
  Insurance: "necessity",
  Taxes: "necessity",
  Household: "necessity",
  Fees: "necessity",
  Dog: "necessity",
  "Drinks & Dining": "discretionary",
  Dining: "discretionary",
  Entertainment: "discretionary",
  Shopping: "discretionary",
  Travel: "discretionary",
  Subscriptions: "discretionary",
  Education: "discretionary",
  Donations: "discretionary",
  Gifts: "discretionary",
  "Gifts for myself": "discretionary",
  Other: "discretionary",
  /*
   * Paying down a loan is not consumption. The money leaves the chequing
   * account and lands on the other side of the balance sheet as debt that no
   * longer exists, so counting it as an expense both overstates what living
   * costs and understates what was saved — on this record it is what turned
   * 2024 into a year that apparently spent $132k and saved nothing.
   */
  "Debt Repayment": "excluded",
};

export function groupOf(
  category: string,
  overrides: Record<string, SpendGroup> = {},
): SpendGroup {
  return overrides[category] ?? DEFAULT_SPEND_GROUPS[category] ?? "discretionary";
}

/** The full assignment for a set of categories, defaults included. */
export function grouping(
  categories: readonly string[],
  overrides: Record<string, SpendGroup> = {},
): Record<string, SpendGroup> {
  const out: Record<string, SpendGroup> = {};
  for (const c of categories) out[c] = groupOf(c, overrides);
  return out;
}

/* ── The months that exist ── */

/** Every month with an expense in it, oldest first. */
export function expenseMonths(transactions: Transaction[]): string[] {
  const keys = new Set<string>();
  for (const t of transactions) {
    if (t.type === "expense") keys.add(monthKeyOf(t.date));
  }
  return [...keys].sort();
}

/**
 * The newest month that has any spending recorded.
 *
 * Not the calendar month: a record kept by hand runs behind the calendar, and
 * opening the page to a month nobody has entered yet shows a page of zeros
 * and reports a 100% collapse in spending.
 */
export function latestExpenseMonth(transactions: Transaction[]): string | null {
  const months = expenseMonths(transactions);
  return months[months.length - 1] ?? null;
}

/* ── Month by month ── */

export interface MonthSpend {
  key: string;
  label: string;
  total: number;
  necessity: number;
  discretionary: number;
  /** Debt repayment and anything else marked as not consumption. */
  excluded: number;
}

/**
 * Every month on record, split three ways. Months with no spending in them
 * are left out rather than drawn as zero: they are months that were never
 * entered, and a zero says something the record does not know.
 */
export function monthlySpend(
  transactions: Transaction[],
  overrides: Record<string, SpendGroup> = {},
): MonthSpend[] {
  const byMonth = new Map<
    string,
    { total: number; necessity: number; discretionary: number; excluded: number }
  >();
  for (const t of transactions) {
    if (t.type !== "expense") continue;
    const key = monthKeyOf(t.date);
    const slot =
      byMonth.get(key) ??
      { total: 0, necessity: 0, discretionary: 0, excluded: 0 };
    const cents = toCents(t.amount);
    const group = groupOf(t.category, overrides);
    slot[group] += cents;
    if (group !== "excluded") slot.total += cents;
    byMonth.set(key, slot);
  }
  return [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, v]) => ({
      key,
      label: labelMonth(key),
      total: fromCents(v.total),
      necessity: fromCents(v.necessity),
      discretionary: fromCents(v.discretionary),
      excluded: fromCents(v.excluded),
    }));
}

/**
 * A trailing mean drawn beside the monthly bars.
 *
 * Null until there are `n` months behind a point, so the line starts where it
 * becomes an average rather than opening as a copy of the first bar.
 */
export function rollingAverage(values: number[], n = 12): (number | null)[] {
  return values.map((_, i) => {
    if (i + 1 < n) return null;
    const window = values.slice(i + 1 - n, i + 1);
    return roundMoney(window.reduce((a, b) => a + b, 0) / n);
  });
}

/* ── One month, in detail ── */

export interface CategoryRow {
  category: string;
  group: SpendGroup;
  amount: number;
  /** What this category costs in a normal month over the comparison window. */
  average: number;
  /** This month against that average, in dollars. */
  delta: number;
  /** Share of the month's consumption spending. */
  share: number;
  /** How many months of the window this category appeared in. */
  monthsSeen: number;
  monthsInWindow: number;
  /** The same month a year earlier, when the record reaches back that far. */
  lastYear: number | null;
  series: { key: string; label: string; value: number }[];
}

/**
 * Every category that cost anything either this month or in the window
 * behind it, ranked by what it cost this month.
 *
 * A category that has stopped is worth seeing — it is the difference between
 * a cheap month and a month with a bill still to come — so the rows are the
 * union of both, not just what has been spent.
 */
export function categoryRows(
  transactions: Transaction[],
  month: string,
  overrides: Record<string, SpendGroup> = {},
  window = 12,
): CategoryRow[] {
  // The window ends on the month before the one being read, so a month is
  // never compared against an average it is itself part of.
  const keys = lastMonthKeys(window, previousMonthKey(month));
  const inWindow = new Set(keys);
  const yearAgo = lastMonthKeys(13, month)[0];

  const cents = new Map<string, Map<string, number>>();
  const add = (category: string, key: string, amount: number) => {
    const row = cents.get(category) ?? new Map<string, number>();
    row.set(key, (row.get(key) ?? 0) + toCents(amount));
    cents.set(category, row);
  };
  const activeMonths = new Set<string>();

  for (const t of transactions) {
    if (t.type !== "expense") continue;
    const key = monthKeyOf(t.date);
    if (key !== month && key !== yearAgo && !inWindow.has(key)) continue;
    if (inWindow.has(key)) activeMonths.add(key);
    add(t.category, key, t.amount);
  }

  // Months nobody entered are not frugal months. Averaging over them would
  // report every category as costing less than it does.
  const denominator = activeMonths.size;

  const rows: CategoryRow[] = [];
  let monthTotalCents = 0;
  for (const [category, byMonth] of cents) {
    if (groupOf(category, overrides) === "excluded") continue;
    monthTotalCents += byMonth.get(month) ?? 0;
  }

  for (const [category, byMonth] of cents) {
    const amount = fromCents(byMonth.get(month) ?? 0);
    let windowCents = 0;
    let seen = 0;
    for (const key of keys) {
      const v = byMonth.get(key);
      if (v === undefined) continue;
      windowCents += v;
      seen++;
    }
    const average =
      denominator === 0 ? 0 : roundMoney(fromCents(windowCents) / denominator);
    const group = groupOf(category, overrides);
    rows.push({
      category,
      group,
      amount,
      average,
      delta: roundMoney(amount - average),
      share:
        group === "excluded" || monthTotalCents === 0
          ? 0
          : ((byMonth.get(month) ?? 0) / monthTotalCents) * 100,
      monthsSeen: seen,
      monthsInWindow: denominator,
      lastYear: byMonth.has(yearAgo) ? fromCents(byMonth.get(yearAgo)!) : null,
      series: [...keys, month].map((key) => ({
        key,
        label: labelMonth(key),
        value: fromCents(byMonth.get(key) ?? 0),
      })),
    });
  }

  return rows.sort(
    (a, b) => b.amount - a.amount || Math.abs(b.delta) - Math.abs(a.delta),
  );
}

export interface MonthSummary {
  key: string;
  total: number;
  necessity: number;
  discretionary: number;
  excluded: number;
  /** Share of consumption spending that was discretionary. */
  discretionaryShare: number | null;
  previous: number | null;
  average: number | null;
  averageMonths: number;
  lastYear: number | null;
  /** 1 = the most expensive month on record. Null when the month has nothing. */
  rank: number | null;
  months: number;
}

export function monthSummary(
  transactions: Transaction[],
  month: string,
  overrides: Record<string, SpendGroup> = {},
  window = 12,
): MonthSummary {
  const all = monthlySpend(transactions, overrides);
  const byKey = new Map(all.map((m) => [m.key, m]));
  const here = byKey.get(month);
  const keys = lastMonthKeys(window, previousMonthKey(month));
  const priorMonths = keys.map((k) => byKey.get(k)).filter((m): m is MonthSpend => !!m);
  const total = here?.total ?? 0;
  const consumption = (here?.necessity ?? 0) + (here?.discretionary ?? 0);

  const ranked = [...all].sort((a, b) => b.total - a.total);
  const rank = here ? ranked.findIndex((m) => m.key === month) + 1 : null;

  return {
    key: month,
    total,
    necessity: here?.necessity ?? 0,
    discretionary: here?.discretionary ?? 0,
    excluded: here?.excluded ?? 0,
    discretionaryShare:
      consumption === 0 ? null : ((here?.discretionary ?? 0) / consumption) * 100,
    previous: byKey.get(previousMonthKey(month))?.total ?? null,
    average:
      priorMonths.length === 0
        ? null
        : roundMoney(
            priorMonths.reduce((sum, m) => sum + m.total, 0) / priorMonths.length,
          ),
    averageMonths: priorMonths.length,
    lastYear: byKey.get(lastMonthKeys(13, month)[0])?.total ?? null,
    rank,
    months: all.length,
  };
}

/* ── The floor ── */

export interface FloorItem {
  category: string;
  /** The middle month, not the mean: one $4,000 vet bill is not a commitment. */
  typical: number;
  months: number;
}

export interface Floor {
  total: number;
  items: FloorItem[];
  window: number;
}

/**
 * What a month costs before anything is decided.
 *
 * The categories that turned up in nearly every month of the window are the
 * ones that arrive on their own; their median month is what they usually
 * take. The sum is the floor: the number that has to be cleared before a
 * month can be called cheap, and the one that matters when asking how long
 * savings would last.
 *
 * Median rather than mean, because these series contain the odd large month —
 * an annual insurance payment, a vet emergency — and a mean would fold a
 * once-a-year charge into every month's baseline.
 */
export function recurringFloor(
  transactions: Transaction[],
  overrides: Record<string, SpendGroup> = {},
  window = 12,
  end?: string,
): Floor {
  const last = end ?? latestExpenseMonth(transactions);
  if (!last) return { total: 0, items: [], window: 0 };
  const keys = lastMonthKeys(window, last);
  const inWindow = new Set(keys);

  const cents = new Map<string, Map<string, number>>();
  const activeMonths = new Set<string>();
  for (const t of transactions) {
    if (t.type !== "expense") continue;
    const key = monthKeyOf(t.date);
    if (!inWindow.has(key)) continue;
    if (groupOf(t.category, overrides) === "excluded") continue;
    activeMonths.add(key);
    const row = cents.get(t.category) ?? new Map<string, number>();
    row.set(key, (row.get(key) ?? 0) + toCents(t.amount));
    cents.set(t.category, row);
  }

  const n = activeMonths.size;
  if (n === 0) return { total: 0, items: [], window: 0 };
  // One month may be missed — a bill paid a day late lands in the next month —
  // without the cost ceasing to be a commitment.
  const threshold = Math.max(1, n - 1);

  const items: FloorItem[] = [];
  for (const [category, byMonth] of cents) {
    const values = [...activeMonths]
      .map((k) => byMonth.get(k) ?? 0)
      .sort((a, b) => a - b);
    const seen = values.filter((v) => v > 0).length;
    if (seen < threshold) continue;
    const mid = Math.floor(values.length / 2);
    const median =
      values.length % 2 === 0 ? (values[mid - 1] + values[mid]) / 2 : values[mid];
    items.push({ category, typical: fromCents(median), months: seen });
  }
  items.sort((a, b) => b.typical - a.typical);
  return {
    total: roundMoney(items.reduce((sum, i) => sum + i.typical, 0)),
    items,
    window: n,
  };
}

/* ── The cost of a thing you own ── */

export interface RunningCost {
  /** Everything spent in the chosen categories over the period. */
  total: number;
  /**
   * Calendar months from the start to the end, inclusive — including the ones
   * with no charge in them.
   *
   * A car costs what it costs whether or not it was filled up this month;
   * averaging only over the months with a receipt would price it off its
   * expensive months alone and report a car that costs half again as much as
   * it does.
   */
  months: number;
  perMonth: number;
  perYear: number;
  /** Months that actually had a charge, so the sparseness is visible. */
  monthsWithSpend: number;
  largest: { key: string; value: number } | null;
  series: { key: string; label: string; value: number }[];
}

export function runningCost(
  transactions: Transaction[],
  categories: readonly string[],
  start: string,
  end: string,
): RunningCost {
  const wanted = new Set(categories);
  const empty: RunningCost = {
    total: 0,
    months: 0,
    perMonth: 0,
    perYear: 0,
    monthsWithSpend: 0,
    largest: null,
    series: [],
  };
  if (wanted.size === 0 || start > end) return empty;

  const keys: string[] = [];
  for (let key = start; key <= end; key = nextMonthKey(key)) keys.push(key);
  if (keys.length === 0) return empty;

  const byMonth = new Map<string, number>(keys.map((k) => [k, 0]));
  for (const t of transactions) {
    if (t.type !== "expense") continue;
    if (!wanted.has(t.category)) continue;
    const key = monthKeyOf(t.date);
    if (!byMonth.has(key)) continue;
    byMonth.set(key, byMonth.get(key)! + toCents(t.amount));
  }

  const totalCents = [...byMonth.values()].reduce((a, b) => a + b, 0);
  const perMonth = roundMoney(fromCents(totalCents) / keys.length);
  const series = keys.map((key) => ({
    key,
    label: labelMonth(key),
    value: fromCents(byMonth.get(key) ?? 0),
  }));
  const largest = series.reduce<{ key: string; value: number } | null>(
    (best, p) => (p.value > 0 && (!best || p.value > best.value) ? p : best),
    null,
  );

  return {
    total: fromCents(totalCents),
    months: keys.length,
    perMonth,
    perYear: roundMoney(perMonth * 12),
    monthsWithSpend: series.filter((p) => p.value > 0).length,
    largest,
    series,
  };
}

function nextMonthKey(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
