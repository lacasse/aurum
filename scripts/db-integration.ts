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
    const { currentMonthKey } = await import("../src/lib/format");

    console.log("migrations + seed");
    /*
     * Counted against the generator rather than against numbers written here.
     * The numbers were literals, so every addition to the sample — a pension
     * account, a closed position — failed this suite for being right, and the
     * fix each time was to edit the expectation, which is a test that only
     * ever confirms what it was last told. What matters is that everything
     * generated arrives, whatever that is this week.
     */
    const sample = generateSampleData();
    // The first account comes from these, as it does from .env on a real
    // installation, and the demo data is seeded into its record.
    process.env.AUTH_USERNAME = "owner";
    process.env.AUTH_PASSWORD = "owner-password-for-tests";
    await ensureDb();
    const owner = await repo.firstAdmin();
    if (!owner) throw new Error("no first account after ensureDb");
    const uid = owner.id;
    expect(owner.username === "owner", "the placeholder owner is claimed with the deployment's username");
    let state = await repo.getState(uid);
    expect(
      state.accounts.length === sample.accounts.length,
      `every seeded account arrives (${sample.accounts.length}, got ${state.accounts.length})`,
    );
    expect(state.transactions.length > 400, `seeded transactions (${state.transactions.length})`);
    expect(
      state.holdings.length === sample.holdings.length,
      `every seeded holding arrives (${sample.holdings.length}, got ${state.holdings.length})`,
    );
    expect(
      state.budgets.length === sample.budgets.length,
      `every seeded budget arrives (${sample.budgets.length}, got ${state.budgets.length})`,
    );
    expect(
      state.categories.length === sample.categories.length,
      `every seeded category arrives (${sample.categories.length}, got ${state.categories.length})`,
    );
    expect(
      state.recurring.length === sample.recurring.length,
      `every seeded rule arrives (${sample.recurring.length}, got ${state.recurring.length})`,
    );
    /* The trade histories are what most of the app reads; seeded empty once. */
    expect(
      state.holdings.every((h) => (h.flows ?? []).length > 0),
      "every seeded holding keeps its trades",
    );

    // ensureDb is idempotent
    await ensureDb();
    state = await repo.getState(uid);
    expect(state.accounts.length === sample.accounts.length, "ensureDb does not double-seed");

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
    await repo.insertTransaction(uid, txn);
    state = await repo.getState(uid);
    expect(
      Math.abs(state.accounts.find((a) => a.id === checking.id)!.balance - (before - 10)) < 0.01,
      "expense reduces account balance by 10",
    );

    await repo.updateTransactionRow(uid, "test-txn-1", { ...txn, amount: 25 });
    state = await repo.getState(uid);
    expect(
      Math.abs(state.accounts.find((a) => a.id === checking.id)!.balance - (before - 25)) < 0.01,
      "editing amount re-applies delta (now -25)",
    );

    await repo.removeTransaction(uid, "test-txn-1");
    state = await repo.getState(uid);
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

      await repo.insertTransaction(uid, {
        id: "test-transfer-1",
        date: "2026-08-20",
        type: "transfer",
        amount: 500,
        category: "Transfer",
        sourceAccountId: from.id,
        destinationAccountId: to.id,
        payee: "TFSA contribution",
      });
      state = await repo.getState(uid);
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
      await repo.insertTransaction(uid, {
        id: "test-transfer-2",
        date: "2026-08-21",
        type: "transfer",
        amount: 200,
        category: "Transfer",
        sourceAccountId: from.id,
        destinationAccountId: card.id,
        payee: "Card payment",
      });
      state = await repo.getState(uid);
      expect(
        Math.abs(at(card.id) - (cardBefore - 200)) < 0.01,
        "paying a credit card reduces what is owed",
      );

      await repo.removeTransaction(uid, "test-transfer-1");
      await repo.removeTransaction(uid, "test-transfer-2");
      state = await repo.getState(uid);
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
      await repo.insertRecurringRule(uid, 
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

      const created = await repo.materializeRecurring(uid, "2026-08-27");
      expect(created === 3, `posts the three payments already due (got ${created})`);
      state = await repo.getState(uid);
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
      const again = await repo.materializeRecurring(uid, "2026-08-27");
      expect(again === 0, `re-running posts nothing (got ${again})`);
      state = await repo.getState(uid);
      expect(
        state.transactions.filter((t) => t.recurringId === "test-rule-1").length === 3,
        "no duplicates after a second run",
      );

      await repo.deleteRecurringRule(uid, "test-rule-1");
      state = await repo.getState(uid);
      expect(!state.recurring.some((r) => r.id === "test-rule-1"), "rule deleted");
      expect(
        state.transactions.filter((t) => t.recurringId === "test-rule-1").length === 3,
        "payments it already posted are kept",
      );
      for (const t of state.transactions.filter((t) => t.recurringId === "test-rule-1")) {
        await repo.removeTransaction(uid, t.id);
      }
    }

    console.log("EODHD daily cap (never touches the network)");
    {
      const eodhd = await import("../src/db/eodhd");
      /*
       * Read the cap rather than assuming it. CI pins EODHD_DAY_LIMIT to zero
       * so no test can spend a real call, and assertions written against a
       * hardcoded 20 simply failed there — every one of them, on every run,
       * unnoticed. Expressed in terms of the limit they hold either way: the
       * behaviour under test is the ledger's arithmetic, not the number.
       */
      const { EODHD_DAY_LIMIT } = await import("../src/lib/eodhd-quota");
      const cap = EODHD_DAY_LIMIT;
      const opening = Math.min(5, cap);
      const day = new Date("2026-08-28T12:00:00Z");
      await eodhd.__resetEodhdLedgerForTests();

      const first = await eodhd.reserveEodhdCalls(uid, 5, day);
      expect(first === opening, `grants ${opening} of ${cap} (got ${first})`);

      // The ledger is in the database, so this is what a container restart
      // sees — an in-memory counter would have reset to zero here.
      const usage = await eodhd.eodhdUsage(uid, day);
      expect(
        usage.used === opening && usage.remaining === cap - opening,
        "usage persists to the database",
      );

      const rest = await eodhd.reserveEodhdCalls(uid, 219, day);
      expect(
        rest === cap - opening,
        `a 219-ticker refresh gets only the ${cap - opening} left (got ${rest})`,
      );
      expect((await eodhd.reserveEodhdCalls(uid, 1, day)) === 0, "further calls are refused");

      const spent = (await eodhd.eodhdUsage(uid, day)).used;
      expect(spent === cap, `exactly ${cap} calls were ever granted (got ${spent})`);

      // Concurrent refreshes must not both see the same headroom.
      await eodhd.__resetEodhdLedgerForTests();
      const races = await Promise.all(
        Array.from({ length: 10 }, () => eodhd.reserveEodhdCalls(uid, 4, day)),
      );
      const totalGranted = races.reduce((a, b) => a + b, 0);
      expect(
        totalGranted === cap,
        `10 concurrent 4-call requests grant ${cap} in total, not more (got ${totalGranted})`,
      );

      const nextDay = new Date("2026-08-29T00:00:01Z");
      expect(
        (await eodhd.eodhdUsage(uid, nextDay)).used === 0,
        "the allowance resets at 00:00 GMT",
      );
      expect(
        (await eodhd.reserveEodhdCalls(uid, cap, nextDay)) === cap,
        "a full allowance is available the next day",
      );

      // Type-ahead validation draws on a lower ceiling than the refresh, so a
      // field cannot eat the allowance every holding's price depends on.
      const { validateLimit } = await import("../src/lib/eodhd-quota");
      await eodhd.__resetEodhdLedgerForTests();
      const validateCap = validateLimit();
      expect(
        (await eodhd.reserveEodhdCalls(uid, cap, day, validateCap)) === validateCap,
        `validation stops at ${validateCap} of ${cap}`,
      );
      expect(
        (await eodhd.reserveEodhdCalls(uid, cap, day)) === cap - validateCap,
        "the refresh can still spend what validation left",
      );

      // Per-ticker fetch dates drive which holdings spend tomorrow's calls.
      await eodhd.recordEodhdFetched(["XEQT.TO", "USLG.TO"], day);
      const seen = await eodhd.eodhdLastFetched();
      expect(
        seen.get("XEQT.TO") === "2026-08-28" && seen.get("USLG.TO") === "2026-08-28",
        "records which tickers were priced today",
      );
      await eodhd.__resetEodhdLedgerForTests();
    }

    {
      /*
       * The price cache has to outlive the process. Held in a module-level Map
       * it was empty after every restart, so each deploy made every ticker look
       * unfetched and the next page load re-bought the whole portfolio.
       * ALL-FIXTURES-INVENTED
       */
      console.log("price cache survives a restart");
      const cache = await import("../src/db/price-cache");
      await cache.__resetPriceCacheForTests();

      expect((await cache.readPriceCache()).size === 0, "starts empty");

      const at = Date.UTC(2026, 7, 28, 14, 0, 0);
      await cache.recordPrices(new Map([["WEQT.TO", 34.5], ["EXMPL", 12.25]]), at);

      // A fresh read is what a restarted process does: nothing is carried over
      // in memory, so this only passes if the cache is genuinely stored.
      const restored = await cache.readPriceCache();
      expect(
        restored.get("WEQT.TO")?.price === 34.5 && restored.get("WEQT.TO")?.at === at,
        "a stored price and its timestamp are read back",
      );

      // One request only asks about the tickers on one page, so a write must
      // merge rather than replace — otherwise it drops every other holding.
      await cache.recordPrices(new Map([["EXMPL", 13.0]]), at + 60_000);
      const merged = await cache.readPriceCache();
      expect(merged.size === 2, "writing one ticker keeps the others");
      expect(merged.get("EXMPL")?.price === 13.0, "the written ticker is updated");
      expect(merged.get("WEQT.TO")?.price === 34.5, "the untouched ticker is unchanged");

      expect(
        (await cache.recordPrices(new Map(), at)) === undefined &&
          (await cache.readPriceCache()).size === 2,
        "writing nothing changes nothing",
      );

      await cache.__resetPriceCacheForTests();
    }

    {
      console.log("twelve data credit ledger");
      const td = await import("../src/db/twelvedata");
      const { MINUTE_RESERVE, TWELVEDATA_MINUTE_LIMIT } = await import(
        "../src/lib/twelvedata-quota"
      );
      const minuteCap = Math.max(0, TWELVEDATA_MINUTE_LIMIT - MINUTE_RESERVE);
      // Zero under CI's pinned limits, where "grants a full minute" is not a
      // meaningful claim — the assertion is that granting tracks the cap.
      const spendable = minuteCap > 0;
      const at = new Date("2026-08-28T13:30:00Z");
      await td.__resetTwelveDataLedgerForTests();

      expect(
        (await td.reserveTwelveDataCredits(uid, minuteCap, at)) === spendable,
        `a full minute's credits are granted (${minuteCap})`,
      );
      expect(
        !(await td.reserveTwelveDataCredits(uid, 1, at)),
        "one more in the same minute is refused",
      );
      expect(
        (await td.twelveDataUsage(uid, at)).minute.remaining === 0,
        "the minute is reported as spent",
      );

      // The next minute restores the per-minute allowance but not the day's.
      const nextMinute = new Date(at.getTime() + 60_000);
      expect(
        (await td.reserveTwelveDataCredits(uid, 1, nextMinute)) === spendable,
        "a new minute restores the allowance",
      );
      expect(
        (await td.twelveDataUsage(uid, nextMinute)).day.used === minuteCap + (spendable ? 1 : 0),
        "the daily count carries across minutes",
      );

      // The whole point of moving this out of memory: concurrent refreshes must
      // not both see the same remaining allowance.
      await td.__resetTwelveDataLedgerForTests();
      const results = await Promise.all(
        Array.from({ length: 10 }, () => td.reserveTwelveDataCredits(uid, 2, at)),
      );
      const grantedCredits = results.filter(Boolean).length * 2;
      expect(
        grantedCredits <= minuteCap,
        `10 concurrent 2-credit requests never exceed ${minuteCap} (got ${grantedCredits})`,
      );
      await td.__resetTwelveDataLedgerForTests();
    }

    console.log("budgets / categories");
    await repo.upsertBudget(uid, "Coffee", 42.5);
    state = await repo.getState(uid);
    expect(state.budgets.some((b) => b.category === "Coffee" && b.limit === 42.5), "budget upsert");
    await repo.upsertBudget(uid, "Coffee", 60);
    state = await repo.getState(uid);
    expect(state.budgets.find((b) => b.category === "Coffee")?.limit === 60, "budget update");

    await repo.insertCategory(uid, "Coffee", 99);
    await repo.renameCategoryEverywhere(uid, "Groceries", "Food");
    state = await repo.getState(uid);
    expect(state.categories.includes("Food") && !state.categories.includes("Groceries"), "category renamed");
    expect(state.budgets.some((b) => b.category === "Food"), "budget renamed with category");
    expect(
      state.transactions.some((t) => t.category === "Food") &&
        !state.transactions.some((t) => t.category === "Groceries"),
      "transactions renamed with category",
    );

    await repo.deleteCategorySmart(uid, "Food");
    state = await repo.getState(uid);
    expect(!state.categories.includes("Food"), "category deleted");
    expect(!state.budgets.some((b) => b.category === "Food"), "budget deleted with category");
    expect(
      state.transactions.every((t) => t.category !== "Food"),
      "transactions moved off deleted category",
    );

    await repo.upsertMerchantRule(uid, "test cafe", "Dining");
    state = await repo.getState(uid);
    expect(state.merchantRules["test cafe"] === "Dining", "merchant rule stored");

    console.log("accounts / holdings");
    await repo.insertAccount(uid, 
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
    state = await repo.getState(uid);
    expect(state.accounts.some((a) => a.id === "test-acc-1"), "account inserted");
    expect(
      state.accounts.find((a) => a.id === "test-acc-1")?.registration === "TFSA",
      "registration survives the insert",
    );
    await repo.replaceAccount(uid, {
      id: "test-acc-1",
      name: "Renamed Account",
      institution: "Test Bank",
      kind: "savings",
      balance: 750,
      history: [{ month: "2026-08", value: 750 }],
      registration: "RRSP",
    });
    state = await repo.getState(uid);
    expect(state.accounts.find((a) => a.id === "test-acc-1")?.balance === 750, "account updated");
    expect(
      state.accounts.find((a) => a.id === "test-acc-1")?.registration === "RRSP",
      "registration can be changed",
    );

    /*
     * A transaction records against the month it is entered in, and leaves a
     * closed month alone. Both sides of this used to write the last element of
     * the history array on the assumption that it was the current month: with
     * July the last month on record, August's spending overwrote July's close.
     */
    await repo.insertAccount(uid, 
      {
        id: "test-acc-months",
        name: "History Account",
        institution: "Test Bank",
        kind: "checking",
        balance: 1000,
        history: [
          { month: "2020-02", value: 100 },
          { month: "2026-07", value: 1000 },
        ],
      },
      98,
    );
    await repo.insertTransaction(uid, {
      id: "test-txn-months",
      date: `${currentMonthKey()}-15`,
      type: "expense",
      amount: 250,
      category: "Groceries",
      sourceAccountId: "test-acc-months",
      payee: "Market",
    });
    state = await repo.getState(uid);
    const withMonths = state.accounts.find((a) => a.id === "test-acc-months");
    expect(withMonths?.balance === 750, "the balance moved");
    expect(
      withMonths?.history.find((p) => p.month === "2026-07")?.value === 1000,
      "a closed month keeps the balance it closed at",
    );
    expect(
      withMonths?.history.find((p) => p.month === currentMonthKey())?.value === 750,
      "the current month is what got recorded",
    );
    expect(
      withMonths?.history.find((p) => p.month === "2020-02")?.value === 100,
      "the oldest month is still there — nothing was rebuilt",
    );

    // Crypto accounts hold positions like a brokerage does.
    await repo.insertAccount(uid, 
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
    state = await repo.getState(uid);
    expect(
      state.accounts.find((a) => a.id === "test-crypto-1")?.kind === "crypto",
      "crypto account round-trips through the database",
    );
    await repo.deleteAccountRow(uid, "test-crypto-1");
    await repo.deleteAccountRow(uid, "test-acc-1");
    state = await repo.getState(uid);
    expect(!state.accounts.some((a) => a.id === "test-acc-1"), "account deleted");

    await repo.insertHolding(uid, 
      {
        id: "test-hold-1",
        ticker: "TEST",
        name: "Test ETF",
        assetClass: "US Equity",
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
        flows: [
          { date: "2025-01-10", kind: "buy", amount: 200, shares: 2 },
          { date: "2025-06-10", kind: "dividend", amount: 5, shares: 0 },
        ],
      },
      99,
    );
    state = await repo.getState(uid);
    expect(state.holdings.some((h) => h.id === "test-hold-1" && h.price === 110), "holding inserted");
    {
      // Flows are what realized gain and MWRR are derived from, so they have to
      // survive the round trip intact.
      const stored = state.holdings.find((h) => h.id === "test-hold-1");
      expect(stored?.flows.length === 2, `flows round-trip (got ${stored?.flows.length})`);
      expect(stored?.flows[0].kind === "buy" && stored?.flows[0].amount === 200, "flow detail kept");
    }
    {
      // The same security in a second account: a rename has to reach both, or
      // the holdings page stops pooling them into one row.
      await repo.insertHolding(uid, 
        {
          id: "test-hold-2",
          ticker: "test",
          name: "Test ETF",
          assetClass: "US Equity",
          shares: 1,
          avgCost: 100,
          price: 110,
          history: [110],
          dividendsReceived: 0,
          accountId: "acc-tfsa",
          currency: "CAD",
          priceCAD: 110,
          avgCostCAD: 100,
          dividendsReceivedCAD: 0,
          historyCAD: [110],
          flows: [],
        },
        100,
      );
      const changed = await repo.updateSecurity(uid, "TEST", {
        ticker: "TSET",
        name: "Renamed ETF",
        assetClass: "Bonds",
        price: 125,
        priceCAD: 125,
        currency: "CAD",
      });
      expect(changed === 2, `rename touches every account (got ${changed})`);
      state = await repo.getState(uid);
      const renamed = state.holdings.filter((h) => h.ticker === "TSET");
      expect(renamed.length === 2, "both lots carry the new ticker");
      expect(
        renamed.every((h) => h.name === "Renamed ETF" && h.assetClass === "Bonds"),
        "name and asset class propagate too",
      );
      expect(
        renamed.every((h) => h.price === 125 && h.priceCAD === 125),
        "a manual price reaches every account holding the security",
      );
      expect(
        renamed.every((h) => h.history[h.history.length - 1] === 125),
        "the price history ends on the manual price, so the chart agrees",
      );
      await repo.deleteHoldingRow(uid, "test-hold-2");
    }

    await repo.deleteHoldingRow(uid, "test-hold-1");
    state = await repo.getState(uid);
    expect(!state.holdings.some((h) => h.id === "test-hold-1"), "holding deleted");

    console.log("reset");
    await repo.resetToSample(uid, generateSampleData());
    state = await repo.getState(uid);
    expect(
      state.accounts.length === sample.accounts.length,
      "reset restores sample accounts",
    );
    expect(!state.budgets.some((b) => b.category === "Coffee"), "reset clears added budgets");
    expect(!("test cafe" in state.merchantRules), "reset clears merchant rules");

    console.log("delete demo data");
    state = await repo.getState(uid);
    expect(state.demoPresent, "demo data reported present while seeded");

    // A row the user created: it must survive the deletion untouched.
    await repo.insertAccount(uid, 
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
    await repo.upsertBudget(uid, "Fees", 25);

    console.log("monthly price history");
    {
      const ph = await import("../src/db/price-history");
      await ph.writePriceHistory([
        { ticker: "TEST.TO", month: "2024-01", close: 10.5, currency: "CAD" },
        { ticker: "TEST.TO", month: "2024-02", close: 11.25, currency: "CAD" },
        { ticker: "USDCAD", month: "2024-01", close: 1.34, currency: "CAD" },
      ]);
      let rows = await ph.readPriceHistory(["TEST.TO", "USDCAD"]);
      expect(rows.length === 3, `three closes stored (got ${rows.length})`);
      expect(
        rows[0].month <= rows[rows.length - 1].month,
        "closes come back oldest first",
      );

      // The current month is written while it is still running, so a second
      // write of the same month has to replace the first rather than fail.
      await ph.writePriceHistory([
        { ticker: "TEST.TO", month: "2024-02", close: 12.75, currency: "CAD" },
      ]);
      rows = await ph.readPriceHistory(["TEST.TO"]);
      const feb = rows.find((r) => r.month === "2024-02");
      expect(rows.length === 2, `re-writing a month updates it (got ${rows.length} rows)`);
      expect(feb?.close === 12.75, `the newer close wins (got ${feb?.close})`);
      expect(
        (await ph.readPriceHistory([])).length === 0,
        "asking for no tickers queries nothing",
      );

      /*
       * The user's own month-end record outranks anything fetched. A backfill
       * arriving later must not overwrite it — the snapshot is what the
       * position was actually worth, the fetched close is a reconstruction.
       */
      await ph.writePriceHistory([
        { ticker: "TEST.TO", month: "2024-01", close: 9.99, currency: "CAD", source: "snapshot" },
      ]);
      await ph.writePriceHistory([
        { ticker: "TEST.TO", month: "2024-01", close: 42, currency: "CAD" },
      ]);
      const jan = (await ph.readPriceHistory(["TEST.TO"])).find((r) => r.month === "2024-01");
      expect(jan?.close === 9.99, `a provider close cannot overwrite a snapshot (got ${jan?.close})`);
      expect(jan?.source === "snapshot", `the snapshot keeps its source (got ${jan?.source})`);

      // …but a corrected snapshot replaces the earlier one.
      await ph.writePriceHistory([
        { ticker: "TEST.TO", month: "2024-01", close: 10.25, currency: "CAD", source: "snapshot" },
      ]);
      const revised = (await ph.readPriceHistory(["TEST.TO"])).find((r) => r.month === "2024-01");
      expect(revised?.close === 10.25, `a newer snapshot wins (got ${revised?.close})`);
    }

    console.log("benchmark series");
    {
      const bm = await import("../src/db/benchmark");
      const { BENCHMARK_TICKER } = await import("../src/lib/benchmark");
      const ph = await import("../src/db/price-history");

      // The series ships with the code, so a fresh database already has it.
      const shipped = await ph.readPriceHistory([BENCHMARK_TICKER]);
      expect(shipped.length === 78, `78 benchmark closes ship with the code (got ${shipped.length})`);
      expect(
        (await bm.lastBenchmarkMonth()) === "2026-07",
        `the shipped series ends where the migration says (got ${await bm.lastBenchmarkMonth()})`,
      );
      expect(
        shipped.every((r) => r.source === "benchmark"),
        "every shipped row is tagged as the benchmark",
      );

      // A month the fill has written extends the series.
      const NEXT = "2026-08";
      await ph.writePriceHistory([
        { ticker: BENCHMARK_TICKER, month: NEXT, close: 46.5, currency: "CAD", source: "benchmark" },
      ]);
      expect(
        (await bm.lastBenchmarkMonth()) === NEXT,
        "the series knows its newest month",
      );

      // A price feed must never overwrite the benchmark series.
      await ph.writePriceHistory([
        { ticker: BENCHMARK_TICKER, month: NEXT, close: 1.23, currency: "CAD" },
      ]);
      const after = (await ph.readPriceHistory([BENCHMARK_TICKER])).find((r) => r.month === NEXT);
      expect(after?.close === 46.5, `a provider cannot clobber a benchmark close (got ${after?.close})`);

      // With the day's allowance pinned to zero, no call can be made.
      expect((await bm.fillBenchmarkGap(uid)) === 0, "the gap fill spends nothing when the cap is zero");
    }

    await repo.deleteDemoData(uid);
    state = await repo.getState(uid);
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
    expect(
      state.categories.length === sample.categories.length,
      "category list is kept",
    );
    expect(await repo.isDemoDeleted(uid), "deletion is recorded in the user's settings");

    // The regression this marker exists for: an emptied database must not be
    // mistaken for a first run and re-seeded. ensureDb() memoises its first
    // run, so assert the two conditions it seeds on rather than calling it
    // again, which would return the cached promise and prove nothing.
    await repo.deleteAccountRow(uid, "user-account-1");
    expect(!(await repo.isSeeded(uid)), "an emptied database looks unseeded…");
    expect(await repo.isDemoDeleted(uid), "…but the demo-deleted marker suppresses re-seeding");

    /*
     * Two people, one installation. Everything above ran as the first account;
     * this is the second, and the question is only ever "can they reach the
     * first account's record?" — through a read, a write aimed at an id, a
     * transaction that names somebody else's account, or a name they share.
     */
    console.log("isolation between users");
    const { hashPassword } = await import("../src/lib/auth");
    await repo.insertUser({
      id: "second-user",
      username: "second",
      passwordHash: hashPassword("second-password-for-tests"),
      role: "member",
      createdAt: new Date().toISOString(),
    });
    const other = "second-user";

    // The first user's record was emptied by the demo tests above, so give it
    // an account and a transaction of its own to be protected.
    await repo.insertAccount(
      uid,
      {
        id: "owner-chequing",
        name: "Owner chequing",
        institution: "Example Bank",
        kind: "checking",
        balance: 1000,
        history: [],
      },
      await repo.nextPosition(uid, (await import("../src/db/schema")).accounts),
    );
    await repo.insertTransaction(uid, {
      id: "owner-expense-1",
      date: new Date().toISOString().slice(0, 10),
      type: "expense",
      amount: 10,
      category: "Groceries",
      sourceAccountId: "owner-chequing",
      payee: "Example market",
    });
    await repo.insertCategory(uid, "Groceries", 0);
    await repo.upsertBudget(uid, "Groceries", 300);

    const mine = await repo.getState(uid);
    const theirs = await repo.getState(other);
    expect(theirs.accounts.length === 0, "a new user sees none of the first user's accounts");
    expect(theirs.transactions.length === 0, "…none of their transactions");
    expect(theirs.holdings.length === 0, "…none of their holdings");
    expect(theirs.budgets.length === 0 && theirs.categories.length === 0, "…none of their budgets or categories");
    expect(Object.keys(await repo.getSnapshotHistory(other)).length === 0, "…and none of their month-end values");

    const target = mine.accounts.find((a) => a.id === "owner-chequing")!;
    const targetBefore = (await repo.getState(uid)).accounts.find((a) => a.id === target.id)!;

    // A write aimed at somebody else's id does nothing.
    await repo.replaceAccount(other, { ...targetBefore, name: "renamed by someone else", balance: 1 });
    await repo.deleteAccountRow(other, target.id);
    const afterWrite = (await repo.getState(uid)).accounts.find((a) => a.id === target.id);
    expect(afterWrite?.name === targetBefore.name, "another user cannot rename an account by its id");
    expect(afterWrite !== undefined, "…or delete it");

    // A transaction naming somebody else's account does not move its balance.
    await repo.insertTransaction(other, {
      id: "second-user-expense",
      date: new Date().toISOString().slice(0, 10),
      type: "expense",
      amount: 500,
      category: "Groceries",
      sourceAccountId: target.id,
      payee: "Example market",
    });
    const afterTxn = (await repo.getState(uid)).accounts.find((a) => a.id === target.id)!;
    expect(
      afterTxn.balance === targetBefore.balance,
      "a transaction naming another user's account leaves that balance alone",
    );
    expect(
      !(await repo.getState(uid)).transactions.some((t) => t.id === "second-user-expense"),
      "…and does not appear in their record",
    );

    // Deleting or editing somebody else's transaction by id does nothing.
    const someTxn = (await repo.getState(uid)).transactions.find((t) => t.id === "owner-expense-1");
    expect(someTxn !== undefined, "the first user's transaction exists before the checks");
    if (someTxn) {
      await repo.removeTransaction(other, someTxn.id);
      await repo.updateTransactionRow(other, someTxn.id, { ...someTxn, amount: someTxn.amount + 1 });
      const still = (await repo.getState(uid)).transactions.find((t) => t.id === someTxn.id);
      expect(still?.amount === someTxn.amount, "another user cannot edit or delete a transaction by its id");
    }

    // The same name in two records is two rows.
    await repo.insertCategory(other, "Groceries", 0);
    await repo.upsertBudget(other, "Groceries", 1);
    await repo.upsertMerchantRule(other, "example market", "Groceries");
    const myBudget = (await repo.getState(uid)).budgets.find((b) => b.category === "Groceries");
    await repo.renameCategoryEverywhere(other, "Groceries", "Food");
    const myAfterRename = await repo.getState(uid);
    expect(
      myAfterRename.categories.includes("Groceries") && !myAfterRename.categories.includes("Food"),
      "renaming a category renames only your own",
    );
    expect(
      (myAfterRename.budgets.find((b) => b.category === "Groceries")?.limit ?? null) ===
        (myBudget?.limit ?? null),
      "a budget of the same name in another record is untouched",
    );

    // One figure per month per kind is a rule about one person's record. The
    // guard used to compare everyone's rows, so one user's monthly import
    // refused another's receipts — and said how many rows the other held.
    await repo.insertTransaction(uid, {
      id: "owner-monthly-2025-03",
      date: "2025-03-31",
      type: "expense",
      amount: 900,
      category: "Groceries",
      sourceAccountId: "owner-chequing",
      payee: "Monthly total",
      granularity: "monthly",
    });
    let refused: string | null = null;
    try {
      await repo.insertTransaction(other, {
        id: "second-receipt-2025-03",
        date: "2025-03-12",
        type: "expense",
        amount: 40,
        category: "Groceries",
        payee: "Example market",
        granularity: "individual",
      });
    } catch (err) {
      refused = err instanceof Error ? err.message : String(err);
    }
    expect(refused === null, "another user's monthly total does not refuse your receipts for that month");
    let ownRefused = false;
    try {
      await repo.insertTransaction(uid, {
        id: "owner-receipt-2025-03",
        date: "2025-03-12",
        type: "expense",
        amount: 40,
        category: "Groceries",
        payee: "Example market",
        granularity: "individual",
      });
    } catch {
      ownRefused = true;
    }
    expect(ownRefused, "…while your own monthly total still refuses your own receipts");

    // Settings are per person.
    await repo.setExpenseSettings(other, { groups: { Food: "discretionary" }, car: null });
    expect(
      (await repo.getExpenseSettings(uid)).groups.Food === undefined,
      "one user's expense settings are not another's",
    );

    // Wiping a record wipes one record.
    await repo.wipe(other);
    expect(
      (await repo.getState(uid)).accounts.length === myAfterRename.accounts.length,
      "emptying one user's record leaves the other's",
    );

    if (failures > 0) console.error(`\n${failures} test(s) failed`);
    else console.log("\nall db integration tests passed");
  } finally {
    /*
     * Closing the pool belongs here, not at the end of the try: an assertion
     * that throws used to skip it and leave connections open, and postgres
     * terminating them on shutdown surfaced as an unhandled 'error' that took
     * the process down with a stack trace instead of a test report.
     */
    try {
      const { pool } = await import("../src/db/index");
      pool.on("error", () => {}); // shutdown races are not test failures
      await pool.end();
    } catch {
      // Never opened, or already closed. Either way there is nothing to close.
    }
    await pg.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  /*
   * Exit explicitly, and last. `process.exitCode` set before the shutdown above
   * did not survive it: the suite reported nine failures and the job still went
   * green, which is worse than either a pass or a fail.
   */
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
