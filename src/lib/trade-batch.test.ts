import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  baseTicker,
  holdingProblems,
  isBlankTrade,
  isCdr,
  tickerForSecurity,
  newPositionsNeeded,
  resolveTicker,
  planTrades,
  type TradeInput,
} from "./trade-batch";
import type { Holding } from "./types";

const row = (over: Partial<TradeInput> = {}): TradeInput => ({
  date: "2026-08-10",
  action: "buy",
  ticker: "XEQT.TO",
  quantity: "10",
  price: "35",
  accountId: "acct-1",
  currency: "CAD",
  cadAmount: "",
  ...over,
});

const holding = (over: Partial<Holding> = {}): Holding =>
  ({
    id: "h1",
    ticker: "XEQT.TO",
    name: "XEQT",
    assetClass: "US Equity",
    shares: 100,
    avgCost: 30,
    price: 36,
    history: [],
    dividendsReceived: 0,
    accountId: "acct-1",
    currency: "CAD",
    priceCAD: 36,
    avgCostCAD: 30,
    dividendsReceivedCAD: 0,
    historyCAD: [],
    flows: [],
    ...over,
  }) as Holding;

const meta = [{ ticker: "XEQT.TO", name: "XEQT", assetClass: "US Equity" as const }];

describe("isBlankTrade", () => {
  test("a row nobody touched is not a trade", () => {
    assert.equal(isBlankTrade(row({ ticker: "", quantity: "", price: "" })), true);
  });

  test("a row with anything in it is", () => {
    assert.equal(isBlankTrade(row({ quantity: "", price: "" })), false);
  });
});

describe("newPositionsNeeded", () => {
  test("a buy of a ticker nobody holds needs describing", () => {
    const needed = newPositionsNeeded([row()], []);
    assert.deepEqual(needed.map((n) => n.ticker), ["XEQT.TO"]);
  });

  test("a coin is not guessed to be an equity", () => {
    const [n] = newPositionsNeeded([row({ ticker: "BTC" })], []);
    assert.equal(n.assetClass, "Crypto");
  });

  test("a ticker already held needs nothing", () => {
    assert.deepEqual(newPositionsNeeded([row()], [holding()]), []);
  });

  test("selling something unknown is an error, not a new position", () => {
    assert.deepEqual(newPositionsNeeded([row({ action: "sell" })], []), []);
  });

  test("one ticker across several rows is asked about once", () => {
    assert.equal(newPositionsNeeded([row(), row()], []).length, 1);
  });
});

describe("resolveTicker", () => {
  test("the venue is not part of the symbol", () => {
    assert.equal(baseTicker("TSLA.NEO"), "TSLA");
    assert.equal(baseTicker("xeqt.to"), "XEQT");
    assert.equal(baseTicker("CRYX-B.TO"), "CRYX-B");
  });

  test("a symbol held without its venue is not a new position", () => {
    const held = [holding({ ticker: "XEQT" })];
    assert.equal(resolveTicker("XEQT.TO", held, "acct-1"), "XEQT");
    assert.deepEqual(newPositionsNeeded([row()], held), []);
  });

  test("and the other way round", () => {
    const held = [holding({ ticker: "TSLA.NEO" })];
    assert.equal(resolveTicker("TSLA", held, "acct-1"), "TSLA.NEO");
  });

  test("an exact match wins over a venue-less one", () => {
    const held = [
      holding({ id: "a", ticker: "ZQX", currency: "USD" }),
      holding({ id: "b", ticker: "ZQX.NEO" }),
    ];
    assert.equal(resolveTicker("ZQX.NEO", held, "acct-1"), "ZQX.NEO");
  });

  test("two spellings in different accounts are decided by the account", () => {
    const held = [
      holding({ id: "a", ticker: "DVFD", accountId: "acct-1" }),
      holding({ id: "b", ticker: "DVFD.TO", accountId: "acct-2" }),
    ];
    assert.equal(resolveTicker("DVFD.V", held, "acct-2"), "DVFD.TO");
  });

  test("an ambiguous symbol is left alone rather than guessed", () => {
    const held = [
      holding({ id: "a", ticker: "DVFD", accountId: "acct-9" }),
      holding({ id: "b", ticker: "DVFD.TO", accountId: "acct-9" }),
    ];
    assert.equal(resolveTicker("DVFD.V", held, "acct-1"), "DVFD.V");
  });

  test("a symbol nobody holds is still new", () => {
    assert.equal(resolveTicker("OMNI", [holding()], "acct-1"), "OMNI");
  });
});

