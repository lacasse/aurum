import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  allTimeSeries,
  budgetRows,
  cashflowSeries,
  consolidateHoldings,
  firstFlowMonth,
  monthsSince,
  replayFlows,
  sortHoldingRows,
  monthTotals,
  spendByCategory,
} from "./analytics";
import { currentMonthKey } from "./format";
import type { Budget, Holding, Transaction } from "./types";

const MONTH = currentMonthKey();
const DAY = `${MONTH}-05`;

function txn(over: Partial<Transaction> & Pick<Transaction, "amount" | "type">): Transaction {
  return {
    id: Math.random().toString(36).slice(2),
    date: DAY,
    category: "Groceries",
    sourceAccountId: "a1",
    payee: "Market",
    ...over,
  };
}

describe("monthTotals", () => {
  test("totals income and expenses without floating-point drift", () => {
    // Ten 0.10 expenses sum to exactly 1.00; naive accumulation does not.
    const transactions = Array.from({ length: 10 }, () => txn({ amount: 0.1, type: "expense" }));
    const totals = monthTotals(transactions, MONTH);
    assert.equal(totals.expenses, 1);
    assert.equal(totals.income, 0);
    assert.equal(totals.net, -1);
  });

  test("nets income against expenses exactly", () => {
    const totals = monthTotals(
      [txn({ amount: 0.3, type: "income" }), txn({ amount: 0.1, type: "expense" })],
      MONTH,
    );
    assert.equal(totals.net, 0.2);
    assert.notEqual(0.3 - 0.1, 0.2, "precondition: float subtraction drifts");
  });

  test("ignores transactions outside the requested month", () => {
    const totals = monthTotals(
      [txn({ amount: 100, type: "income", date: "1999-01-01" })],
      MONTH,
    );
    assert.equal(totals.income, 0);
    assert.equal(totals.savingsRate, 0);
  });

  test("computes a savings rate", () => {
    const totals = monthTotals(
      [txn({ amount: 100, type: "income" }), txn({ amount: 25, type: "expense" })],
      MONTH,
    );
    assert.equal(totals.savingsRate, 75);
  });
});

describe("spendByCategory", () => {
  test("groups expenses exactly and sorts by size", () => {
    const rows = spendByCategory(
      [
        txn({ amount: 0.1, type: "expense", category: "Dining" }),
        txn({ amount: 0.2, type: "expense", category: "Dining" }),
        txn({ amount: 5, type: "expense", category: "Transport" }),
        txn({ amount: 999, type: "income", category: "Salary" }),
      ],
      MONTH,
    );
    assert.deepEqual(rows, [
      { name: "Transport", value: 5 },
      { name: "Dining", value: 0.3 },
    ]);
  });
});

describe("cashflowSeries", () => {
  test("places totals in the right month and nets them exactly", () => {
    const series = cashflowSeries(
      [txn({ amount: 0.1, type: "expense" }), txn({ amount: 0.3, type: "income" })],
      12,
    );
    const current = series.find((p) => p.key === MONTH);
    assert.ok(current, "current month is present in the series");
    assert.equal(current.income, 0.3);
    assert.equal(current.expenses, 0.1);
    assert.equal(current.net, 0.2);
  });
});

describe("budgetRows", () => {
  test("computes spend and remaining exactly", () => {
    const budgets: Budget[] = [{ category: "Groceries", limit: 1 }];
    const transactions = Array.from({ length: 3 }, () =>
      txn({ amount: 0.1, type: "expense", category: "Groceries" }),
    );
    const [row] = budgetRows(budgets, transactions, MONTH);
    assert.equal(row.spent, 0.3);
    assert.equal(row.remaining, 0.7);

    let naive = 0;
    for (const t of transactions) naive += t.amount;
    assert.notEqual(naive, 0.3, "precondition: naive accumulation drifts");
  });

  test("ignores other categories and other months", () => {
    const budgets: Budget[] = [{ category: "Groceries", limit: 100 }];
    const [row] = budgetRows(
      budgets,
      [
        txn({ amount: 10, type: "expense", category: "Dining" }),
        txn({ amount: 10, type: "expense", category: "Groceries", date: "1999-01-01" }),
      ],
      MONTH,
    );
    assert.equal(row.spent, 0);
    assert.equal(row.remaining, 100);
    assert.equal(row.pct, 0);
  });
});

