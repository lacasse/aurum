import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  budgetRows,
  cashflowSeries,
  consolidateHoldings,
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
    assert.equal(Math.round(pooled.mwrr), 0);
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
