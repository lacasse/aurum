import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { disposals, isSheltered, taxYears } from "./tax";
import type { Account, CashFlow, Holding } from "./types";

const account = (id: string, name: string, registration?: string) =>
  ({ id, name, kind: "investment", balance: 0, history: [], registration }) as unknown as Account;

const holding = (id: string, ticker: string, accountId: string, flows: CashFlow[]) =>
  ({ id, ticker, name: ticker, accountId, flows, assetClass: "US Equity" }) as unknown as Holding;

const nonReg = account("a1", "Non-registered", "non-registered");
const tfsa = account("a2", "TFSA", "TFSA");

describe("isSheltered", () => {
  test("registered accounts are", () => {
    for (const r of ["TFSA", "RRSP", "FHSA", "Pension"]) {
      assert.equal(isSheltered(r as never), true, r);
    }
  });

  test("a non-registered account, and one with no registration at all, are not", () => {
    assert.equal(isSheltered("non-registered"), false);
    assert.equal(isSheltered(undefined), false);
  });
});

describe("disposals", () => {
  const flows: CashFlow[] = [
    { date: "2024-01-10", kind: "buy", amount: 1000, shares: 100 },
    { date: "2024-06-10", kind: "buy", amount: 1400, shares: 100 },
    { date: "2025-03-01", kind: "sell", amount: 1500, shares: -100 },
  ];

  test("a sale disposes of its share of the cost, not of what it cost that day", () => {
    // Average cost: 200 units cost 2,400, so 100 of them cost 1,200.
    const [d] = disposals([holding("h", "ABC", "a1", flows)], [nonReg]);
    assert.equal(d.acb, 1200);
    assert.equal(d.proceeds, 1500);
    assert.equal(d.gain, 300);
    assert.equal(d.year, "2025");
  });

  test("what is left keeps the same average, so a second sale is not double-counted", () => {
    const twice = [
      ...flows,
      { date: "2025-09-01", kind: "sell", amount: 1300, shares: -100 } as CashFlow,
    ];
    const [, second] = disposals([holding("h", "ABC", "a1", twice)], [nonReg]);
    assert.equal(second.acb, 1200);
    assert.equal(second.gain, 100);
  });

  test("a loss is a negative gain, not an absent one", () => {
    const losing: CashFlow[] = [
      { date: "2024-01-10", kind: "buy", amount: 1000, shares: 100 },
      { date: "2025-01-10", kind: "sell", amount: 600, shares: -100 },
    ];
    assert.equal(disposals([holding("h", "ABC", "a1", losing)], [nonReg])[0].gain, -400);
  });

  test("the account's registration travels with the disposal", () => {
    const rows = disposals(
      [holding("h1", "ABC", "a1", flows), holding("h2", "ABC", "a2", flows)],
      [nonReg, tfsa],
    );
    assert.equal(rows.filter((d) => d.sheltered).length, 1);
    assert.equal(rows.find((d) => d.sheltered)?.accountName, "TFSA");
  });

  test("a position never sold produces nothing", () => {
    const open: CashFlow[] = [{ date: "2024-01-10", kind: "buy", amount: 1000, shares: 100 }];
    assert.deepEqual(disposals([holding("h", "ABC", "a1", open)], [nonReg]), []);
  });
});

describe("taxYears", () => {
  const taxableFlows: CashFlow[] = [
    { date: "2024-01-10", kind: "buy", amount: 1000, shares: 100 },
    { date: "2025-03-01", kind: "sell", amount: 1500, shares: -100 },
    { date: "2025-06-30", kind: "dividend", amount: 40, shares: 0 },
  ];
  const shelteredFlows: CashFlow[] = [
    { date: "2024-01-10", kind: "buy", amount: 2000, shares: 100 },
    { date: "2025-05-01", kind: "sell", amount: 5000, shares: -100 },
    { date: "2025-06-30", kind: "dividend", amount: 90, shares: 0 },
  ];
  const holdings = [
    holding("h1", "ABC", "a1", taxableFlows),
    holding("h2", "XYZ", "a2", shelteredFlows),
  ];
  const transactions = [
    { date: "2025-02-28", type: "income", amount: 12.5, category: "Interest" },
    { date: "2025-04-30", type: "income", amount: 7.5, category: "Interest" },
    { date: "2025-04-30", type: "income", amount: 4000, category: "Salary" },
    { date: "2024-04-30", type: "income", amount: 5, category: "Interest" },
  ];

  test("a gain inside a TFSA is never added to the taxable one", () => {
    const [y] = taxYears(holdings, [nonReg, tfsa], transactions);
    assert.equal(y.year, "2025");
    assert.equal(y.gain, 500, "the non-registered sale only");
    assert.equal(y.shelteredGain, 3000);
    assert.equal(y.shelteredCount, 1);
    assert.equal(y.taxable.length, 1);
  });

  test("dividends are split the same way", () => {
    const [y] = taxYears(holdings, [nonReg, tfsa], transactions);
    assert.equal(y.dividends, 40);
    assert.equal(y.shelteredDividends, 90);
  });

  test("interest comes from the transactions that recorded it", () => {
    const [y2025, y2024] = taxYears(holdings, [nonReg, tfsa], transactions);
    assert.equal(y2025.interest, 20, "and not the salary");
    assert.equal(y2024.interest, 5);
  });

  test("proceeds and cost base are reported beside the gain", () => {
    const [y] = taxYears(holdings, [nonReg, tfsa], transactions);
    assert.equal(y.proceeds, 1500);
    assert.equal(y.acb, 1000);
    assert.equal(y.gain, y.proceeds - y.acb);
  });

  test("years come back newest first, and a year with only interest still appears", () => {
    const years = taxYears(holdings, [nonReg, tfsa], transactions);
    assert.deepEqual(years.map((y) => y.year), ["2025", "2024"]);
    assert.equal(years[1].gain, 0);
    assert.equal(years[1].interest, 5);
  });

  test("a sale with no proceeds is flagged, not quietly counted as a loss", () => {
    const givenAway: CashFlow[] = [
      { date: "2024-01-10", kind: "buy", amount: 40000, shares: 1 },
      { date: "2025-02-15", kind: "sell", amount: 0, shares: -1 },
    ];
    const [y] = taxYears([holding("h", "BTC", "a1", givenAway)], [nonReg], []);
    assert.equal(y.unpriced.length, 1);
    assert.equal(y.unpriced[0].gain, -40000);
    // Still counted: leaving it out would invent a different wrong number.
    assert.equal(y.gain, -40000);
  });

  test("a sale that did have proceeds is not flagged", () => {
    const [y] = taxYears(holdings, [nonReg, tfsa], transactions);
    assert.deepEqual(y.unpriced, []);
  });

  test("nothing recorded is no years, rather than a year of zeroes", () => {
    assert.deepEqual(taxYears([], [], []), []);
  });
});
