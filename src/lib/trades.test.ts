import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  accumulatePositions,
  normalizeAccountType,
  parseTradeCsv,
  positionToHolding,
} from "./trades";
import type { Holding, Registration } from "./types";

const ACCOUNTS: Record<Registration, string> = {
  TFSA: "acc-tfsa",
  RRSP: "acc-rrsp",
  FHSA: "acc-fhsa",
  Pension: "acc-pension",
  "non-registered": "acc-taxable",
};
const resolve = (r: Registration) => ACCOUNTS[r] ?? "";

describe("normalizeAccountType", () => {
  test("reads the registrations a brokerage names directly", () => {
    assert.equal(normalizeAccountType("TFSA"), "TFSA");
    assert.equal(normalizeAccountType("rrsp"), "RRSP");
    assert.equal(normalizeAccountType("FHSA"), "FHSA");
    assert.equal(normalizeAccountType("Public Service Pension"), "Pension");
  });

  test("treats 'taxable' as non-registered", () => {
    // The export labels an ordinary account by its tax treatment, not by a
    // registration it does not have.
    assert.equal(normalizeAccountType("Taxable"), "non-registered");
    assert.equal(normalizeAccountType("taxable account"), "non-registered");
    assert.equal(normalizeAccountType("Non-Registered"), "non-registered");
    assert.equal(normalizeAccountType("Cash"), "non-registered");
  });

  test("refuses to guess at anything else", () => {
    // Defaulting here is what filed a whole portfolio into one account.
    for (const value of [undefined, "", "   ", "RESP", "gibberish"]) {
      assert.equal(normalizeAccountType(value), null, `value ${String(value)}`);
    }
  });
});

describe("parseTradeCsv", () => {
  const header =
    "Date,Type,Ticker,Quantity,Price per unit,Transacted amount,account type,Manual CAD Conversion";

  test("reads each row's own account type rather than one for the file", () => {
    const csv = [
      header,
      "2025-01-05,buy,XEQT,10,30,300,TFSA,",
      "2025-01-06,buy,VFV,5,100,500,Taxable,",
      "2025-01-07,buy,ZAG,2,15,30,RRSP,",
    ].join("\n");
    assert.deepEqual(
      parseTradeCsv("t.csv", csv).map((r) => r.registration),
      ["TFSA", "non-registered", "RRSP"],
    );
  });

  test("a manual CAD conversion marks the security as US-listed", () => {
    const csv = [
      header,
      "2025-01-05,buy,NVDA,2,100,200,TFSA,272.50",
      "2025-01-05,buy,XEQT,10,30,300,TFSA,",
    ].join("\n");
    const [nvda, xeqt] = parseTradeCsv("t.csv", csv);
    assert.equal(nvda.currency, "USD", "converted, so it settled in USD");
    assert.equal(nvda.amountCad, 272.5, "the conversion is the CAD figure");
    assert.equal(nvda.transactedAmount, 200, "the native amount is untouched");
    assert.equal(xeqt.currency, "CAD", "no conversion needed means it was CAD");
    assert.equal(xeqt.amountCad, 300);
  });

  test("an unreadable account type is excluded, not defaulted", () => {
    const csv = [header, "2025-01-05,buy,XEQT,10,30,300,RESP,"].join("\n");
    const [row] = parseTradeCsv("t.csv", csv);
    assert.equal(row.registration, null);
    assert.equal(row.include, false);
    assert.match(row.error ?? "", /RESP/);
  });
});