describe("consolidateHoldings", () => {
  const lot = (over: Partial<Holding>): Holding =>
    ({
      id: "h",
      ticker: "XEQT",
      name: "XEQT",
      assetClass: "US Equity",
      sector: "Other",
      shares: 10,
      avgCost: 30,
      price: 40,
      history: [38, 40],
      dividendsReceived: 0,
      accountId: "acc-tfsa",
      currency: "CAD",
      priceCAD: 40,
      avgCostCAD: 30,
      dividendsReceivedCAD: 0,
      historyCAD: [38, 40],
      flows: [],
      ...over,
    }) as Holding;

  test("a ticker held in two accounts appears once, tagged with both", () => {
    const rows = consolidateHoldings([
      lot({ id: "a", accountId: "acc-tfsa" }),
      lot({ id: "b", accountId: "acc-rrsp" }),
    ]);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].accountIds, ["acc-tfsa", "acc-rrsp"]);
    assert.equal(rows[0].lots.length, 2, "the per-account detail is kept");
  });

  test("shares, cost and dividends are the combined totals", () => {
    const rows = consolidateHoldings([
      lot({ id: "a", shares: 10, avgCostCAD: 30, dividendsReceivedCAD: 5 }),
      lot({ id: "b", accountId: "acc-rrsp", shares: 30, avgCostCAD: 50, dividendsReceivedCAD: 7 }),
    ]);
    const [r] = rows;
    assert.equal(r.shares, 40);
    assert.equal(r.costBasis, 10 * 30 + 30 * 50);
    assert.equal(r.avgCostCAD, 45, "share-weighted, not the mean of 30 and 50");
    assert.equal(r.marketValue, 40 * 40);
    assert.equal(r.totalDividends, 12);
    assert.equal(r.gain, 1600 - 1800);
    assert.equal(r.totalReturn, -200 + 12);
  });

  test("MWRR reflects the pooled position, not one account's", () => {
    const pooled = consolidateHoldings([
      lot({ id: "a", shares: 10, avgCostCAD: 20 }),
      lot({ id: "b", accountId: "acc-rrsp", shares: 10, avgCostCAD: 60 }),
    ])[0];
    // Pooled basis 800 against 800 of value is a flat return, even though one
    // account doubled and the other lost a third.
    assert.equal(pooled.costBasis, 800);
    assert.equal(pooled.marketValue, 800);
    assert.equal(pooled.mwrr, null, "no flows means no measurable return");
  });

  test("weights are shares of the whole portfolio and sum to 100", () => {
    const rows = consolidateHoldings([
      lot({ id: "a", ticker: "XEQT", shares: 10 }),
      lot({ id: "b", ticker: "XEQT", accountId: "acc-rrsp", shares: 10 }),
      lot({ id: "c", ticker: "VFV", shares: 20 }),
    ]);
    assert.equal(rows.length, 2);
    assert.equal(Math.round(rows.reduce((s, r) => s + r.weightPct, 0)), 100);
  });

  test("differing case in the ticker is still one security", () => {
    const rows = consolidateHoldings([
      lot({ id: "a", ticker: "xeqt" }),
      lot({ id: "b", ticker: "XEQT", accountId: "acc-rrsp" }),
    ]);
    assert.equal(rows.length, 1);
  });

  test("an unpriced lot does not drag the price to zero", () => {
    const rows = consolidateHoldings([
      lot({ id: "a", priceCAD: 0, price: 0 }),
      lot({ id: "b", accountId: "acc-rrsp", priceCAD: 40 }),
    ]);
    assert.equal(rows[0].priceCAD, 40);
  });
});

