/**
 * Hard daily cap on calls to EODHD.
 *
 * The free plan allows 20 requests per day, resetting at 00:00 GMT, and going
 * over does not degrade — it simply fails. Every EODHD call in this app must
 * therefore reserve against this ledger first.
 *
 * The count lives in the database rather than in memory: an in-process counter
 * resets whenever the container restarts, which would let a handful of deploys
 * blow through a day's entire allowance. The ledger is keyed by the UTC date,
 * so it rolls over exactly when EODHD's own quota does.
 *
 * The pure decision below is separated from the storage so it can be tested
 * without a database — and without ever making a request that would itself
 * consume the allowance the tests exist to protect.
 */

/** The provider's free-plan allowance. Overridable so CI can pin it to zero. */
export const EODHD_DAY_LIMIT = Number(process.env.EODHD_DAY_LIMIT ?? 20);

/** `app_meta` key holding "YYYY-MM-DD:used". */
export const EODHD_QUOTA_KEY = "eodhd_quota";

/** The UTC date EODHD's quota is keyed to. */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** When the current allowance resets: the next 00:00 GMT. */
export function resetsAt(now: Date = new Date()): string {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return next.toISOString();
}

/** Calls already used on `today`, from a stored ledger value. */
export function usedFrom(value: string | undefined, today: string): number {
  if (!value) return 0;
  const [day, used] = value.split(":");
  if (day !== today) return 0; // a stale day means the allowance has reset
  const n = Number.parseInt(used ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Decide how many of `want` calls may be made, and what the ledger becomes.
 *
 * Grants partially on purpose: asking for 219 prices with 6 calls left should
 * refresh 6 of them rather than refusing outright and leaving every price
 * stale.
 */
export function grant(
  value: string | undefined,
  today: string,
  want: number,
  limit: number = EODHD_DAY_LIMIT,
): { granted: number; nextValue: string; used: number } {
  const used = usedFrom(value, today);
  const granted = Math.max(0, Math.min(Math.trunc(want), limit - used));
  return {
    granted,
    used: used + granted,
    nextValue: `${today}:${used + granted}`,
  };
}

/**
 * Which tickers still need a price today, in the order the day's allowance
 * should be spent on them.
 *
 * Anything already priced today is dropped — its EOD figure will not change
 * again until tomorrow. The rest are ordered oldest-first, so with far more
 * holdings than calls the allowance rotates through the portfolio instead of
 * refreshing the same leading handful every day and leaving the tail
 * permanently stale. Tickers never fetched sort first.
 */
export function selectEodhdDue<T extends { ticker: string }>(
  items: T[],
  lastFetched: Map<string, string>,
  today: string,
): T[] {
  return items
    .filter((item) => lastFetched.get(item.ticker) !== today)
    .sort((a, b) =>
      (lastFetched.get(a.ticker) ?? "").localeCompare(lastFetched.get(b.ticker) ?? ""),
    );
}
