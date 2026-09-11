/*
 * "Year to date" as a window over a monthly series, answered in one place so
 * every chart that offers it means the same months by it.
 */

/**
 * The months of a series that fall in the year to date.
 *
 * `withBase` keeps the December before the year began. A level — net worth, a
 * portfolio's value, a return compounded from a starting point — is read from
 * the close the year opened on, so the chart starts where the year did rather
 * than a month in. A flow — income, spending — is the year's own months only,
 * and a December there would be last year's money in this year's bars.
 */
export function yearToDate<T>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  { withBase }: { withBase: boolean },
  today: Date = new Date(),
): T[] {
  const year = today.getFullYear();
  const from = withBase ? `${year - 1}-12` : `${year}-01`;
  return rows.filter((r) => keyOf(r) >= from);
}

/**
 * How many whole months the year to date holds, read off the last complete
 * month (`YYYY-MM`). In January that month is last December, so the answer is
 * the whole of the year just ended rather than nothing at all — the only year
 * that has any complete months to show.
 */
export function monthsToDate(through: string): number {
  return Number(through.slice(5, 7));
}
