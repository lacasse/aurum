/**
 * Flag zero-cost acquisitions as staking rewards awaiting a value.
 *
 * Tokens that arrived as a reward were recorded as buys for nothing, which
 * leaves them with no cost base at all: their whole eventual sale reads as a
 * capital gain, and the income they actually were goes unrecorded. The value
 * on the day is the one figure the app cannot work out — it fetches today's
 * price and nothing else — so this marks them for the figure to be entered,
 * rather than guessing it.
 *
 *   npx tsx scripts/mark-staking-rewards.ts SOL          # dry run
 *   npx tsx scripts/mark-staking-rewards.ts SOL --apply
 */
async function main() {
  const [ticker, ...rest] = process.argv.slice(2);
  const apply = rest.includes("--apply");
  if (!ticker) {
    console.error("usage: mark-staking-rewards.ts <TICKER> [--apply]");
    process.exit(1);
  }

  const { ensureDb } = await import("../src/db/init");
  const repo = await import("../src/db/repo");
  await ensureDb();

  const { holdings } = await repo.getState();
  const matches = holdings.filter(
    (h) => h.ticker.toUpperCase() === ticker.toUpperCase(),
  );
  if (matches.length === 0) {
    console.error(`No position found for ${ticker}.`);
    process.exit(1);
  }

  for (const h of matches) {
    const flows = h.flows.map((f) =>
      f.kind === "buy" && f.amount === 0 && f.shares > 0 && !f.awaitingPrice
        ? { ...f, awaitingPrice: true }
        : f,
    );
    const marked = flows.filter((f) => f.awaitingPrice).length;
    const changed = flows.filter(
      (f, i) => f.awaitingPrice !== h.flows[i].awaitingPrice,
    );
    console.log(`${h.ticker} (${h.id}): ${marked} awaiting a value`);
    for (const f of changed) console.log(`  ${f.date}  ${f.shares} units`);
    if (apply && changed.length > 0) {
      await repo.replaceHolding({ ...h, flows });
      console.log("  written");
    }
  }
  if (!apply) console.log("\nDry run. Re-run with --apply to write.");
}

main().then(() => process.exit(0));
