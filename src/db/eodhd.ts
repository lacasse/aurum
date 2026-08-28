import { eq, sql } from "drizzle-orm";
import { db } from "./index";
import { appMeta } from "./schema";
import {
  EODHD_DAY_LIMIT,
  EODHD_QUOTA_KEY,
  grant,
  resetsAt,
  usedFrom,
  utcDay,
} from "@/lib/eodhd-quota";

/** `app_meta` key holding a JSON map of ticker -> UTC date last fetched. */
const LAST_FETCH_KEY = "eodhd_last_fetch";

/**
 * Reserve up to `want` EODHD calls, returning how many were granted.
 *
 * The read-modify-write runs inside a transaction with the ledger row locked,
 * so two concurrent price refreshes cannot both see the same remaining
 * allowance and jointly exceed it. The row is created first (outside the lock)
 * because `FOR UPDATE` cannot lock a row that does not exist yet.
 *
 * `limit` lets a caller draw against a ceiling below the day's full allowance,
 * so a low-priority use (type-ahead validation) stops before it can starve the
 * price refresh. It never raises the cap: the ledger it writes is shared, so a
 * limit above `EODHD_DAY_LIMIT` would let the next caller overspend.
 */
export async function reserveEodhdCalls(
  want: number,
  now: Date = new Date(),
  limit: number = EODHD_DAY_LIMIT,
): Promise<number> {
  // Clamped, not trusted: a caller may lower its own ceiling but never lift
  // the day's, which is what makes the comment above true rather than a hope.
  const cap = Math.min(limit, EODHD_DAY_LIMIT);
  if (!Number.isFinite(want) || want <= 0 || cap <= 0) return 0;
  const today = utcDay(now);

  await db
    .insert(appMeta)
    .values({ key: EODHD_QUOTA_KEY, value: `${today}:0` })
    .onConflictDoNothing();

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(appMeta)
      .where(eq(appMeta.key, EODHD_QUOTA_KEY))
      .for("update");

    const { granted, nextValue } = grant(row?.value, today, want, cap);
    if (granted > 0) {
      await tx
        .update(appMeta)
        .set({ value: nextValue })
        .where(eq(appMeta.key, EODHD_QUOTA_KEY));
    }
    return granted;
  });
}

export interface EodhdUsage {
  used: number;
  limit: number;
  remaining: number;
  /** ISO timestamp of the next 00:00 GMT, when the allowance resets. */
  resetsAt: string;
}

export async function eodhdUsage(now: Date = new Date()): Promise<EodhdUsage> {
  const [row] = await db
    .select()
    .from(appMeta)
    .where(eq(appMeta.key, EODHD_QUOTA_KEY));
  const used = usedFrom(row?.value, utcDay(now));
  return {
    used,
    limit: EODHD_DAY_LIMIT,
    remaining: Math.max(0, EODHD_DAY_LIMIT - used),
    resetsAt: resetsAt(now),
  };
}

/**
 * The UTC date each ticker's price was last fetched from EODHD.
 *
 * Persisted for the same reason as the ledger: it survives restarts, so a
 * redeploy cannot trigger a fresh stampede of "uncached" tickers, and it lets
 * the refresh spend the day's allowance on whatever has gone longest without
 * an update.
 */
export async function eodhdLastFetched(): Promise<Map<string, string>> {
  const [row] = await db.select().from(appMeta).where(eq(appMeta.key, LAST_FETCH_KEY));
  if (!row?.value) return new Map();
  try {
    const parsed = JSON.parse(row.value) as Record<string, string>;
    return new Map(Object.entries(parsed));
  } catch {
    return new Map(); // a corrupted map just means everything looks unfetched
  }
}

export async function recordEodhdFetched(
  tickers: string[],
  now: Date = new Date(),
): Promise<void> {
  if (tickers.length === 0) return;
  const today = utcDay(now);
  const merged = await eodhdLastFetched();
  for (const t of tickers) merged.set(t, today);
  const value = JSON.stringify(Object.fromEntries(merged));
  await db
    .insert(appMeta)
    .values({ key: LAST_FETCH_KEY, value })
    .onConflictDoUpdate({ target: appMeta.key, set: { value } });
}

/** Reset the ledger. Test-support only; never called by the app. */
export async function __resetEodhdLedgerForTests(): Promise<void> {
  await db.delete(appMeta).where(sql`${appMeta.key} IN (${EODHD_QUOTA_KEY}, ${LAST_FETCH_KEY})`);
}
