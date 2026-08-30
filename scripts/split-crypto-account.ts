/**
 * Move the crypto side of a brokerage account into an account of its own.
 *
 * The non-registered account was doing two jobs. Between 2021 and 2025 it held
 * coins bought on crypto platforms; since 2026 it has been an ordinary
 * brokerage account buying listed equities. Pooled together, neither story
 * reads properly: the equity contributions disappear next to the crypto ones,
 * and the crypto returns are diluted by shares that had nothing to do with them.
 *
 * What moves:
 *
 *   - positions in coins held directly, and in the funds that are only a
 *     wrapper around one — a Bitcoin ETF is a crypto position bought through a
 *     broker, not a diversified holding;
 *   - the account's cash flows from before the equity era, which is what paid
 *     for those coins.
 *
 * What stays: every listed equity and diversified fund, and the deposits from
 * the equity era that bought them.
 *
 * Usage:
 *   docker exec -e DATABASE_URL=... <container> \
 *     npx tsx scripts/split-crypto-account.ts <from> <to> <YYYY-MM-DD> [--commit]
 *
 * where the date is the first day of the equity era: transfers on or after it
 * stay put, everything earlier follows the coins.
 */
import { db } from "@/db/index";
import { accounts, holdings, transactions } from "@/db/schema";
import { and, eq, lt, like, or, sql } from "drizzle-orm";
import { isCoinTicker } from "@/lib/market";

/**
 * Funds that are a coin in a wrapper.
 *
 * `isCoinTicker` cannot see these — they carry an exchange suffix like any
 * share — but a Bitcoin ETF belongs with the Bitcoin, not with the equities.
 */
const CRYPTO_FUNDS = new Set([
  "BTCX-B.TO",
  "ETHX-B.TO",
  "BTCC.TO",
  "BTCY.TO",
]);

/**
 * Three ways of being crypto, because no one of them catches everything.
 *
 * `isCoinTicker` knows the majors; the asset class catches the rest, which is
 * where the smaller coins were already filed; and the fund list covers the
 * wrappers, which look like ordinary listed shares from every angle except
 * what they hold.
 */
function isCryptoRelated(ticker: string, assetClass: string): boolean {
  return (
    isCoinTicker(ticker) ||
    assetClass === "Crypto" ||
    CRYPTO_FUNDS.has(ticker.toUpperCase())
  );
}

async function main() {
  const [fromName, toName, cutoff, ...flags] = process.argv.slice(2);
  if (!fromName || !toName || !cutoff) {
    throw new Error("usage: split-crypto-account.ts <from> <to> <YYYY-MM-DD> [--commit]");
  }
  const commit = flags.includes("--commit");

  const all = await db.select().from(accounts);
  const from = all.find((a) => a.name === fromName);
  const to = all.find((a) => a.name === toName);
  if (!from || !to) throw new Error(`account not found: ${!from ? fromName : toName}`);

  const held = await db.select().from(holdings).where(eq(holdings.accountId, from.id));
  const moving = held.filter((h) => isCryptoRelated(h.ticker, h.assetClass));
  const staying = held.filter((h) => !isCryptoRelated(h.ticker, h.assetClass));

  const flows = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.type, "transfer"),
        lt(transactions.date, cutoff),
        or(
          eq(transactions.sourceAccountId, from.id),
          eq(transactions.destinationAccountId, from.id),
        ),
      ),
    );

  console.log(`moving ${moving.length} positions to ${toName}:`);
  for (const h of moving) {
    console.log(`  ${h.ticker.padEnd(12)} ${Number(h.shares) > 0 ? "open" : "closed"}`);
  }
  console.log(`staying in ${fromName}: ${staying.map((h) => h.ticker).join(", ")}`);
  console.log(`moving ${flows.length} transfers dated before ${cutoff}`);
  if (!commit) {
    console.log("\ndry run — pass --commit to write");
    process.exit(0);
  }

  for (const h of moving) {
    await db.update(holdings).set({ accountId: to.id }).where(eq(holdings.id, h.id));
  }
  for (const t of flows) {
    await db
      .update(transactions)
      .set({
        sourceAccountId: t.sourceAccountId === from.id ? to.id : t.sourceAccountId,
        destinationAccountId:
          t.destinationAccountId === from.id ? to.id : t.destinationAccountId,
        payee: t.payee.replace(fromName, toName),
      })
      .where(eq(transactions.id, t.id));
  }
  // Snapshots are keyed by holding, and those went with the positions; the
  // per-account label on them is the one thing left pointing at the old home.
  await db
    .update(transactions)
    .set({ payee: sql`replace(${transactions.payee}, ${fromName}, ${toName})` })
    .where(and(like(transactions.payee, `%${fromName}%`), lt(transactions.date, cutoff)));

  console.log(`moved ${moving.length} positions and ${flows.length} transfers`);
  process.exit(0);
}

void main();