/*
 * A depositary receipt is not the underlying share on another venue. It has its
 * own price, currency and cost base, and `.NEO` is therefore not a venue
 * suffix the way `.TO` is.
 *
 * Stripping it made every trade in the US listing match the receipt and be
 * absorbed into it — the same rule that stops duplicates, merging two genuinely
 * different securities. The export makes this easy to get wrong: it writes a
 * receipt under the *bare* symbol, so the symbol alone can never tell them
 * apart. The name and the currency can.
 *
 * ALL-FIXTURES-INVENTED
 */
describe("a receipt and the share it tracks are two securities", () => {
  const CDR_NAME = "Zephyr Industries CDR (CAD Hedged)";
  const US_NAME = "Zephyr Industries Incorporated (Class A)";

  test("the name is what says it is a receipt", () => {
    assert.equal(isCdr(CDR_NAME, "CAD"), true);
    assert.equal(isCdr(US_NAME, "USD"), false);
    // Plenty of ordinary securities trade in Canadian dollars.
    assert.equal(isCdr("Broad Market Index ETF", "CAD"), false);
  });

  test("a receipt row is filed under the suffixed ticker", () => {
    assert.equal(tickerForSecurity("ZQX", CDR_NAME, "CAD"), "ZQX.NEO");
    assert.equal(tickerForSecurity("ZQX", US_NAME, "USD"), "ZQX");
  });

  test("an already-suffixed symbol is not suffixed twice", () => {
    assert.equal(tickerForSecurity("ZQX.NEO", CDR_NAME, "CAD"), "ZQX.NEO");
  });

  test("a row with no name is left as written", () => {
    assert.equal(tickerForSecurity("ZQX"), "ZQX");
  });

  test("a US trade does not match the receipt already held", () => {
    const held = [holding({ id: "a", ticker: "ZQX.NEO", currency: "CAD" })];
    assert.equal(resolveTicker("ZQX", held, "acct-1", "USD"), "ZQX");
  });

  test("a CAD trade still matches the receipt", () => {
    const held = [holding({ id: "a", ticker: "ZQX.NEO", currency: "CAD" })];
    assert.equal(resolveTicker("ZQX", held, "acct-1", "CAD"), "ZQX.NEO");
  });

  test("both held at once, each trade goes to its own position", () => {
    const held = [
      holding({ id: "a", ticker: "ZQX.NEO", currency: "CAD" }),
      holding({ id: "b", ticker: "ZQX", currency: "USD" }),
    ];
    assert.equal(resolveTicker("ZQX", held, "acct-1", "USD"), "ZQX");
    assert.equal(resolveTicker("ZQX", held, "acct-1", "CAD"), "ZQX.NEO");
  });

  test("a US buy beside a receipt opens a position rather than joining it", () => {
    const held = [holding({ id: "a", ticker: "ZQX.NEO", currency: "CAD" })];
    const needed = newPositionsNeeded(
      [row({ ticker: "ZQX", currency: "USD", cadAmount: "1400" })],
      held,
    );
    assert.deepEqual(needed.map((n) => n.ticker), ["ZQX"]);
  });

  test("without a currency the old behaviour is unchanged", () => {
    const held = [holding({ id: "a", ticker: "ZQX.NEO", currency: "CAD" })];
    assert.equal(resolveTicker("ZQX", held, "acct-1"), "ZQX.NEO");
  });
});