describe("accumulatePositions", () => {
  const row = (over: Partial<ReturnType<typeof parseTradeCsv>[number]>) => ({
    id: "r",
    date: "2025-01-01",
    type: "buy" as const,
    ticker: "XEQT",
    quantity: 10,
    pricePerUnit: 30,
    transactedAmount: 300,
    registration: "TFSA" as Registration | null,
    registrationRaw: "TFSA",
    currency: "CAD" as const,
    amountCad: 300,
    include: true,
    sourceFile: "t.csv",
    ...over,
  });

  test("repeated buys build one position, not one per row", () => {
    // The bug this replaces created 219 holdings from 219 rows.
    const rows = Array.from({ length: 5 }, (_, i) =>
      row({ id: `r${i}`, date: `2025-01-0${i + 1}` }),
    );
    const { positions } = accumulatePositions(rows, resolve, []);
    assert.equal(positions.length, 1, "one position for one ticker in one account");
    assert.equal(positions[0].shares, 50);
    assert.equal(positions[0].costCad, 1500);
  });

  test("the same ticker in two accounts stays two positions", () => {
    const { positions } = accumulatePositions(
      [row({}), row({ registration: "RRSP", registrationRaw: "RRSP" })],
      resolve,
      [],
    );
    assert.equal(positions.length, 2);
    assert.deepEqual(
      positions.map((p) => p.accountId).sort(),
      ["acc-rrsp", "acc-tfsa"],
    );
  });

  test("average cost pools buys at different prices", () => {
    const { positions } = accumulatePositions(
      [
        row({ quantity: 10, transactedAmount: 300, amountCad: 300 }),
        row({ date: "2025-02-01", quantity: 10, transactedAmount: 500, amountCad: 500 }),
      ],
      resolve,
      [],
    );
    const h = positionToHolding(positions[0]);
    assert.equal(h.shares, 20);
    assert.equal(h.avgCost, 40, "(300 + 500) / 20");
  });

  test("a sell removes basis proportionally and leaves average cost alone", () => {
    const { positions } = accumulatePositions(
      [
        row({ quantity: 10, transactedAmount: 300, amountCad: 300 }),
        row({ date: "2025-03-01", type: "sell", quantity: 4, transactedAmount: 200, amountCad: 200 }),
      ],
      resolve,
      [],
    );
    const h = positionToHolding(positions[0]);
    assert.equal(h.shares, 6);
    assert.equal(h.avgCost, 30, "selling does not change what the rest cost");
  });

  test("a US position keeps the CAD it actually cost", () => {
    const { positions } = accumulatePositions(
      [row({ ticker: "NVDA", currency: "USD", quantity: 2, transactedAmount: 200, amountCad: 272.5 })],
      resolve,
      [],
    );
    const h = positionToHolding(positions[0]);
    assert.equal(h.currency, "USD");
    assert.equal(h.avgCost, 100, "native cost per share");
    assert.equal(h.avgCostCADOverride, 136.25, "the rate paid, not today's rate");
  });

  test("buys spend account cash and sells return it", () => {
    const { cashDeltas } = accumulatePositions(
      [
        row({ amountCad: 300 }),
        row({ date: "2025-04-01", type: "sell", quantity: 5, amountCad: 200 }),
        row({ date: "2025-05-01", type: "dividend", quantity: 0, amountCad: 12 }),
      ],
      resolve,
      [],
    );
    assert.equal(cashDeltas.get("acc-tfsa"), -300 + 200 + 12);
  });

  test("deposits and withdrawals become transfers, not positions", () => {
    const { positions, transfers } = accumulatePositions(
      [
        row({ type: "deposit", ticker: "", quantity: 0, amountCad: 1000 }),
        row({ date: "2025-06-01", type: "withdrawal", ticker: "", quantity: 0, amountCad: 400 }),
      ],
      resolve,
      [],
    );
    assert.equal(positions.length, 0);
    assert.deepEqual(transfers.map((t) => [t.deposit, t.amount]), [[true, 1000], [false, 400]]);
  });

  test("rows with no resolvable account are skipped, never reassigned", () => {
    const { positions, skipped } = accumulatePositions(
      [row({ registration: null }), row({ registration: "FHSA" })],
      // The user has no FHSA account.
      (r) => (r === "TFSA" ? "acc-tfsa" : ""),
      [],
    );
    assert.equal(skipped, 2);
    assert.equal(positions.length, 0, "nothing lands in a fallback account");
  });

  test("trades add to a position that already exists", () => {
    const existing = {
      id: "h1",
      ticker: "XEQT",
      name: "XEQT",
      assetClass: "US Equity",
      sector: "Other",
      shares: 10,
      avgCost: 30,
      price: 32,
      history: [32],
      dividendsReceived: 0,
      accountId: "acc-tfsa",
      currency: "CAD",
      priceCAD: 32,
      avgCostCAD: 30,
      dividendsReceivedCAD: 0,
      historyCAD: [32],
    } as Holding;
    const { positions } = accumulatePositions([row({})], resolve, [existing]);
    assert.equal(positions.length, 1);
    assert.equal(positions[0].existing?.id, "h1");
    assert.equal(positionToHolding(positions[0]).shares, 20);
  });
});
