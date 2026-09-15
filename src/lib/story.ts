import { fmtCAD } from "./format";
import type { PeriodShape } from "./year";

/**
 * The judgements the overview makes, kept apart from the page that draws them.
 *
 * Every figure the overview shows already exists somewhere — the roll-forward,
 * the flow chart, the floor, the withdrawal arithmetic. What is new here is
 * the page deciding what those figures *mean*: which part of a year's change
 * mattered, and which facts deserve somebody's attention. Those are claims,
 * and a claim made by a component is a claim nobody tests.
 */

/** A month is a twelfth of a year only when the window really is twelve months. */
export function perMonth(total: number, months: number): number {
  return months > 0 ? total / months : 0;
}

/**
 * What moved net worth, when one thing clearly did.
 *
 * The roll-forward splits a change into what was saved and everything else —
 * markets mostly, but also a pension accruing and the exchange rate. Naming one
 * of them as the reason is an interpretation, so it is only offered when the
 * arithmetic makes it hard to argue with: one side at least twice the size of
 * the other. Anything closer is two causes, and saying "mostly" about it would
 * be the page guessing.
 */
export type Driver = "saving" | "markets";

export function netWorthDriver(
  shape: Pick<PeriodShape, "saved" | "revaluation">,
): Driver | null {
  const saved = Math.abs(shape.saved);
  const moved = Math.abs(shape.revaluation);
  if (saved === 0 && moved === 0) return null;
  if (saved >= 2 * moved) return "saving";
  if (moved >= 2 * saved) return "markets";
  return null;
}

/** The short clause under the headline figure. */
export function driverPhrase(
  shape: Pick<PeriodShape, "saved" | "revaluation" | "openingNetWorth" | "netWorth">,
): string | null {
  const driver = netWorthDriver(shape);
  if (driver === null) return null;
  const rose = shape.netWorth >= shape.openingNetWorth;
  if (driver === "saving") {
    return shape.saved >= 0
      ? rose
        ? "driven mainly by net savings"
        : "despite positive net savings"
      : "driven mainly by a savings shortfall";
  }
  return shape.revaluation >= 0
    ? rose
      ? "driven mainly by revaluation"
      : "despite positive revaluation"
    : "driven mainly by negative revaluation";
}

export interface WatchItem {
  key: string;
  /** Worth knowing, or worth acting on. */
  tone: "caution" | "concern";
  title: string;
  detail: string;
  href: string;
}

/** Under this many months of spending in cash, the buffer is thin. */
export const THIN_RUNWAY_MONTHS = 3;
/** A move of this share against the same stretch before is worth a line. */
export const NOTABLE_CHANGE = 0.1;

export interface WatchInput {
  /** Months of spending the cash on hand covers, or null with no spending. */
  runway: number | null;
  spending: number;
  spendingBefore: number | null;
  income: number;
  incomeBefore: number | null;
  saved: number;
  debtOpening: number;
  debtClosing: number;
  /** Months missing a recorded portfolio value. */
  snapshotGaps: number;
}

/**
 * The few things in the record that deserve attention, and nothing else.
 *
 * A list that always has something in it trains people to skip it, so every
 * entry has a threshold and most months nothing crosses one. An empty list is
 * the page saying the record looks steady, which is itself worth hearing.
 * Ordered by how much each one matters rather than by where it came from.
 */
export function watchList(input: WatchInput): WatchItem[] {
  const items: WatchItem[] = [];
  const pct = (n: number) => `${Math.round(Math.abs(n) * 100)}%`;

  if (input.saved < 0) {
    items.push({
      key: "overspent",
      tone: "concern",
      title: "Expenses exceeded income",
      detail: `Expenses ran ${fmtCAD(Math.abs(input.saved))} ahead of income over the period, so net savings were negative.`,
      href: "/expenses",
    });
  }

  if (input.runway !== null && input.runway < THIN_RUNWAY_MONTHS) {
    items.push({
      key: "runway",
      tone: input.runway < 1 ? "concern" : "caution",
      title: "Low cash runway",
      detail: `Liquid cash covers ${input.runway.toFixed(1)} months of average expenses, under the ${THIN_RUNWAY_MONTHS}-month threshold.`,
      href: "/accounts",
    });
  }

  if (input.debtClosing > input.debtOpening && input.debtClosing > 0) {
    items.push({
      key: "debt",
      tone: "caution",
      title: "Liabilities increased",
      detail: `Total liabilities rose by ${fmtCAD(input.debtClosing - input.debtOpening)} over the period.`,
      href: "/accounts",
    });
  }

  if (input.spendingBefore !== null && input.spendingBefore > 0) {
    const change = (input.spending - input.spendingBefore) / input.spendingBefore;
    if (change >= NOTABLE_CHANGE) {
      items.push({
        key: "spending",
        tone: "caution",
        title: "Expenses are up",
        detail: `Average monthly expenses are ${pct(change)} higher than in the prior twelve months.`,
        href: "/expenses",
      });
    }
  }

  if (input.incomeBefore !== null && input.incomeBefore > 0) {
    const change = (input.income - input.incomeBefore) / input.incomeBefore;
    if (change <= -NOTABLE_CHANGE) {
      items.push({
        key: "income",
        tone: "caution",
        title: "Income is down",
        detail: `Average monthly income is ${pct(change)} lower than in the prior twelve months.`,
        href: "/income",
      });
    }
  }

  if (input.snapshotGaps > 0) {
    items.push({
      key: "snapshots",
      tone: "caution",
      title: "Gaps in the portfolio record",
      detail: `${input.snapshotGaps} month${input.snapshotGaps === 1 ? " has" : "s have"} no recorded portfolio valuation. The monthly checklist fills them in.`,
      href: "/investments",
    });
  }

  const rank = { concern: 0, caution: 1 } as const;
  return items.sort((a, b) => rank[a.tone] - rank[b.tone]);
}

/**
 * How much of a month the portfolio already pays for, as a share.
 *
 * Against the floor rather than against all spending: the floor is what a
 * month costs before anything is decided, and income that covers it is the
 * part of independence that has already happened. Capped at a hundred,
 * because covering the floor twice over is not more covered.
 */
export function coverage(passivePerMonth: number, floor: number): number | null {
  if (floor <= 0) return null;
  return Math.min(100, (Math.max(passivePerMonth, 0) / floor) * 100);
}