describe("sortHoldingRows", () => {
  const lot = (over: Partial<Holding>): Holding =>
    ({
      id: "h",
      ticker: "XEQT",
      name: "iShares Core Equity ETF",
      assetClass: "US Equity",
      sector: "Other",
      shares: 10,
      avgCost: 30,
      price: 40,
      history: [38, 40],
      dividendsReceived: 0,
      accountId: "acc-tfsa",
      currency: "CAD",
      priceCAD: 40,
      avgCostCAD: 30,
      dividendsReceivedCAD: 0,
      historyCAD: [38, 40],
      flows: [],
      ...over,
    }) as Holding;

  const rows = consolidateHoldings([
    lot({ id: "a", ticker: "AAA", name: "Zulu Corp", shares: 1, priceCAD: 500 }),
    lot({ id: "b", ticker: "BBB", name: "Alpha Inc", shares: 10, priceCAD: 10 }),
    lot({ id: "c", ticker: "CCC", name: "Midway Ltd", shares: 5, priceCAD: 40 }),
  ]);

  test("sorts by value in both directions", () => {
    assert.deepEqual(
      sortHoldingRows(rows, "marketValue", "desc").map((r) => r.ticker),
      ["AAA", "CCC", "BBB"],
    );
    assert.deepEqual(
      sortHoldingRows(rows, "marketValue", "asc").map((r) => r.ticker),
      ["BBB", "CCC", "AAA"],
    );
  });

  test("the position column sorts on the name, which is what it now leads with", () => {
    assert.deepEqual(
      sortHoldingRows(rows, "name", "asc").map((r) => r.name),
      ["Alpha Inc", "Midway Ltd", "Zulu Corp"],
    );
  });

  test("sorts by the other numeric columns", () => {
    assert.deepEqual(
      sortHoldingRows(rows, "shares", "desc").map((r) => r.ticker),
      ["BBB", "CCC", "AAA"],
    );
    assert.deepEqual(
      sortHoldingRows(rows, "priceCAD", "desc").map((r) => r.ticker),
      ["AAA", "CCC", "BBB"],
    );
  });

  test("ties break on value, so the order never wobbles between renders", () => {
    const tied = consolidateHoldings([
      lot({ id: "a", ticker: "AAA", shares: 1, priceCAD: 10, dividendsReceivedCAD: 0 }),
      lot({ id: "b", ticker: "BBB", shares: 1, priceCAD: 90, dividendsReceivedCAD: 0 }),
    ]);
    const once = sortHoldingRows(tied, "totalDividends", "desc").map((r) => r.ticker);
    const twice = sortHoldingRows(tied, "totalDividends", "desc").map((r) => r.ticker);
    assert.deepEqual(once, ["BBB", "AAA"], "the larger position leads");
    assert.deepEqual(once, twice);
  });

  test("does not mutate the rows it was given", () => {
    const before = rows.map((r) => r.ticker);
    sortHoldingRows(rows, "name", "asc");
    assert.deepEqual(rows.map((r) => r.ticker), before);
  });
});

describe("closed positions", () => {
  const lot = (over: Partial<Holding>): Holding =>
    ({
      id: "h",
      ticker: "XEQT",
      name: "iShares Core Equity ETF",
      assetClass: "US Equity",
      sector: "Other",
      shares: 10,
      avgCost: 30,
      price: 40,
      history: [38, 40],
      dividendsReceived: 0,
      accountId: "acc-tfsa",
      currency: "CAD",
      priceCAD: 40,
      avgCostCAD: 30,
      dividendsReceivedCAD: 0,
      historyCAD: [38, 40],
      flows: [],
      ...over,
    }) as Holding;

  test("a fully-sold position is marked closed, not dropped", () => {
    // Kept on purpose: the cost basis and dividends are the record of a
    // realized gain, which still matters at tax time.
    const [row] = consolidateHoldings([
      lot({ shares: 0, dividendsReceivedCAD: 120 }),
    ]);
    assert.equal(row.closed, true);
    assert.equal(row.totalDividends, 120, "the dividend record survives");
    assert.equal(row.marketValue, 0);
  });

  test("a position with shares is not closed", () => {
    assert.equal(consolidateHoldings([lot({ shares: 10 })])[0].closed, false);
  });

  test("selling out of one account does not close a position held elsewhere", () => {
    const [row] = consolidateHoldings([
      lot({ id: "a", accountId: "acc-tfsa", shares: 0 }),
      lot({ id: "b", accountId: "acc-rrsp", shares: 5 }),
    ]);
    assert.equal(row.closed, false);
    assert.equal(row.shares, 5);
    assert.deepEqual(row.accountIds, ["acc-rrsp"], "the emptied account stops being tagged");
    assert.equal(row.lots.length, 2, "both lots are still available as detail");
  });

  test("a wholly closed position keeps its account tags for the record", () => {
    const [row] = consolidateHoldings([
      lot({ id: "a", accountId: "acc-tfsa", shares: 0 }),
      lot({ id: "b", accountId: "acc-rrsp", shares: 0 }),
    ]);
    assert.equal(row.closed, true);
    assert.deepEqual(row.accountIds, ["acc-tfsa", "acc-rrsp"]);
  });
});