describe("faults only visible across positions", () => {
  test("a receipt ticker held in US dollars is reported", () => {
    const problems = holdingProblems([
      holding({ id: "a", ticker: "ZQX.NEO", currency: "USD" }),
    ]);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /ZQX\.NEO/);
  });

  test("a receipt and its underlying side by side are not a duplicate", () => {
    assert.deepEqual(
      holdingProblems([
        holding({ id: "a", ticker: "ZQX.NEO", currency: "CAD" }),
        holding({ id: "b", ticker: "ZQX", currency: "USD" }),
      ]),
      [],
    );
  });

  test("two spellings of one security in one account still are", () => {
    const problems = holdingProblems([
      holding({ id: "a", ticker: "VNTR", currency: "CAD" }),
      holding({ id: "b", ticker: "VNTR.TO", currency: "CAD" }),
    ]);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /same security/);
  });

  test("the same security in two accounts is ordinary", () => {
    assert.deepEqual(
      holdingProblems([
        holding({ id: "a", ticker: "VNTR", accountId: "acct-1" }),
        holding({ id: "b", ticker: "VNTR", accountId: "acct-2" }),
      ]),
      [],
    );
  });

  test("nothing held is nothing wrong", () => {
    assert.deepEqual(holdingProblems([]), []);
  });
});

describe("planTrades: buying", () => {
  test("opens a position and takes the cash from the account", () => {
    const plan = planTrades([row()], meta, [], 1.37);
    assert.ok(plan.ok);
    const [c] = plan.batch.changes;
    assert.equal(c.existing, null);
    assert.equal(c.shares, 10);
    assert.equal(c.avgCost, 35);
    assert.deepEqual(plan.batch.cash, [{ accountId: "acct-1", delta: -350 }]);
    assert.equal(plan.batch.created, 1);
  });

  test("averages into a position already held", () => {
    const plan = planTrades([row({ quantity: "100", price: "40" })], [], [holding()], 1.37);
    assert.ok(plan.ok);
    const [c] = plan.batch.changes;
    assert.equal(c.shares, 200);
    // 100 at 30 plus 100 at 40.
    assert.equal(c.avgCost, 35);
  });

  test("two buys of the same ticker build on each other rather than overwriting", () => {
    const plan = planTrades(
      [row({ quantity: "10", price: "30" }), row({ quantity: "10", price: "40" })],
      meta,
      [],
      1.37,
    );
    assert.ok(plan.ok);
    assert.equal(plan.batch.changes.length, 1);
    assert.equal(plan.batch.changes[0].shares, 20);
    assert.equal(plan.batch.changes[0].avgCost, 35);
  });

  test("one ticker in two accounts is two positions", () => {
    const plan = planTrades(
      [row(), row({ accountId: "acct-2" })],
      meta,
      [holding()],
      1.37,
    );
    assert.ok(plan.ok);
    assert.equal(plan.batch.changes.length, 2);
  });

  test("a US trade uses the CAD amount the export carried, not today's rate", () => {
    const plan = planTrades(
      [row({ currency: "USD", price: "100", quantity: "2", cadAmount: "250" })],
      meta,
      [],
      1.37,
    );
    assert.ok(plan.ok);
    assert.equal(plan.batch.changes[0].avgCost, 125);
    assert.deepEqual(plan.batch.cash, [{ accountId: "acct-1", delta: -250 }]);
  });

  test("a zero price is refused", () => {
    const plan = planTrades([row({ price: "0" })], meta, [], 1.37);
    assert.equal(plan.ok, false);
  });
});

