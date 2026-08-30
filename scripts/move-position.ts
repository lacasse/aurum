/**
 * Move one position from one account to another.
 *
 * Positions are stored per account because that is what is true, and now and
 * then the stored answer is wrong — an importer guessed, or a split drew the
 * line in the wrong place. This moves the row and nothing else: the shares,
 * cost basis, dividends and every flow behind them travel together, because
 * they describe the position rather than the account it sits in.
 *
 * Usage:
 *   docker exec -e DATABASE_URL=... <container> \
 *     npx tsx scripts/move-position.ts <TICKER> <from account> <to account> [--commit]
 */
import { db } from "@/db/index";
import { accounts, holdings } from "@/db/schema";
import { and, eq } from "drizzle-orm";

async function main() {
  const [ticker, fromName, toName, ...flags] = process.argv.slice(2);
  if (!ticker || !fromName || !toName) {
    throw new Error("usage: move-position.ts <TICKER> <from account> <to account> [--commit]");
  }
  const commit = flags.includes("--commit");

  const all = await db.select().from(accounts);
  const from = all.find((a) => a.name === fromName);
  const to = all.find((a) => a.name === toName);
  if (!from || !to) throw new Error(`account not found: ${!from ? fromName : toName}`);

  const rows = await db
    .select()
    .from(holdings)
    .where(and(eq(holdings.ticker, ticker.toUpperCase()), eq(holdings.accountId, from.id)));

  if (rows.length === 0) {
    console.log(`no ${ticker} in ${fromName} — nothing to move`);
    process.exit(0);
  }
  for (const h of rows) {
    console.log(
      `${h.ticker}: ${Number(h.shares)} shares, ${h.flows.length} flows — ${fromName} → ${toName}`,
    );
  }
  if (!commit) {
    console.log("\ndry run — pass --commit to write");
    process.exit(0);
  }

  for (const h of rows) {
    await db.update(holdings).set({ accountId: to.id }).where(eq(holdings.id, h.id));
  }
  console.log(`moved ${rows.length} position${rows.length === 1 ? "" : "s"}`);
  process.exit(0);
}

void main();