describe("replayFlows", () => {
  test("a straight buy leaves cost and no realized gain", () => {
    const r = replayFlows([{ date: "2025-01-01", kind: "buy", amount: 300, shares: 10 }]);
    assert.equal(r.shares, 10);
    assert.equal(r.costCAD, 300);
    assert.equal(r.realizedGainCAD, 0, "nothing sold, nothing realized");
  });

  test("a partial sale realizes the gain on the shares that left", () => {
    // Bought 10 at 30. Sold 4 for 200, which had cost 120.
    const r = replayFlows([
      { date: "2025-01-01", kind: "buy", amount: 300, shares: 10 },
      { date: "2025-06-01", kind: "sell", amount: 200, shares: -4 },
    ]);
    assert.equal(r.shares, 6);
    assert.equal(r.realizedGainCAD, 80, "200 proceeds less 120 of cost");
    assert.equal(r.costCAD, 180, "the remaining six still cost 30 each");
  });

  test("a full sale realizes everything and leaves no basis", () => {
    const r = replayFlows([
      { date: "2025-01-01", kind: "buy", amount: 300, shares: 10 },
      { date: "2025-06-01", kind: "sell", amount: 500, shares: -10 },
    ]);
    assert.equal(r.shares, 0);
    assert.equal(r.costCAD, 0);
    assert.equal(r.realizedGainCAD, 200);
  });

  test("a realized loss is negative", () => {
    const r = replayFlows([
      { date: "2025-01-01", kind: "buy", amount: 300, shares: 10 },
      { date: "2025-06-01", kind: "sell", amount: 100, shares: -10 },
    ]);
    assert.equal(r.realizedGainCAD, -200);
  });

  test("buys at different prices are disposed of at the average", () => {
    const r = replayFlows([
      { date: "2025-01-01", kind: "buy", amount: 100, shares: 10 },
      { date: "2025-02-01", kind: "buy", amount: 300, shares: 10 },
      { date: "2025-06-01", kind: "sell", amount: 250, shares: -10 },
    ]);
    // Average cost is 20; ten shares cost 200 and fetched 250.
    assert.equal(r.realizedGainCAD, 50);
    assert.equal(r.costCAD, 200, "the remaining ten keep the same average");
  });

  test("dividends accumulate without touching the basis", () => {
    const r = replayFlows([
      { date: "2025-01-01", kind: "buy", amount: 300, shares: 10 },
      { date: "2025-03-01", kind: "dividend", amount: 12, shares: 0 },
    ]);
    assert.equal(r.dividendsCAD, 12);
    assert.equal(r.costCAD, 300);
    assert.equal(r.realizedGainCAD, 0);
  });

  test("flows out of order are replayed chronologically", () => {
    const r = replayFlows([
      { date: "2025-06-01", kind: "sell", amount: 200, shares: -4 },
      { date: "2025-01-01", kind: "buy", amount: 300, shares: 10 },
    ]);
    assert.equal(r.shares, 6, "the sale cannot be applied before the purchase");
    assert.equal(r.realizedGainCAD, 80);
  });

  test("no flows means nothing, not a crash", () => {
    assert.deepEqual(replayFlows([]), {
      shares: 0,
      costCAD: 0,
      realizedGainCAD: 0,
      dividendsCAD: 0,
    });
  });
});