describe("planTrades: selling", () => {
  test("reduces the position and returns the cash", () => {
    const plan = planTrades(
      [row({ action: "sell", quantity: "40", price: "36" })],
      [],
      [holding()],
      1.37,
    );
    assert.ok(plan.ok);
    assert.equal(plan.batch.changes[0].shares, 60);
    assert.deepEqual(plan.batch.cash, [{ accountId: "acct-1", delta: 1440 }]);
  });

  test("selling more than is held fails the whole batch", () => {
    const plan = planTrades(
      [row({ action: "sell", quantity: "500", price: "36" })],
      [],
      [holding()],
      1.37,
    );
    assert.equal(plan.ok, false);
  });

  test("selling what is not held fails", () => {
    const plan = planTrades([row({ action: "sell" })], [], [], 1.37);
    assert.equal(plan.ok, false);
  });

  test("a buy and a sell in one account net to a single cash movement", () => {
    const plan = planTrades(
      [
        row({ quantity: "10", price: "30" }),
        row({ action: "sell", quantity: "10", price: "50" }),
      ],
      [],
      [holding()],
      1.37,
    );
    assert.ok(plan.ok);
    assert.equal(plan.batch.cash.length, 1);
    assert.equal(plan.batch.cash[0].delta, 200);
  });
});

describe("planTrades: dividends and rewards", () => {
  test("a dividend credits cash without moving shares", () => {
    const plan = planTrades(
      [row({ action: "dividend", price: "18.44", quantity: "1" })],
      [],
      [holding()],
      1.37,
    );
    assert.ok(plan.ok);
    assert.equal(plan.batch.changes[0].shares, 100);
    assert.equal(plan.batch.changes[0].dividendsReceived, 18.44);
    assert.deepEqual(plan.batch.cash, [{ accountId: "acct-1", delta: 18.44 }]);
  });

  test("a dividend on a position not held is refused", () => {
    const plan = planTrades(
      [row({ action: "dividend", price: "10" })],
      meta,
      [],
      1.37,
    );
    assert.equal(plan.ok, false);
  });

  test("a staking reward adds units and moves no cash", () => {
    const plan = planTrades(
      [row({ action: "reward", ticker: "SOL", quantity: "2", price: "150" })],
      [{ ticker: "SOL", name: "Solana", assetClass: "Crypto" }],
      [],
      1.37,
    );
    assert.ok(plan.ok);
    assert.equal(plan.batch.changes[0].shares, 2);
    assert.equal(plan.batch.changes[0].avgCost, 150);
    assert.deepEqual(plan.batch.cash, []);
  });

  test("a reward with no price yet records the units and stays flagged", () => {
    const plan = planTrades(
      [row({ action: "reward", ticker: "SOL", quantity: "2", price: "" })],
      [{ ticker: "SOL", name: "Solana", assetClass: "Crypto" }],
      [],
      1.37,
    );
    assert.ok(plan.ok);
    assert.equal(plan.batch.changes[0].shares, 2);
    assert.ok(plan.batch.changes[0].flows.some((f) => f.awaitingPrice));
  });
});

describe("planTrades: the batch is all or nothing", () => {
  test("one bad row plans nothing at all", () => {
    const plan = planTrades(
      [row(), row({ action: "sell", ticker: "NOPE", quantity: "1", price: "1" })],
      meta,
      [],
      1.37,
    );
    assert.equal(plan.ok, false);
    // No cash moved and no position opened for the row that was fine.
    assert.ok(!("batch" in plan));
  });

  test("an empty batch is refused rather than silently doing nothing", () => {
    assert.equal(planTrades([], [], [], 1.37).ok, false);
  });

  test("a ticker with no identity and no sibling cannot be opened", () => {
    const plan = planTrades([row()], [], [], 1.37);
    assert.equal(plan.ok, false);
  });

  test("a ticker held in another account borrows that identity", () => {
    const plan = planTrades(
      [row({ accountId: "acct-2" })],
      [],
      [holding({ name: "iShares All-Equity", assetClass: "Intl Equity" })],
      1.37,
    );
    assert.ok(plan.ok);
    const opened = plan.batch.changes.find((c) => c.accountId === "acct-2")!;
    assert.equal(opened.name, "iShares All-Equity");
    assert.equal(opened.assetClass, "Intl Equity");
  });

  test("blank trailing rows are ignored", () => {
    const plan = planTrades(
      [row(), row({ ticker: "", quantity: "", price: "", cadAmount: "" })],
      meta,
      [],
      1.37,
    );
    assert.ok(plan.ok);
    assert.equal(plan.batch.trades, 1);
  });
});
