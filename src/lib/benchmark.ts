import { currentMonthKey } from "./format";

/** The security the portfolio is measured against, and its stored source tag. */
export const BENCHMARK_TICKER = "XEQT.TO";
export const BENCHMARK_SOURCE = "benchmark";

/**
 * EODHD's free plan serves one year of history whatever range is asked for,
 * so a gap longer than this cannot be filled from it however many calls are
 * spent. Asking for more would burn the allowance to be told the same thing.
 */
export const MAX_FILL_MONTHS = 12;

/** The month after `key`. */
export function nextMonth(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return m === 12
    ? `${y + 1}-01`
    : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/**
 * Completed months the benchmark series is missing, oldest first.
 *
 * The current month is deliberately excluded. Its close does not exist yet, and
 * writing a month-to-date figure into a series of month-end closes would put a
 * different kind of number in the same column — then either leave it stale for
 * the rest of the month or re-fetch it daily, turning one call a month into
 * thirty. The month you are in is the checklist's job; this fills the months
 * you were not here for.
 *
 * Returns nothing when the series is current, which is the ordinary case and
 * must cost no API call at all.
 */
export function missingMonths(
  lastStored: string | null,
  current: string = currentMonthKey(),
  max: number = MAX_FILL_MONTHS,
): string[] {
  if (!lastStored) return [];
  const out: string[] = [];
  let month = nextMonth(lastStored);
  while (month < current && out.length < max) {
    out.push(month);
    month = nextMonth(month);
  }
  return out;
}

interface EodhdBar {
  date?: string;
  close?: number;
}

/**
 * Month-end closes from EODHD's monthly bars.
 *
 * A monthly bar is dated by the month's first trading day and closes on its
 * last, so the bar's `close` is the month-end price and its month key comes
 * from the date. Verified against the recorded series: EODHD's 2026-07 bar
 * closes at 44.80, which is the figure in the spreadsheet.
 */
export function parseMonthlyBars(json: unknown): Map<string, number> {
  const out = new Map<string, number>();
  if (!Array.isArray(json)) return out;
  for (const bar of json as EodhdBar[]) {
    const date = bar?.date;
    const close = bar?.close;
    if (typeof date !== "string" || date.length < 7) continue;
    if (typeof close !== "number" || !Number.isFinite(close) || close <= 0) continue;
    out.set(date.slice(0, 7), Math.round(close * 100) / 100);
  }
  return out;
}
