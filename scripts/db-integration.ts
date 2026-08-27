/**
 * Integration test: boots a real (embedded) PostgreSQL, runs Drizzle migrations,
 * seeds, and exercises the repository layer end-to-end.
 *
 * Run with: npm run test:db
 */
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import EmbeddedPostgres from "embedded-postgres";

let failures = 0;
function expect(cond: boolean, label: string) {
  if (cond) console.log(`  ok  ${label}`);
  else {
    failures += 1;
    console.error(`FAIL  ${label}`);
  }
}

async function main() {
  const dataDir = path.join(os.tmpdir(), "aurum-pg-test");
  fs.rmSync(dataDir, { recursive: true, force: true });

  console.log("starting embedded postgres…");
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "aurum",
    password: "aurum",
    port: 5433,
    persistent: false,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("aurum");
  process.env.DATABASE_URL = "postgres://aurum:aurum@127.0.0.1:5433/aurum";

  try {
    // Import after DATABASE_URL is set so the pool picks it up.
    const { ensureDb } = await import("../src/db/init");
    const repo = await import("../src/db/repo");
    const { generateSampleData } = await import("../src/lib/sample");

    console.log("migrations + seed");
    await ensureDb();
    let state = await repo.getState();
    expect(state.accounts.length === 6, `seeded 6 accounts (got ${state.accounts.length})`);
    expect(state.transactions.length > 400, `seeded transactions (${state.transactions.length})`);
    expect(state.holdings.length === 10, `seeded 10 holdings (got ${state.holdings.length})`);
    expect(state.budgets.length === 11, `seeded 11 budgets (got ${state.budgets.length})`);
    expect(state.categories.length === 13, `seeded 13 categories (got ${state.categories.length})`);

    // ensureDb is idempotent
    await ensureDb();
    state = await repo.getState();
    expect(state.accounts.length === 6, "ensureDb does not double-seed");

    console.log("transaction balance side effects");
    const checking = state.accounts.find((a) => a.name === "Everyday Checking")!;
    const before = checking.balance;
    const txn = {
      id: "test-txn-1",
      date: "2026-08-20",
      type: "expense" as const,
      amount: 10,
      category: "Dining",
      accountId: checking.id,
      payee: "Test Cafe",
    };
    await repo.insertTransaction(txn);
    state = await repo.getState();
    expect(
      Math.abs(state.accounts.find((a) => a.id === checking.id)!.balance - (before - 10)) < 0.01,
      "expense reduces account balance by 10",
    );

    await repo.updateTransactionRow("test-txn-1", { ...txn, amount: 25 });
    state = await repo.getState();
    expect(
      Math.abs(state.accounts.find((a) => a.id === checking.id)!.balance - (before - 25)) < 0.01,
      "editing amount re-applies delta (now -25)",
    );

    await repo.removeTransaction("test-txn-1");
    state = await repo.getState();
    expect(
      Math.abs(state.accounts.find((a) => a.id === checking.id)!.balance - before) < 0.01,
      "deleting reverts balance",
    );

    console.log("budgets / categories");
    await repo.upsertBudget("Coffee", 42.5);
    state = await repo.getState();
    expect(state.budgets.some((b) => b.category === "Coffee" && b.limit === 42.5), "budget upsert");
    await repo.upsertBudget("Coffee", 60);
    state = await repo.getState();
    expect(state.budgets.find((b) => b.category === "Coffee")?.limit === 60, "budget update");

    await repo.insertCategory("Coffee", 99);
    await repo.renameCategoryEverywhere("Groceries", "Food");
    state = await repo.getState();
    expect(state.categories.includes("Food") && !state.categories.includes("Groceries"), "category renamed");
    expect(state.budgets.some((b) => b.category === "Food"), "budget renamed with category");
    expect(
      state.transactions.some((t) => t.category === "Food") &&
        !state.transactions.some((t) => t.category === "Groceries"),
      "transactions renamed with category",
    );

    await repo.deleteCategorySmart("Food");
    state = await repo.getState();
    expect(!state.categories.includes("Food"), "category deleted");
    expect(!state.budgets.some((b) => b.category === "Food"), "budget deleted with category");
    expect(
      state.transactions.every((t) => t.category !== "Food"),
      "transactions moved off deleted category",
    );

    await repo.upsertMerchantRule("test cafe", "Dining");
    state = await repo.getState();
    expect(state.merchantRules["test cafe"] === "Dining", "merchant rule stored");

    console.log("accounts / holdings");
    await repo.insertAccount(
      {
        id: "test-acc-1",
        name: "Test Account",
        institution: "Test Bank",
        kind: "savings",
        balance: 500,
        history: [{ month: "2026-08", value: 500 }],
      },
      99,
    );
    state = await repo.getState();
    expect(state.accounts.some((a) => a.id === "test-acc-1"), "account inserted");
    await repo.replaceAccount({
      id: "test-acc-1",
      name: "Renamed Account",
      institution: "Test Bank",
      kind: "savings",
      balance: 750,
      history: [{ month: "2026-08", value: 750 }],
    });
    state = await repo.getState();
    expect(state.accounts.find((a) => a.id === "test-acc-1")?.balance === 750, "account updated");
    await repo.deleteAccountRow("test-acc-1");
    state = await repo.getState();
    expect(!state.accounts.some((a) => a.id === "test-acc-1"), "account deleted");

    await repo.insertHolding(
      {
        id: "test-hold-1",
        ticker: "TEST",
        name: "Test ETF",
        assetClass: "US Equity",
        sector: "Tech",
        shares: 2,
        avgCost: 100,
        price: 110,
        history: [90, 100, 110],
        dividendsReceived: 0,
        accountType: "non-registered",
        currency: "CAD",
        priceCAD: 110,
        avgCostCAD: 100,
        dividendsReceivedCAD: 0,
        historyCAD: [90, 100, 110],
      },
      99,
    );
    state = await repo.getState();
    expect(state.holdings.some((h) => h.id === "test-hold-1" && h.price === 110), "holding inserted");
    await repo.deleteHoldingRow("test-hold-1");
    state = await repo.getState();
    expect(!state.holdings.some((h) => h.id === "test-hold-1"), "holding deleted");

    console.log("reset");
    await repo.resetToSample(generateSampleData());
    state = await repo.getState();
    expect(state.accounts.length === 6, "reset restores sample accounts");
    expect(!state.budgets.some((b) => b.category === "Coffee"), "reset clears added budgets");
    expect(!("test cafe" in state.merchantRules), "reset clears merchant rules");

    if (failures > 0) {
      console.error(`\n${failures} test(s) failed`);
      process.exitCode = 1;
    } else {
      console.log("\nall db integration tests passed");
    }
    // close connections before stopping the server so the pool
    // doesn't emit spurious 'error' events
    const { pool } = await import("../src/db/index");
    await pool.end();
  } finally {
    await pg.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
