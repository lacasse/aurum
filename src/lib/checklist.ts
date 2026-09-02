import {
  labelMonth,
  lastMonthKeys,
  monthKeyOf,
  previousMonthKey,
} from "./format";
import { roundMoney } from "./money";
import type { ImportedRow } from "./csv";
import type { Transaction } from "./types";

/**
 * What the monthly checklist knows that the general importer does not: it is
 * closing one particular month.
 *
 * The /import page exists to take whatever you have, including years of it.
 * The checklist is a ritual performed once a month, on the month that has just
 * finished — so a statement that spans a quarter, or one downloaded mid-month
 * and carrying a week of the current one, is mostly noise here. Trimming it to
 * the month being closed is what keeps the ritual from silently importing
 * September's groceries into August's total, or re-importing July's.
 */

export interface MonthPartition<T> {
  /** Rows inside the month being closed. */
  kept: T[];
  /** Rows from before it — already accounted for in an earlier month. */
  older: T[];
  /** Rows from the month still running, which is not this month's business. */
  newer: T[];
}

export function partitionByMonth<T extends { date: string }>(
  rows: T[],
  month: string,
): MonthPartition<T> {
  const out: MonthPartition<T> = { kept: [], older: [], newer: [] };
  for (const row of rows) {
    const key = monthKeyOf(row.date);
    if (key === month) out.kept.push(row);
    else if (key < month) out.older.push(row);
    else out.newer.push(row);
  }
  return out;
}

/** Plain English for what a partition threw away, or "" when it kept everything. */
export function describeTrim(
  older: number,
  newer: number,
  month: string,
  label: string,
): string {
  const parts: string[] = [];
  if (older > 0) parts.push(`${older} from before ${month}`);
  if (newer > 0) parts.push(`${newer} from the month still running`);
  if (parts.length === 0) return "";
  return `Ignored ${parts.join(" and ")} — ${label} outside ${month} belong to another month's close.`;
}

/* ── Income, as the file reports it ── */

/**
 * The four figures the checklist has always asked for, and what an imported
 * row has to say to fill one.
 *
 * The categories are the point rather than the labels: the dashboard's
 * uncommitted cash flow subtracts pension contributions and its passive income
 * counts interest, so a box that files its total under the wrong one is worse
 * than a box left empty.
 */
export const STANDARD_INCOME_BOXES = [
  { key: "netPay", label: "Net pay", category: "Salary" },
  { key: "pension", label: "Pension", category: "RSP / Pension" },
  { key: "additional", label: "Additional income", category: "Additional Income" },
  { key: "interest", label: "Interest & cashback", category: "Interest" },
] as const;

/**
 * What the given categories came to in the month before this one.
 *
 * Only the month immediately before, and only where something was recorded:
 * reaching further back would carry a figure from a job or a plan that may no
 * longer exist, and the point is to repeat the last one, not to guess.
 */
export function previousMonthIncome(
  transactions: Transaction[],
  month: string,
  categories: readonly string[],
): Record<string, number> {
  const want = new Set(categories);
  const previous = previousMonthKey(month);
  const out: Record<string, number> = {};
  for (const t of transactions) {
    if (t.type !== "income" || !want.has(t.category)) continue;
    if (monthKeyOf(t.date) !== previous) continue;
    out[t.category] = roundMoney((out[t.category] ?? 0) + t.amount);
  }
  return out;
}

export interface IncomeBox {
  key: string;
  label: string;
  category: string;
  /** The total the import found, which is what the box opens at. */
  detected: number;
  /** How many rows made it up, so a surprising figure can be traced. */
  rows: number;
  /** True for a box the import added rather than one always asked for. */
  extra: boolean;
  /**
   * What the same category came to in the month before, when the import found
   * nothing for it. Filled in as a starting figure, and said so in the UI —
   * carried silently it would be a number nobody entered.
   */
  carried?: number;
}

/**
 * One box per kind of income, seeded with the four that are always asked for.
 *
 * Anything else the file found — a dividend, a refund, money borrowed — gets
 * its own box rather than being folded into "additional" or dropped. Folding
 * would put it under a category the rest of the app reads differently, and
 * dropping would lose it: these rows are not written anywhere else, since this
 * step is the only thing that records income.
 */
