/**
 * Centralized rate / quota guard for the Twelve Data free plan:
 *   - 8 API credits per minute
 *   - 800 API credits per day
 *
 * Credits are consumed per symbol per request for the /price and
 * /exchange_rate endpoints (weight 1 each). All Twelve Data calls should
 * reserve() their credits before hitting the API so we never exceed either
 * limit, and can degrade to stale/cached data instead of hard-failing.
 */

const PER_MINUTE_LIMIT = Number(process.env.TWELVEDATA_MINUTE_LIMIT ?? 8);
const PER_DAY_LIMIT = Number(process.env.TWELVEDATA_DAY_LIMIT ?? 800);
// Stay comfortably under the hard limits to absorb bursts and clock skew.
const MINUTE_RESERVE = Number(process.env.TWELVEDATA_MINUTE_RESERVE ?? 1);
const DAY_RESERVE = Number(process.env.TWELVEDATA_DAY_RESERVE ?? 100);

interface Bucket {
  window: number; // window key
  used: number;   // credits used in the current window
}

const minute: Bucket = { window: 0, used: 0 };
const day: Bucket = { window: 0, used: 0 };

function minuteKey(now: number): number {
  return Math.floor(now / 60_000);
}

function dayKey(now: number): number {
  // UTC day (Twelve Data's documented reset point is midnight UTC).
  return Math.floor(now / 86_400_000);
}

/** Best-effort: keep in-sync buckets when time moves forward. */
function rollover(now: number): void {
  const mKey = minuteKey(now);
  if (minute.window !== mKey) {
    minute.window = mKey;
    minute.used = 0;
  }
  const dKey = dayKey(now);
  if (day.window !== dKey) {
    day.window = dKey;
    day.used = 0;
  }
}

/**
 * Try to reserve `credits`. Returns true if within both limits and the
 * reservation was recorded; false if it would exceed either limit.
 */
export function reserveTwelveDataCredits(credits: number): boolean {
  const now = Date.now();
  rollover(now);

  if (day.used + credits > PER_DAY_LIMIT - DAY_RESERVE) return false;
  if (minute.used + credits > PER_MINUTE_LIMIT - MINUTE_RESERVE) return false;

  minute.used += credits;
  day.used += credits;
  return true;
}

/** Current usage stats (for logging / debugging). */
export function twelveDataUsage(): { minute: number; day: number } {
  rollover(Date.now());
  return { minute: minute.used, day: day.used };
}
