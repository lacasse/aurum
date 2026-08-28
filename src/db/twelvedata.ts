import { eq } from "drizzle-orm";
import { db } from "./index";
import { appMeta } from "./schema";
import {
  DAY_RESERVE,
  MINUTE_RESERVE,
  TWELVEDATA_DAY_LIMIT,
  TWELVEDATA_MINUTE_LIMIT,
  TWELVEDATA_QUOTA_KEY,
  effectiveLimit,
  grantCredits,
  parseLedger,
  serializeLedger,
} from "@/lib/twelvedata-quota";

/**
 * Reserve `credits` against the Twelve Data plan, returning whether they may
 * be spent.
 *
 * The read-modify-write runs inside a transaction with the ledger row locked,
 * so two concurrent price refreshes cannot both see the same remaining
 * allowance and jointly exceed it. The row is created first, outside the lock,
 * because `FOR UPDATE` cannot lock a row that does not exist yet.
 */
export async function reserveTwelveDataCredits(
  credits: number,
  now: Date = new Date(),
): Promise<boolean> {
  if (!Number.isFinite(credits) || credits <= 0) return false;
  if (TWELVEDATA_MINUTE_LIMIT <= 0 || TWELVEDATA_DAY_LIMIT <= 0) return false;

  await db
    .insert(appMeta)
    .values({ key: TWELVEDATA_QUOTA_KEY, value: serializeLedger(parseLedger(undefined, now)) })
    .onConflictDoNothing();

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(appMeta)
      .where(eq(appMeta.key, TWELVEDATA_QUOTA_KEY))
      .for("update");

    const { granted, nextValue } = grantCredits(row?.value, now, credits);
    if (granted) {
      await tx
        .update(appMeta)
        .set({ value: nextValue })
        .where(eq(appMeta.key, TWELVEDATA_QUOTA_KEY));
    }
    return granted;
  });
}

export interface TwelveDataUsage {
  minute: { used: number; limit: number; remaining: number };
  day: { used: number; limit: number; remaining: number };
}

export async function twelveDataUsage(now: Date = new Date()): Promise<TwelveDataUsage> {
  const [row] = await db
    .select()
    .from(appMeta)
    .where(eq(appMeta.key, TWELVEDATA_QUOTA_KEY));
  const ledger = parseLedger(row?.value, now);
  const minuteLimit = effectiveLimit(TWELVEDATA_MINUTE_LIMIT, MINUTE_RESERVE);
  const dayLimit = effectiveLimit(TWELVEDATA_DAY_LIMIT, DAY_RESERVE);
  return {
    minute: {
      used: ledger.minute.used,
      limit: minuteLimit,
      remaining: Math.max(0, minuteLimit - ledger.minute.used),
    },
    day: {
      used: ledger.day.used,
      limit: dayLimit,
      remaining: Math.max(0, dayLimit - ledger.day.used),
    },
  };
}

/** Test hook: clears the ledger so a suite starts from a known state. */
export async function __resetTwelveDataLedgerForTests(): Promise<void> {
  await db.delete(appMeta).where(eq(appMeta.key, TWELVEDATA_QUOTA_KEY));
}
