import { eq } from "drizzle-orm";
import { db } from "./index";
import { appMeta } from "./schema";

/** `app_meta` key holding a JSON map of ticker -> { price, at }. */
const PRICE_CACHE_KEY = "price_cache";

export interface CachedPrice {
  price: number;
  /** Epoch milliseconds the price was fetched. */
  at: number;
}

/**
 * The last price fetched for each ticker, and when.
 *
 * Persisted rather than held in the server process, for the same reason as
 * `eodhdLastFetched`: a process-local cache is empty after every restart, so a
 * redeploy makes every ticker look unfetched and the next page load buys the
 * whole portfolio again. Six deploys in an afternoon is six full refreshes of
 * everything Twelve Data prices, none of which anybody asked for.
 *
 * EODHD was already protected — its allowance is small enough that the cost of
 * getting this wrong was obvious, and the budget is zero before the close
 * anyway. Twelve Data's allowance is larger, so the same fault was affordable
 * enough to go unnoticed, which is why it lasted.
 *
 * One row holding a JSON object, like the ledger beside it. A table would be
 * tidier and is not worth a migration at one row per ticker for one portfolio.
 */
export async function readPriceCache(): Promise<Map<string, CachedPrice>> {
  const [row] = await db.select().from(appMeta).where(eq(appMeta.key, PRICE_CACHE_KEY));
  if (!row?.value) return new Map();
  try {
    const parsed = JSON.parse(row.value) as Record<string, CachedPrice>;
    return new Map(
      Object.entries(parsed).filter(
        ([, v]) => typeof v?.price === "number" && typeof v?.at === "number",
      ),
    );
  } catch {
    // A corrupted cache means everything looks unfetched, which is the safe
    // direction: prices are re-bought, never served wrong.
    return new Map();
  }
}

/**
 * Merge newly fetched prices into the stored cache.
 *
 * Merged rather than replaced because a request only asks about the tickers on
 * one page; writing just those would drop every other holding's entry and undo
 * the point of keeping it.
 */
export async function recordPrices(
  fetched: Map<string, number>,
  now: number = Date.now(),
): Promise<void> {
  if (fetched.size === 0) return;
  const merged = await readPriceCache();
  for (const [ticker, price] of fetched) merged.set(ticker, { price, at: now });
  const value = JSON.stringify(Object.fromEntries(merged));
  await db
    .insert(appMeta)
    .values({ key: PRICE_CACHE_KEY, value })
    .onConflictDoUpdate({ target: appMeta.key, set: { value } });
}

/** Clear the cache. Test-support only; never called by the app. */
export async function __resetPriceCacheForTests(): Promise<void> {
  await db.delete(appMeta).where(eq(appMeta.key, PRICE_CACHE_KEY));
}
