import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { milestones, yearRows } from "./year";
import type { NetWorthPoint, PortfolioPoint } from "./analytics";
import type { Transaction } from "./types";

const nw = (key: string, net: number) =>
  ({ key, label: key, assets: 0, liabilities: 0, portfolio: 0, pension: 0, net }) as NetWorthPoint;
const port = (key: string, value: number, cost: number) =>
  ({ key, label: key, value, cost }) as PortfolioPoint;
const txn = (date: string, type: "income" | "expense", amount: number, category = "Groceries") =>
  ({ id: date + amount, date, type, amount, category, payee: "x" }) as unknown as Transaction;

describe("yearRows", () => {
  const netWorth = [
    nw("2024-06", 10000),
    nw("2024-12", 20000),
    nw("2025-06", 30000),
    nw("2025-12", 40000),
  ];
  const portfolio = [
    port("2024-06", 5000, 4000),
    port("2024-12", 12000, 9000),
    port("2025-06", 18000, 14000),
    port("2025-12", 26000, 20000),
  ];
  const transactions = [
    txn("2024-03-01", "income", 40000, "Salary"),
    txn("2024-05-01", "expense", 25000),
    txn("2025-03-01", "income", 50000, "Salary"),
    txn("2025-05-01", "expense", 30000),
  ];
  const rows = yearRows(transactions, netWorth, portfolio, { "2025-04": 3000 }, "2026-08-31");

  test("newest year first", () => {
    assert.deepEqual(rows.map((r) => r.year), ["2025", "2024"]);
  });

  test("net worth is taken at the end of the year, and the change with it", () => {
    const [y2025, y2024] = rows;
    assert.equal(y2025.netWorth, 40000);
    assert.equal(y2024.netWorth, 20000);
    assert.equal(y2025.netWorthChange, 20000);
    assert.equal(y2024.netWorthChange, null, "nothing before it to compare with");
  });

  test("income, spending and what was kept", () => {
    const [y2025] = rows;
    assert.equal(y2025.income, 50000);
    assert.equal(y2025.expenses, 30000);
    assert.equal(y2025.netCashflow, 20000);
    assert.equal(y2025.savingsRate, 40);
  });

  test("spending growth is measured against the year before", () => {
    const [y2025, y2024] = rows;
    assert.equal(y2025.expenseGrowth, 20, "30,000 against 25,000");
    assert.equal(y2024.expenseGrowth, null);
  });

  test("the portfolio's cost and profit come from the year's last month", () => {
    const [y2025] = rows;
    assert.equal(y2025.portfolio, 26000);
    assert.equal(y2025.costBasis, 20000);
    assert.equal(y2025.investmentProfit, 6000);
  });

  test("money put in that year is summed from its months alone", () => {
    const [y2025, y2024] = rows;
    assert.equal(y2025.investmentFlows, 3000);
    assert.equal(y2024.investmentFlows, 0);
  });

  test("the year still running is marked as such", () => {
    const running = yearRows(transactions, netWorth, portfolio, {}, "2025-07-15");
    assert.equal(running[0].year, "2025");
    assert.equal(running[0].complete, false);
    assert.equal(running[1].complete, true);
  });

  test("a year with money but no balances on record is still a year", () => {
    const rows = yearRows([txn("2019-01-01", "expense", 100)], netWorth, portfolio, {}, "2026-01-01");
    assert.equal(rows[rows.length - 1].year, "2019");
    assert.equal(rows[rows.length - 1].netWorth, 0);
  });

  test("CAGR compounds from the first year with a positive net worth", () => {
    const [y2025] = rows;
    // 20,000 to 40,000 in one year.
    assert.equal(Math.round(y2025.cagr ?? 0), 100);
    assert.equal(rows[1].cagr, null, "the base year has nothing to compound from");
  });

  test("no income is no savings rate, rather than a rate of zero", () => {
    const rows = yearRows([txn("2025-05-01", "expense", 500)], netWorth, portfolio, {}, "2026-01-01");
    assert.equal(rows.find((r) => r.year === "2025")?.savingsRate, null);
  });
});

describe("milestones", () => {
  const points = [
    { key: "2024-01", net: 10000 },
    { key: "2024-06", net: 60000 },
    { key: "2024-12", net: 90000 },
    { key: "2025-06", net: 210000 },
    { key: "2025-12", net: 120000 },
  ];

  test("the first month each step was passed", () => {
    const found = milestones(points);
    assert.deepEqual(
      found.map((m) => `${m.amount}@${m.month}`),
      ["50000@2024-06", "100000@2025-06", "150000@2025-06", "200000@2025-06"],
    );
  });

  test("several steps crossed at once each get their month", () => {
    // A jump from 90,000 to 210,000 passes three.
    assert.equal(milestones(points).filter((m) => m.month === "2025-06").length, 3);
  });

  test("how long each step took", () => {
    const [first, second] = milestones(points);
    assert.equal(first.monthsFromPrevious, null);
    assert.equal(second.monthsFromPrevious, 12, "June 2024 to June 2025");
  });

  test("falling back below does not un-reach a milestone", () => {
    const found = milestones(points);
    assert.equal(found[found.length - 1].amount, 200000);
  });

  test("a step size of your choosing", () => {
    assert.equal(milestones(points, 100000)[0].amount, 100000);
  });

  test("nothing reached is no milestones", () => {
    assert.deepEqual(milestones([{ key: "2024-01", net: 400 }]), []);
  });
});