export function incomeBoxes(
  rows: ImportedRow[],
  /**
   * The month before the one being closed, by category. A pension
   * contribution is the same figure month after month and rarely appears on
   * the statement the checklist reads — it is deducted at source — so a box
   * left at zero is nearly always the previous month's figure repeated, not a
   * month it was not paid.
   */
  carriedForward: Record<string, number> = {},
): IncomeBox[] {
  const totals = new Map<string, { amount: number; rows: number }>();
  for (const r of rows) {
    if (r.type !== "income" || !r.include) continue;
    const slot = totals.get(r.category) ?? { amount: 0, rows: 0 };
    slot.amount += r.amount;
    slot.rows += 1;
    totals.set(r.category, slot);
  }

  const boxes: IncomeBox[] = STANDARD_INCOME_BOXES.map((b) => ({
    key: b.key,
    label: b.label,
    category: b.category,
    detected: roundMoney(totals.get(b.category)?.amount ?? 0),
    rows: totals.get(b.category)?.rows ?? 0,
    carried:
      (totals.get(b.category)?.amount ?? 0) === 0 && carriedForward[b.category] > 0
        ? roundMoney(carriedForward[b.category])
        : undefined,
    extra: false,
  }));

  const standard = new Set<string>(STANDARD_INCOME_BOXES.map((b) => b.category));
  for (const [category, slot] of totals) {
    if (standard.has(category)) continue;
    boxes.push({
      key: `extra:${category}`,
      label: category,
      category,
      detected: roundMoney(slot.amount),
      rows: slot.rows,
      extra: true,
    });
  }
  return boxes;
}


/* ── Months the record skipped ── */

export type GapKind = "missing" | "thin";

export interface SnapshotGap {
  month: string;
  kind: GapKind;
  /** Positions actually recorded for the month. */
  positions: number;
  /** What the months either side of it hold, for comparison. */
  expected: number;
}

/**
 * Months whose portfolio was never written down, or barely was.
 *
 * Nothing takes a snapshot on its own — if the checklist is not run, the month
 * simply has no closing value, and every chart that reaches back through it
 * draws a straight line across the hole. The gap is invisible on those charts
 * precisely because there is nothing there to see, so it has to be looked for
 * on purpose.
 *
 * Two shapes of hole are worth reporting:
 *
 *   **missing** — nothing recorded at all. A month whose rows are all zero
 *   counts here too: it was saved, but it recorded nothing, which is the same
 *   hole wearing a hat.
 *
 *   **thin** — recorded, but holding a fraction of what the months either side
 *   hold. Three months at five positions between months at twelve is not a
 *   portfolio that shrank and recovered; it is a month that was half entered.
 *
 * Half of the larger neighbour is a deliberately quiet threshold. A portfolio
 * genuinely drifts — fourteen positions become eleven over a year — and a
 * warning that fires on ordinary consolidation is one nobody reads.
 */
export function snapshotGaps(
  recorded: Record<string, number>,
  through: string,
  window = 24,
): SnapshotGap[] {
  const months = Object.keys(recorded).sort();
  // Before the record opens there is nothing to have missed.
  if (months.length === 0) return [];
  const first = months[0];

  /*
   * What a healthy month looks like *around here*, rather than across the
   * whole record.
   *
   * The obvious rule — compare against the month next door — fails on the case
   * that matters most: three thin months in a row vouch for each other, and
   * only the one touching a healthy month is caught. The obvious fix, compare
   * against the largest month ever recorded, fails the other way, since a
   * portfolio that halves over five years would have its later years reported
   * as half-entered.
   *
   * A window either side is both: wide enough that a run of thin months still
   * sees a healthy one, narrow enough that it is compared against the era it
   * belongs to.
   */
  const NEIGHBOURHOOD = 6;
  const localBest = (month: string): number => {
    const lo = shiftMonth(month, -NEIGHBOURHOOD);
    const hi = shiftMonth(month, NEIGHBOURHOOD);
    let best = 0;
    for (const m of months) {
      if (m < lo || m > hi || m === month) continue;
      best = Math.max(best, recorded[m]);
    }
    return best;
  };

  const gaps: SnapshotGap[] = [];
  for (const month of lastMonthKeys(window, through)) {
    if (month < first) continue;
    const expected = localBest(month);
    const positions = recorded[month] ?? 0;
    if (positions === 0) {
      gaps.push({ month, kind: "missing", positions: 0, expected });
    } else if (expected > 0 && positions * 2 < expected) {
      gaps.push({ month, kind: "thin", positions, expected });
    }
  }
  return gaps;
}

/** A month key moved `n` months, forwards or back. */
function shiftMonth(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** A sentence naming the gaps, or "" when the record has none. */
export function describeGaps(gaps: SnapshotGap[]): string {
  if (gaps.length === 0) return "";
  const missing = gaps.filter((g) => g.kind === "missing").map((g) => labelMonth(g.month));
  const thin = gaps.filter((g) => g.kind === "thin").map((g) => labelMonth(g.month));
  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(
      `${missing.length === 1 ? "has no closing value for" : "has no closing value for"} ${list(missing)}`,
    );
  }
  if (thin.length > 0) {
    parts.push(`only partly recorded ${list(thin)}`);
  }
  return `The portfolio record ${parts.join(", and is ")}.`;
}

function list(items: string[]): string {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