describe("realized gain and MWRR on a row", () => {
  const withFlows = (over: Partial<Holding>): Holding =>
    ({
      id: "h",
      ticker: "XEQT",
      name: "XEQT",
      assetClass: "US Equity",
      sector: "Other",
      shares: 0,
      avgCost: 0,
      price: 40,
      history: [40],
      dividendsReceived: 0,
      accountId: "acc-tfsa",
      currency: "CAD",
      priceCAD: 40,
      avgCostCAD: 0,
      dividendsReceivedCAD: 0,
      historyCAD: [40],
      flows: [],
      ...over,
    }) as Holding;

  test("a closed position reports what it actually made", () => {
    // Previously this showed a gain of zero: proceeds were discarded, so
    // every closed position looked like it had made nothing.
    const [row] = consolidateHoldings(
      [
        withFlows({
          shares: 0,
          dividendsReceivedCAD: 20,
          flows: [
            { date: "2024-01-01", kind: "buy", amount: 1000, shares: 50 },
            { date: "2024-07-01", kind: "dividend", amount: 20, shares: 0 },
            { date: "2025-01-01", kind: "sell", amount: 1400, shares: -50 },
          ],
        }),
      ],
      "2026-01-01",
    );
    assert.equal(row.gain, 0, "nothing is still held, so nothing is unrealized");
    assert.equal(row.realizedGain, 400, "1400 out against 1000 of cost");
    assert.equal(row.totalReturn, 420, "realized plus dividends");
  });

  test("MWRR reflects the actual holding period, not a fixed window", () => {
    const [row] = consolidateHoldings(
      [
        withFlows({
          shares: 0,
          flows: [
            { date: "2025-01-01", kind: "buy", amount: 100, shares: 10 },
            { date: "2026-01-01", kind: "sell", amount: 200, shares: -10 },
          ],
        }),
      ],
      "2026-01-01",
    );
    assert.ok(
      row.mwrr !== null && Math.abs(row.mwrr - 100) < 0.5,
      `doubling over exactly one year is ~100%, got ${row.mwrr}`,
    );
  });

  test("a position with no trade history has no MWRR rather than zero", () => {
    const [row] = consolidateHoldings([withFlows({ shares: 10, avgCostCAD: 30 })], "2026-01-01");
    assert.equal(row.mwrr, null);
    assert.equal(row.realizedGain, 0);
  });

  test("realized gain pools across accounts", () => {
    const [row] = consolidateHoldings(
      [
        withFlows({
          id: "a",
          accountId: "acc-tfsa",
          flows: [
            { date: "2024-01-01", kind: "buy", amount: 100, shares: 10 },
            { date: "2025-01-01", kind: "sell", amount: 150, shares: -10 },
          ],
        }),
        withFlows({
          id: "b",
          accountId: "acc-rrsp",
          flows: [
            { date: "2024-01-01", kind: "buy", amount: 100, shares: 10 },
            { date: "2025-01-01", kind: "sell", amount: 60, shares: -10 },
          ],
        }),
      ],
      "2026-01-01",
    );
    assert.equal(row.realizedGain, 10, "+50 in one account, -40 in the other");
  });
});

