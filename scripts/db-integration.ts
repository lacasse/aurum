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
    expect(state.accounts.length === 9, `seeded 9 accounts, 6 everyday + 3 investment (got ${state.accounts.length})`);
    expect(state.transactions.length > 400, `seeded transactions (${state.transactions.length})`);
    expect(state.holdings.length === 10, `seeded 10 holdings (got ${state.holdings.length})`);
    expect(state.budgets.length === 11, `seeded 11 budgets (got ${state.budgets.length})`);
    expect(state.categories.length === 13, `seeded 13 categories (got ${state.categories.length})`);

    // ensureDb is idempotent
    await ensureDb();
    state = await repo.getState();
    expect(state.accounts.length === 9, "ensureDb does not double-seed");

    console.log("transaction balance side effects");
    const checking = state.accounts.find((a) => a.name === "Everyday Checking")!;
    const before = checking.balance;
    const txn = {
      id: "test-txn-1",
      date: "2026-08-20",
      type: "expense" as const,
      amount: 10,
      category: "Dining",
      sourceAccountId: checking.id,
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

    console.log("transfers move money between two accounts");
    {
      const from = state.accounts.find((a) => a.name === "Everyday Checking")!;
      const to = state.accounts.find((a) => a.name === "TFSA")!;
      const card = state.accounts.find((a) => a.name === "Gold Card")!;
      const fromBefore = from.balance;
      const toBefore = to.balance;
      const cardBefore = card.balance;

      await repo.insertTransaction({
        id: "test-transfer-1",
        date: "2026-08-20",
        type: "transfer",
        amount: 500,
        category: "Transfer",
        sourceAccountId: from.id,
        destinationAccountId: to.id,
        payee: "TFSA contribution",
      });
      state = await repo.getState();
      const at = (id: string) => state.accounts.find((a) => a.id === id)!.balance;
      expect(
        Math.abs(at(from.id) - (fromBefore - 500)) < 0.01,
        "transfer debits the source account",
      );
      expect(
        Math.abs(at(to.id) - (toBefore + 500)) < 0.01,
        "transfer credits the destination account",
      );

      // Paying a credit card is a transfer whose destination is a liability:
      // both the cash and the debt must go down.
      await repo.insertTransaction({
        id: "test-transfer-2",
        date: "2026-08-21",
        type: "transfer",
        amount: 200,
        category: "Transfer",
        sourceAccountId: from.id,
        destinationAccountId: card.id,
        payee: "Card payment",
      });
      state = await repo.getState();
      expect(
        Math.abs(at(card.id) - (cardBefore - 200)) < 0.01,
        "paying a credit card reduces what is owed",
      );

      await repo.removeTransaction("test-transfer-1");
      await repo.removeTransaction("test-transfer-2");
      state = await repo.getState();
      expect(
        Math.abs(at(from.id) - fromBefore) < 0.01 &&
          Math.abs(at(to.id) - toBefore) < 0.01 &&
          Math.abs(at(card.id) - cardBefore) < 0.01,
        "deleting transfers reverts both sides",
      );
    }

    console.log("recurring transactions");
    {
      const from = state.accounts.find((a) => a.name === "Everyday Checking")!;
      const before = from.balance;
      // Starts three months ago, so materializing must post the back payments.
      await repo.insertRecurringRule(
        {
          id: "test-rule-1",
          type: "expense",
          amount: 100,
          category: "Housing",
          sourceAccountId: from.id,
          payee: "Storage Unit",
          frequency: "monthly",
          startDate: "2026-06-10",
          nextDate: "2026-06-10",
          active: true,
        },
        0,
      );

      const created = await repo.materializeRecurring("2026-08-27");
      expect(created === 3, `posts the three payments already due (got ${created})`);
      state = await repo.getState();
      const posted = state.transactions.filter((t) => t.recurringId === "test-rule-1");
      expect(posted.length === 3, "generated transactions are tagged with the rule");
      expect(
        posted.every((t) => t.sourceAccountId === from.id),
        "generated transactions carry the rule's source account",
      );
      expect(
        Math.abs(state.accounts.find((a) => a.id === from.id)!.balance - (before - 300)) < 0.01,
        "each posted payment moves the balance",
      );
      expect(
        state.recurring.find((r) => r.id === "test-rule-1")?.nextDate === "2026-09-10",
        "the rule advances past what it posted",
      );

      // The whole point of nextDate + the recurringId guard: running again on
      // the same day must not post a second copy of anything.
      const again = await repo.materializeRecurring("2026-08-27");
      expect(again === 0, `re-running posts nothing (got ${again})`);
      state = await repo.getState();
      expect(
        state.transactions.filter((t) => t.recurringId === "test-rule-1").length === 3,
        "no duplicates after a second run",
      );

      await repo.deleteRecurringRule("test-rule-1");
      state = await repo.getState();
      expect(!state.recurring.some((r) => r.id === "test-rule-1"), "rule deleted");
      expect(
        state.transactions.filter((t) => t.recurringId === "test-rule-1").length === 3,
        "payments it already posted are kept",
      );
      for (const t of state.transactions.filter((t) => t.recurringId === "test-rule-1")) {
        await repo.removeTransaction(t.id);
      }
    }

    console.log("EODHD daily cap (never touches the network)");
    {
      const eodhd = await import("../src/db/eodhd");
      const day = new Date("2026-08-28T12:00:00Z");
      await eodhd.__resetEodhdLedgerForTests();

      const first = await eodhd.reserveEodhdCalls(5, day);
      expect(first === 5, `grants 5 of 20 (got ${first})`);

      // The ledger is in the database, so this is what a container restart
      // sees — an in-memory counter would have reset to zero here.
      const usage = await eodhd.eodhdUsage(day);
      expect(usage.used === 5 && usage.remaining === 15, "usage persists to the database");

      const rest = await eodhd.reserveEodhdCalls(219, day);
      expect(rest === 15, `a 219-ticker refresh gets only the 15 left (got ${rest})`);
      expect((await eodhd.reserveEodhdCalls(1, day)) === 0, "further calls are refused");

      const spent = (await eodhd.eodhdUsage(day)).used;
      expect(spent === 20, `exactly 20 calls were ever granted (got ${spent})`);

      // Concurrent refreshes must not both see the same headroom.
      await eodhd.__resetEodhdLedgerForTests();
      const races = await Promise.all(
        Array.from({ length: 10 }, () => eodhd.reserveEodhdCalls(4, day)),
      );
      const totalGranted = races.reduce((a, b) => a + b, 0);
      expect(
        totalGranted === 20,
        `10 concurrent 4-call requests grant 20 in total, not more (got ${totalGranted})`,
      );

      const nextDay = new Date("2026-08-29T00:00:01Z");
      expect(
        (await eodhd.eodhdUsage(nextDay)).used === 0,
        "the allowance resets at 00:00 GMT",
      );
      expect(
        (await eodhd.reserveEodhdCalls(20, nextDay)) === 20,
        "a full allowance is available the next day",
      );

      // Per-ticker fetch dates drive which holdings spend tomorrow's calls.
      await eodhd.recordEodhdFetched(["XEQT.TO", "VFV.TO"], day);
      const seen = await eodhd.eodhdLastFetched();
      expect(
        seen.get("XEQT.TO") === "2026-08-28" && seen.get("VFV.TO") === "2026-08-28",
        "records which tickers were priced today",
      );
      await eodhd.__resetEodhdLedgerForTests();
    }

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
        registration: "TFSA",
      },
      99,
    );
    state = await repo.getState();
    expect(state.accounts.some((a) => a.id === "test-acc-1"), "account inserted");
    expect(
      state.accounts.find((a) => a.id === "test-acc-1")?.registration === "TFSA",
      "registration survives the insert",
    );
    await repo.replaceAccount({
      id: "test-acc-1",
      name: "Renamed Account",
      institution: "Test Bank",
      kind: "savings",
      balance: 750,
      history: [{ month: "2026-08", value: 750 }],
      registration: "RRSP",
    });
    state = await repo.getState();
    expect(state.accounts.find((a) => a.id === "test-acc-1")?.balance === 750, "account updated");
    expect(
      state.accounts.find((a) => a.id === "test-acc-1")?.registration === "RRSP",
      "registration can be changed",
    );

    // Crypto accounts hold positions like a brokerage does.
    await repo.insertAccount(
      {
        id: "test-crypto-1",
        name: "Ledger",
        institution: "Self-custody",
        kind: "crypto",
        balance: 0,
        history: [],
      },
      98,
    );
    state = await repo.getState();
    expect(
      state.accounts.find((a) => a.id === "test-crypto-1")?.kind === "crypto",
      "crypto account round-trips through the database",
    );
    await repo.deleteAccountRow("test-crypto-1");
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
        accountId: "acc-nonreg",
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
    expect(state.accounts.length === 9, "reset restores sample accounts");
    expect(!state.budgets.some((b) => b.category === "Coffee"), "reset clears added budgets");
    expect(!("test cafe" in state.merchantRules), "reset clears merchant rules");

    console.log("delete demo data");
    state = await repo.getState();
    expect(state.demoPresent, "demo data reported present while seeded");

    // A row the user created: it must survive the deletion untouched.
    await repo.insertAccount(
      {
        id: "user-account-1",
        name: "My Real Bank",
        institution: "Tangerine",
        kind: "checking",
        balance: 1234.56,
        history: [{ month: "2026-08", value: 1234.56 }],
      },
      99,
    );
    await repo.upsertBudget("Fees", 25);

    await repo.deleteDemoData();
    state = await repo.getState();
    expect(!state.demoPresent, "demo data reported absent after deletion");
    expect(
      state.accounts.length === 1 && state.accounts[0].id === "user-account-1",
      `only the user's account survives (got ${state.accounts.length})`,
    );
    expect(state.transactions.length === 0, `demo transactions deleted (${state.transactions.length} left)`);
    expect(state.holdings.length === 0, `demo holdings deleted (${state.holdings.length} left)`);
    expect(
      state.budgets.length === 1 && state.budgets[0].category === "Fees",
      `demo budgets deleted, the user's kept (got ${JSON.stringify(state.budgets)})`,
    );
    expect(state.categories.length === 13, "category list is kept");
    expect(await repo.isDemoDeleted(), "deletion is recorded in app_meta");

    // The regression this marker exists for: an emptied database must not be
    // mistaken for a first run and re-seeded. ensureDb() memoises its first
    // run, so assert the two conditions it seeds on rather than calling it
    // again, which would return the cached promise and prove nothing.
    await repo.deleteAccountRow("user-account-1");
    expect(!(await repo.isSeeded()), "an emptied database looks unseeded…");
    expect(await repo.isDemoDeleted(), "…but the demo-deleted marker suppresses re-seeding");

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
