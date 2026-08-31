/**
 * Import month-end values for a position the app has no trades for.
 *
 * Some lines in the spreadsheet are a total rather than a security: a balance
 * carried forward month by month with no purchase behind it. They cannot be
 * reconstructed from trades, and leaving them out makes a band of net worth
 * read as zero for months it was not.
 *
 * So they are recorded the way the original import recorded every other
 * spreadsheet line — as a `sheet:` snapshot row, which the repository treats
 * as the whole position for that month rather than adding it to per-lot rows.
 * A closed holding carries the ticker's name and asset class so the value
 * lands in the right band; it holds nothing, because nothing is held.
 *
 *   npx tsx scripts/import-aggregate-snapshots.ts <file.json>
 *   npx tsx scripts/import-aggregate-snapshots.ts <file.json> --apply
 *
 * The file:
 *   {
 *     "ticker": "BONDS",
 *     "name": "Bonds (from the spreadsheet)",
 *     "assetClass": "Bonds",
 *     "accountName": "Non-registered",
 *     "months": { "2021-09": 1480.03, "2021-10": 1548.77 }
 *   }
 */
import fs from "node:fs";

interface Doc {
  ticker: string;
  name: string;
  assetClass: string;
  accountName: string;
  months: Record<string, number>;
}

async function main() {
  const [path, ...rest] = process.argv.slice(2);
  const apply = rest.includes("--apply");
  if (!path) {
    console.error("usage: import-aggregate-snapshots.ts <file.json> [--apply]");
    process.exit(1);
  }
  const doc: Doc = JSON.parse(fs.readFileSync(path, "utf8"));
  const months = Object.entries(doc.months).sort(([a], [b]) => a.localeCompare(b));
  if (months.length === 0) {
    console.error("Nothing to import: the file lists no months.");
    process.exit(1);
  }

  const { ensureDb } = await import("../src/db/init");
  const { db } = await import("../src/db/index");
  const { accounts, holdings, monthlySnapshots } = await import("../src/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  await ensureDb();

  const holdingId = `sheet:${doc.ticker}`;
  const existing = await db
    .select({ month: monthlySnapshots.month })
    .from(monthlySnapshots)
    .where(eq(monthlySnapshots.holdingId, holdingId));
  const already = new Set(existing.map((r) => r.month));

  /*
   * A month the app already values from real snapshots must not be given a
   * second figure: the two would be added, and the band would read double.
   */
  const clashes = await db
    .select({ month: monthlySnapshots.month, ticker: monthlySnapshots.ticker })
    .from(monthlySnapshots)
    .where(sql`${monthlySnapshots.ticker} = ${doc.ticker}`);
  const clashing = new Set(clashes.map((r) => r.month));

  const rows = await db.select().from(accounts).where(eq(accounts.name, doc.accountName));
  const account = rows[0];
  if (!account) {
    console.error(`No account named "${doc.accountName}".`);
    process.exit(1);
  }

  const held = await db
    .select({ id: holdings.id })
    .from(holdings)
    .where(sql`upper(${holdings.ticker}) = ${doc.ticker.toUpperCase()}`);

  console.log(`${doc.ticker} · ${doc.assetClass} · ${doc.accountName}`);
  console.log(`  ${months.length} months, ${months[0][0]} → ${months[months.length - 1][0]}`);
  console.log(`  total ${months.reduce((s, [, v]) => s + v, 0).toFixed(2)}`);
  console.log(`  holding row: ${held.length > 0 ? "exists" : "will be created"}`);
  console.log(`  already imported: ${already.size} of these months`);
  if (clashing.size > 0) {
    console.log(`  WARNING: ${clashing.size} months already carry a ${doc.ticker} value`);
  }

  if (!apply) {
    console.log("\nDry run. Re-run with --apply to write.");
    return;
  }

  if (held.length === 0) {
    await db.insert(holdings).values({
      id: holdingId,
      ticker: doc.ticker,
      name: doc.name,
      assetClass: doc.assetClass,
      shares: 0,
      avgCost: 0,
      price: 0,
      history: [],
      dividendsReceived: 0,
      accountId: account.id,
      currency: "CAD",
      priceCAD: 0,
      avgCostCAD: 0,
      dividendsReceivedCAD: 0,
      historyCAD: [],
      flows: [],
      position: 999,
    });
    console.log("  holding row created");
  }

  let written = 0;
  for (const [month, value] of months) {
    await db
      .insert(monthlySnapshots)
      .values({
        month,
        holdingId,
        ticker: doc.ticker,
        price: 0,
        avgCost: 0,
        shares: 0,
        value,
        valueCAD: value,
      })
      .onConflictDoUpdate({
        target: [monthlySnapshots.month, monthlySnapshots.holdingId],
        set: { value, valueCAD: value },
      });
    written++;
  }
  console.log(`  ${written} months written`);
}

main().then(() => process.exit(0));
