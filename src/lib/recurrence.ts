/**
 * Date arithmetic for recurring transactions.
 *
 * Kept free of `Date` where it matters: parsing "2026-01-31" with the local
 * `Date` constructor and adding a month lands somewhere different depending on
 * the runtime's timezone, and a bill dated the 31st must not drift a day every
 * time it is posted. The month-based frequencies work on the calendar parts
 * directly and clamp to the end of short months, so a rule anchored on the
 * 31st posts on Feb 28 and then returns to the 31st in March.
 */
import type { RecurrenceFrequency, RecurringRule } from "./types";

function parse(iso: string): [number, number, number] {
  const [y, m, d] = iso.split("-").map(Number);
  return [y, m, d];
}

function format(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = parse(iso);
  const at = new Date(Date.UTC(y, m - 1, d + days));
  return format(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate());
}

/** Add whole months, clamping the day to the target month's length. */
function addMonths(iso: string, months: number, anchorDay: number): string {
  const [y, m] = parse(iso);
  const total = (y * 12 + (m - 1)) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return format(year, month, Math.min(anchorDay, daysInMonth(year, month)));
}

/** The day of the month a rule is anchored to, taken from its start date. */
export function anchorDayOf(rule: Pick<RecurringRule, "startDate">): number {
  return parse(rule.startDate)[2];
}

/** The occurrence following `dateISO`. */
export function nextOccurrence(
  dateISO: string,
  frequency: RecurrenceFrequency,
  anchorDay: number,
): string {
  switch (frequency) {
    case "weekly":
      return addDays(dateISO, 7);
    case "biweekly":
      return addDays(dateISO, 14);
    case "monthly":
      return addMonths(dateISO, 1, anchorDay);
    case "quarterly":
      return addMonths(dateISO, 3, anchorDay);
    case "yearly":
      return addMonths(dateISO, 12, anchorDay);
  }
}

/**
 * Every date a rule should have posted on, from its `nextDate` up to and
 * including `today`. Returns an empty list for an inactive or finished rule.
 *
 * `limit` bounds the catch-up: a weekly rule whose start date was mistyped as
 * 1926 would otherwise generate five thousand transactions.
 */
export function dueOccurrences(
  rule: RecurringRule,
  today: string,
  limit = 400,
): string[] {
  if (!rule.active) return [];
  const anchorDay = anchorDayOf(rule);
  const out: string[] = [];
  let cursor = rule.nextDate;
  while (cursor <= today && out.length < limit) {
    if (rule.endDate && cursor > rule.endDate) break;
    out.push(cursor);
    cursor = nextOccurrence(cursor, rule.frequency, anchorDay);
  }
  return out;
}

/**
 * Where the rule stands after posting `posted`: the date it should next fire,
 * and whether it has now run out.
 */
export function advanceRule(
  rule: RecurringRule,
  posted: string[],
): { nextDate: string; active: boolean } {
  const anchorDay = anchorDayOf(rule);
  let nextDate = rule.nextDate;
  for (let i = 0; i < posted.length; i++) {
    nextDate = nextOccurrence(nextDate, rule.frequency, anchorDay);
  }
  const finished = rule.endDate !== undefined && nextDate > rule.endDate;
  return { nextDate, active: rule.active && !finished };
}
