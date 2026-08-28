/**
 * Rate and quota guard for the Twelve Data free plan:
 *   - 8 API credits per minute
 *   - 800 API credits per day, resetting at 00:00 UTC
 *
 * Credits are consumed per symbol per request for the /price and
 * /exchange_rate endpoints (weight 1 each).
 *
 * The counters live in the database rather than in memory. An in-process
 * counter resets whenever the container restarts, so a redeploy — or a second
 * instance, or a test run against a live key — starts from zero and can push
 * the provider past a limit it is still counting. Both windows are keyed by
 * wall-clock time so they roll over exactly when Twelve Data's own do.
 *
 * The decision is separated from the storage so it can be tested without a
 * database and without spending a single credit.
 */

/** Overridable so CI can pin them to zero. */
export const TWELVEDATA_MINUTE_LIMIT = Number(process.env.TWELVEDATA_MINUTE_LIMIT ?? 8);
export const TWELVEDATA_DAY_LIMIT = Number(process.env.TWELVEDATA_DAY_LIMIT ?? 800);

/** Headroom kept back to absorb bursts, clock skew and in-flight requests. */
export const MINUTE_RESERVE = Number(process.env.TWELVEDATA_MINUTE_RESERVE ?? 1);
export const DAY_RESERVE = Number(process.env.TWELVEDATA_DAY_RESERVE ?? 100);

/** `app_meta` key holding "<minuteKey>:<used>|<dayKey>:<used>". */
export const TWELVEDATA_QUOTA_KEY = "twelvedata_quota";

export function minuteKey(now: Date = new Date()): number {
  return Math.floor(now.getTime() / 60_000);
}

/** UTC day — Twelve Data's documented reset point is midnight UTC. */
export function dayKey(now: Date = new Date()): number {
  return Math.floor(now.getTime() / 86_400_000);
}

/** What may actually be spent, once headroom is held back. */
export function effectiveLimit(limit: number, reserve: number): number {
  return Math.max(0, limit - reserve);
}

interface Window {
  key: number;
  used: number;
}

export interface Ledger {
  minute: Window;
  day: Window;
}

/** Read a stored ledger, treating anything unparseable as unused. */
export function parseLedger(value: string | undefined, now: Date = new Date()): Ledger {
  const fallback: Ledger = {
    minute: { key: minuteKey(now), used: 0 },
    day: { key: dayKey(now), used: 0 },
  };
  if (!value) return fallback;

  const readWindow = (part: string | undefined, currentKey: number): Window => {
    const [rawKey, rawUsed] = (part ?? "").split(":");
    const key = Number.parseInt(rawKey ?? "", 10);
    const used = Number.parseInt(rawUsed ?? "", 10);
    // A window from an earlier minute or day has already reset.
    if (!Number.isFinite(key) || key !== currentKey) return { key: currentKey, used: 0 };
    return { key: currentKey, used: Number.isFinite(used) && used > 0 ? used : 0 };
  };

  const [minutePart, dayPart] = value.split("|");
  return {
    minute: readWindow(minutePart, minuteKey(now)),
    day: readWindow(dayPart, dayKey(now)),
  };
}

export function serializeLedger(ledger: Ledger): string {
  return `${ledger.minute.key}:${ledger.minute.used}|${ledger.day.key}:${ledger.day.used}`;
}

/**
 * Decide whether `credits` may be spent, and what the ledger becomes.
 *
 * All-or-nothing on purpose, unlike the EODHD ledger: a Twelve Data request
 * carries a batch of symbols and a partial reservation would mean deciding
 * which symbols to drop. The caller batches to fit instead.
 */
export function grantCredits(
  value: string | undefined,
  now: Date,
  credits: number,
  minuteLimit: number = TWELVEDATA_MINUTE_LIMIT,
  dayLimit: number = TWELVEDATA_DAY_LIMIT,
): { granted: boolean; nextValue: string; ledger: Ledger } {
  const ledger = parseLedger(value, now);
  const want = Math.trunc(credits);

  if (
    want <= 0 ||
    ledger.minute.used + want > effectiveLimit(minuteLimit, MINUTE_RESERVE) ||
    ledger.day.used + want > effectiveLimit(dayLimit, DAY_RESERVE)
  ) {
    return { granted: false, nextValue: serializeLedger(ledger), ledger };
  }

  const next: Ledger = {
    minute: { key: ledger.minute.key, used: ledger.minute.used + want },
    day: { key: ledger.day.key, used: ledger.day.used + want },
  };
  return { granted: true, nextValue: serializeLedger(next), ledger: next };
}