describe("allTimeSeries", () => {
  const lot = (over: Partial<Holding>): Holding =>
    ({
      id: "h",
      ticker: "AAA",
      name: "AAA",
      assetClass: "US Equity",
      sector: "Other",
      shares: 0,
      avgCost: 0,
      price: 0,
      history: [],
      dividendsReceived: 0,
      accountId: "acc",
      currency: "CAD",
      priceCAD: 0,
      avgCostCAD: 0,
      dividendsReceivedCAD: 0,
      historyCAD: [],
      flows: [],
      ...over,
    }) as Holding;

  const MONTHS = ["2024-01", "2024-02", "2024-03", "2024-04"];

  test("the first trade sets where the series can start", () => {
    const holdings = [
      lot({ flows: [{ date: "2023-07-14", kind: "buy", amount: 100, shares: 1 }] }),
      lot({ id: "b", flows: [{ date: "2022-11-02", kind: "buy", amount: 50, shares: 1 }] }),
    ];
    assert.equal(firstFlowMonth(holdings), "2022-11");
    assert.equal(firstFlowMonth([lot({})]), null, "nothing recorded, nothing to plot");
  });

  test("monthsSince spans both ends inclusively", () => {
    assert.deepEqual(monthsSince("2024-01", "2024-04"), MONTHS);
    assert.deepEqual(monthsSince("2024-04", "2024-04"), ["2024-04"]);
  });

  test("values the shares actually held that month, not today's", () => {
    const holdings = [
      lot({
        shares: 10,
        flows: [
          { date: "2024-02-10", kind: "buy", amount: 200, shares: 10 },
        ],
      }),
    ];
    const closes = { AAA: { "2024-01": 15, "2024-02": 20, "2024-03": 25, "2024-04": 30 } };
    const { points } = allTimeSeries(holdings, closes, MONTHS);
    assert.equal(points[0].value, 0, "not yet bought");
    assert.equal(points[1].value, 200);
    assert.equal(points[3].value, 300);
    assert.deepEqual(
      points.map((p) => p.cost),
      [0, 200, 200, 200],
      "cost appears when it was paid and stays put",
    );
  });

  test("a sale removes its share of the basis and stops the valuation", () => {
    const holdings = [
      lot({
        flows: [
          { date: "2024-01-05", kind: "buy", amount: 400, shares: 20 },
          { date: "2024-03-05", kind: "sell", amount: 600, shares: -20 },
        ],
      }),
    ];
    const closes = { AAA: { "2024-01": 20, "2024-02": 25, "2024-03": 30, "2024-04": 35 } };
    const { points } = allTimeSeries(holdings, closes, MONTHS);
    assert.deepEqual(points.map((p) => p.value), [400, 500, 0, 0]);
    assert.deepEqual(points.map((p) => p.cost), [400, 400, 0, 0]);
  });

  test("a dividend changes neither the shares nor the cost", () => {
    const holdings = [
      lot({
        flows: [
          { date: "2024-01-05", kind: "buy", amount: 100, shares: 10 },
          { date: "2024-02-05", kind: "dividend", amount: 9, shares: 0 },
        ],
      }),
    ];
    const closes = { AAA: { "2024-01": 10, "2024-02": 10, "2024-03": 10, "2024-04": 10 } };
    const { points } = allTimeSeries(holdings, closes, MONTHS);
    assert.deepEqual(points.map((p) => p.value), [100, 100, 100, 100]);
    assert.deepEqual(points.map((p) => p.cost), [100, 100, 100, 100]);
  });

  test("a gap in the price series carries the nearest close, not a zero", () => {
    const holdings = [
      lot({ flows: [{ date: "2024-01-05", kind: "buy", amount: 100, shares: 10 }] }),
    ];
    // Only February is known: January carries it back, March and April forward.
    const { points } = allTimeSeries(holdings, { AAA: { "2024-02": 12 } }, MONTHS);
    assert.deepEqual(points.map((p) => p.value), [120, 120, 120, 120]);
  });

  test("a ticker with no prices at all falls back to book cost and says so", () => {
    const holdings = [
      lot({ flows: [{ date: "2024-01-05", kind: "buy", amount: 100, shares: 10 }] }),
    ];
    const { points, unpriced } = allTimeSeries(holdings, {}, MONTHS);
    assert.deepEqual(points.map((p) => p.value), [100, 100, 100, 100]);
    assert.deepEqual(unpriced, ["AAA"]);
  });

  test("positions are summed across accounts", () => {
    const flows = [{ date: "2024-01-05", kind: "buy" as const, amount: 100, shares: 10 }];
    const { points } = allTimeSeries(
      [lot({ id: "a", flows }), lot({ id: "b", accountId: "acc2", flows })],
      { AAA: { "2024-01": 10, "2024-02": 11, "2024-03": 12, "2024-04": 13 } },
      MONTHS,
    );
    assert.deepEqual(points.map((p) => p.value), [200, 220, 240, 260]);
  });
});
