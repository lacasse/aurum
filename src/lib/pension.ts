import { Account, MonthlyPoint, Transaction } from "./types";
import { currentMonthKey, monthKeyOf } from "./format";
import { fromCents, roundMoney, toCents } from "./money";

/**
 * A defined benefit pension, and the two numbers that describe it.
 *
 * What you put in is known exactly — it comes off every pay and is recorded
 * like any other income. What the plan is worth is not derivable from it at
 * all: the transfer value is an actuarial figure that moves with interest
 * rates and with service, and it includes the employer's side. So one figure
 * is read from the transactions and the other is asked for, and the gap
 * between them is the part of the pension that is not your own money.
 */

/** The category a pension contribution is recorded under. */
export const PENSION_CATEGORY = "RSP / Pension";

/** Contributions per month, from the transactions that record them. */
export function contributionsByMonth(
  transactions: Transaction[],
): Record<string, number> {
  const cents: Record<string, number> = {};
  for (const t of transactions) {
    if (t.category !== PENSION_CATEGORY) continue;
    const month = monthKeyOf(t.date);
    cents[month] = (cents[month] ?? 0) + toCents(t.amount);
  }
  const out: Record<string, number> = {};
  for (const [month, c] of Object.entries(cents)) out[month] = fromCents(c);
  return out;
}

/** The last month whose value the user actually entered. */
export function lastRecordedMonth(acc: Account): string | null {
  for (let i = acc.history.length - 1; i >= 0; i--) {
    if (!acc.history[i].estimated) return acc.history[i].month;
  }
  return null;
}

/**
 * What the pension is probably worth in a month nobody recorded.
 *
 * Only the contributions since the last real figure are added. It is the one
 * defensible estimate available: that money certainly went in. It ignores the
 * employer's share and any change in the actuarial value, so it runs low
 * rather than flattering — an estimate that overstates net worth would be
 * worse than none. Every month it produces is marked as an estimate, and the
 * next figure entered by hand replaces it.
 */
export function estimateValue(
  acc: Account,
  byMonth: Record<string, number>,
  month = currentMonthKey(),
): number {
  const from = lastRecordedMonth(acc);
  if (!from) return acc.balance;
  const base =
    acc.history.find((p) => p.month === from)?.value ?? acc.balance;
  let added = 0;
  for (const [key, amount] of Object.entries(byMonth)) {
    if (key > from && key <= month) added += toCents(amount);
  }
  return roundMoney(base + fromCents(added));
}

export interface PensionPoint extends MonthlyPoint {
  /** Contributions made up to and including this month. */
  contributed: number;
}

export interface PensionSummary {
  /** The transfer value as it stands, recorded or estimated. */
  value: number;
  /** True when no figure has been entered for the current month. */
  estimated: boolean;
  /** The month of the last figure entered by hand. */
  asOf: string | null;
  /** Everything paid in, ever. */
  contributed: number;
  /** Paid in since the last figure was entered. */
  contributedSince: number;
  /** The average month's contribution over the last twelve recorded. */
  monthly: number;
  /** Transfer value less contributions: the employer's side, and growth. */
  beyondContributions: number;
  /** Month by month, for the chart. */
  series: PensionPoint[];
}

export function summarize(
  acc: Account,
  transactions: Transaction[],
  month = currentMonthKey(),
): PensionSummary {
  const byMonth = contributionsByMonth(transactions);
  const asOf = lastRecordedMonth(acc);
  const current = acc.history.find((p) => p.month === month);
  const estimated = current === undefined || current.estimated === true;
  const value = estimated ? estimateValue(acc, byMonth, month) : current.value;

  /*
   * The contributions line is cumulative from the first contribution, not
   * from the first month the account has a value for. Those are years apart —
   * contributions were being recorded long before the transfer value was —
   * and counting only from the later one drew a third of what was paid in.
   */
  const first = acc.history[0]?.month;
  let runningCents = 0;
  if (first) {
    for (const [key, amount] of Object.entries(byMonth)) {
      if (key < first) runningCents += toCents(amount);
    }
  }
  const series: PensionPoint[] = acc.history.map((p) => {
    runningCents += toCents(byMonth[p.month] ?? 0);
    return { ...p, contributed: fromCents(runningCents) };
  });

  const contributedCents = Object.values(byMonth).reduce(
    (sum, v) => sum + toCents(v),
    0,
  );
  const contributed = fromCents(contributedCents);

  let sinceCents = 0;
  for (const [key, amount] of Object.entries(byMonth)) {
    if (asOf && key > asOf && key <= month) sinceCents += toCents(amount);
  }

  const recent = Object.entries(byMonth)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-12);
  const monthly =
    recent.length > 0
      ? roundMoney(recent.reduce((sum, [, v]) => sum + v, 0) / recent.length)
      : 0;

  return {
    value,
    estimated,
    asOf,
    contributed,
    contributedSince: fromCents(sinceCents),
    monthly,
    beyondContributions: roundMoney(value - contributed),
    series,
  };
}
