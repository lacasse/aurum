import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  accumulatePositions,
  markAlreadyImported,
  normalizeAccountType,
  tradeKey,
  normalizeType,
  parseNum,
  parseTradeCsv,
  positionToHolding,
} from "./trades";
import type { TradeRow, TradeType } from "./trades";
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

describe("normalizeType", () => {
  test("reads the wordings a brokerage actually uses", () => {
    assert.equal(normalizeType("Buy"), "buy");
    assert.equal(normalizeType("Bought"), "buy");
    assert.equal(normalizeType("Purchase"), "buy");
    assert.equal(normalizeType("Sell"), "sell");
    assert.equal(normalizeType("Sold"), "sell");
    assert.equal(normalizeType("Sale"), "sell");
    assert.equal(normalizeType("Sold — full position"), "sell");
    assert.equal(normalizeType("Reinvested dividend"), "dividend");
    assert.equal(normalizeType("Cash withdrawal"), "withdrawal");
    assert.equal(normalizeType("Contribution"), "deposit");
  });

  test("never guesses buy for something it does not recognise", () => {
    // This default is what moved a share count by twice the size of a trade:
    // "Sold" was not on the old list, so the shares were added, not removed.
    for (const value of [undefined, "", "   ", "journal", "split", "fee"]) {
      assert.equal(normalizeType(value), null, `value ${String(value)}`);
    }
  });
});

describe("parseNum", () => {
  test("reads plain, separated and accounting-style numbers", () => {
    assert.equal(parseNum("1,234.5"), 1234.5);
    assert.equal(parseNum("$1,234.50"), 1234.5);
    assert.equal(parseNum("(8)"), -8, "accounting notation is negative");
    assert.equal(parseNum("-8"), -8);
    assert.equal(parseNum(""), 0);
    assert.equal(parseNum("n/a"), 0);
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

  test("a sell is subtracted even when the export says \"Sold\"", () => {
    // The exact fault behind a 909 share count that should have been 893:
    // an unrecognised "Sold" became a buy, so an 8-share sale moved the
    // position 16 in the wrong direction.
    const csv = [
      header,
      "2025-01-05,Buy,RETL.NEO,901,20,18020,TFSA,",
      "2025-02-05,Sold,RETL.NEO,8,25,200,TFSA,",
    ].join("\n");
    const rows = parseTradeCsv("t.csv", csv);
    assert.deepEqual(rows.map((r) => r.type), ["buy", "sell"]);
    const { positions } = accumulatePositions(rows, resolve, []);
    assert.equal(positions[0].shares, 893, "901 - 8, not 901 + 8");
  });

  test("a signed quantity is not applied twice", () => {
    // Some exports sign the quantity as well as naming the type. The type
    // carries the direction, so -8 on a sale must not add 8 back.
    const csv = [
      header,
      "2025-01-05,Buy,XEQT,100,30,3000,TFSA,",
      "2025-02-05,Sell,XEQT,-8,30,240,TFSA,",
    ].join("\n");
    const { positions } = accumulatePositions(parseTradeCsv("t.csv", csv), resolve, []);
    assert.equal(positions[0].shares, 92);
  });

  test("the same file loaded twice does not count every trade again", () => {
    // Nothing deduplicated trade rows before, so a second drop of the same
    // file silently doubled the position.
    const csv = [header, "2025-01-05,Buy,XEQT,10,30,300,TFSA,"].join("\n");
    const first = parseTradeCsv("t.csv", csv);
    assert.equal(first[0].duplicate, false);
    const second = parseTradeCsv("t.csv", csv, new Set(first.map(tradeKey)));
    assert.equal(second[0].duplicate, true);
    assert.equal(second[0].include, false, "excluded by default");
  });

  test("a repeated row within one file is flagged too", () => {
    const csv = [
      header,
      "2025-01-05,Buy,XEQT,10,30,300,TFSA,",
      "2025-01-05,Buy,XEQT,10,30,300,TFSA,",
    ].join("\n");
    const rows = parseTradeCsv("t.csv", csv);
    assert.deepEqual(rows.map((r) => r.duplicate), [false, true]);
  });

  test("trades that differ in any field are not duplicates", () => {
    const csv = [
      header,
      "2025-01-05,Buy,XEQT,10,30,300,TFSA,",
      "2025-01-05,Buy,XEQT,10,30,300,RRSP,",
      "2025-01-05,Buy,XEQT,11,30,330,TFSA,",
    ].join("\n");
    assert.deepEqual(
      parseTradeCsv("t.csv", csv).map((r) => r.duplicate),
      [false, false, false],
    );
  });

  test("an unreadable activity type is excluded, not treated as a buy", () => {
    const csv = [header, "2025-01-05,Journal,XEQT,10,30,300,TFSA,"].join("\n");
    const [row] = parseTradeCsv("t.csv", csv);
    assert.equal(row.type, null);
    assert.equal(row.include, false);
    assert.match(row.error ?? "", /Journal/);
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
    type: "buy" as TradeType | null,
    typeRaw: "buy",
    ticker: "XEQT",
    quantity: 10,
    pricePerUnit: 30,
    transactedAmount: 300,
    registration: "TFSA" as Registration | null,
    registrationRaw: "TFSA",
    currency: "CAD" as const,
    amountCad: 300,
    include: true,
    duplicate: false,
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

  test("a same-day buy is applied before a same-day sell", () => {
    // The file's order within a date is not guaranteed. If the sell went
    // first the position would clamp at zero and the shares would be lost.
    const { positions, oversold } = accumulatePositions(
      [
        row({ date: "2025-05-01", type: "sell", quantity: 4, typeRaw: "sell" }),
        row({ date: "2025-05-01", type: "buy", quantity: 10, typeRaw: "buy" }),
      ],
      resolve,
      [],
    );
    assert.equal(positions[0].shares, 6);
    assert.equal(oversold.length, 0, "and nothing looks oversold");
  });

  test("a sale larger than the position is reported, not swallowed", () => {
    const { positions, oversold } = accumulatePositions(
      [
        row({ quantity: 10 }),
        row({ date: "2025-03-01", type: "sell", quantity: 25, typeRaw: "sell" }),
      ],
      resolve,
      [],
    );
    assert.equal(positions[0].shares, 0, "the position still clamps at zero");
    assert.equal(oversold.length, 1);
    assert.deepEqual(
      { sold: oversold[0].sold, held: oversold[0].held },
      { sold: 25, held: 10 },
    );
  });

  test("rows with an unreadable type are skipped", () => {
    const { positions, skipped } = accumulatePositions(
      [row({ type: null, typeRaw: "journal" })],
      resolve,
      [],
    );
    assert.equal(skipped, 1);
    assert.equal(positions.length, 0);
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

  test("a ticker bought and sold in one import still leaves a record", () => {
    // It ends at zero shares — the table hides it — but the realized gain and
    // any dividends it paid are worth keeping.
    const { positions } = accumulatePositions(
      [
        row({ quantity: 10, transactedAmount: 300, amountCad: 300 }),
        row({ date: "2025-06-01", type: "sell", quantity: 10, transactedAmount: 400, amountCad: 400 }),
      ],
      resolve,
      [],
    );
    assert.equal(positions.length, 1);
    assert.equal(positions[0].shares, 0);
    assert.equal(positions[0].everHeld, true, "so the caller knows to keep it");
  });

  test("a position that was never bought is not invented", () => {
    const { positions } = accumulatePositions(
      [row({ type: "dividend", quantity: 0, transactedAmount: 5, amountCad: 5 })],
      resolve,
      [],
    );
    assert.equal(positions[0].everHeld, false);
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

describe("markAlreadyImported", () => {
  const resolveAcc = (r: Registration) => (r === "TFSA" ? "acc-tfsa" : "acc-rrsp");
  const held = (over: Partial<Holding>): Holding =>
    ({
      id: "h1",
      ticker: "XEQT",
      name: "XEQT",
      assetClass: "US Equity",
      sector: "Other",
      shares: 10,
      avgCost: 30,
      price: 40,
      history: [40],
      dividendsReceived: 0,
      accountId: "acc-tfsa",
      currency: "CAD",
      priceCAD: 40,
      avgCostCAD: 30,
      dividendsReceivedCAD: 0,
      historyCAD: [40],
      flows: [{ date: "2025-01-05", kind: "buy", amount: 300, shares: 10 }],
      ...over,
    }) as Holding;

  const csvRow = (over: Partial<TradeRow> = {}): TradeRow => ({
    id: "r1",
    date: "2025-01-05",
    type: "buy",
    typeRaw: "Buy",
    ticker: "XEQT",
    quantity: 10,
    pricePerUnit: 30,
    transactedAmount: 300,
    registration: "TFSA",
    registrationRaw: "TFSA",
    currency: "CAD",
    amountCad: 300,
    include: true,
    duplicate: false,
    sourceFile: "t.csv",
    ...over,
  });

  test("a trade already stored as a flow is flagged and excluded", () => {
    // Re-importing the same file used to double every position: the
    // within-file check starts empty on a fresh page, so nothing matched.
    const [r] = markAlreadyImported([csvRow()], resolveAcc, [held({})], [], new Set(["acc-tfsa"]));
    assert.equal(r.duplicate, true);
    assert.equal(r.include, false);
    assert.equal(r.error, "Already imported");
  });

  test("the same trade in a different account is not a duplicate", () => {
    const [r] = markAlreadyImported(
      [csvRow({ registration: "RRSP", registrationRaw: "RRSP" })],
      resolveAcc,
      [held({})],
      [],
      new Set(["acc-tfsa", "acc-rrsp"]),
    );
    assert.equal(r.duplicate, false);
  });

  test("a different date or amount is not a duplicate", () => {
    const other = markAlreadyImported(
      [csvRow({ date: "2025-02-05" }), csvRow({ amountCad: 301 })],
      resolveAcc,
      [held({})],
      [],
      new Set(["acc-tfsa"]),
    );
    assert.deepEqual(other.map((r) => r.duplicate), [false, false]);
  });

  test("a sale clamped by an oversell still matches itself on re-import", () => {
    // The stored flow carries fewer shares than the row asked for, so the
    // share count cannot be part of the identity.
    const stored = held({
      flows: [{ date: "2025-03-01", kind: "sell", amount: 250, shares: -4 }],
    });
    const [r] = markAlreadyImported(
      [csvRow({ type: "sell", typeRaw: "Sell", quantity: 20, amountCad: 250 })],
      resolveAcc,
      [stored],
      [],
      new Set(["acc-tfsa"]),
    );
    assert.equal(r.date === "2025-01-05" ? r.duplicate : true, false, "different date, not a dup");
    const [r2] = markAlreadyImported(
      [csvRow({ date: "2025-03-01", type: "sell", typeRaw: "Sell", quantity: 20, amountCad: 250 })],
      resolveAcc,
      [stored],
      [],
      new Set(["acc-tfsa"]),
    );
    assert.equal(r2.duplicate, true);
  });

  test("a deposit already posted as a transfer is flagged", () => {
    const [r] = markAlreadyImported(
      [csvRow({ type: "deposit", typeRaw: "Deposit", ticker: "", quantity: 0, amountCad: 1000 })],
      resolveAcc,
      [],
      [{ date: "2025-01-05", amount: 1000, sourceAccountId: "acc-cash", destinationAccountId: "acc-tfsa" }],
      new Set(["acc-tfsa"]),
    );
    assert.equal(r.duplicate, true);
  });

  test("a withdrawal is not confused with a deposit of the same size", () => {
    const [r] = markAlreadyImported(
      [csvRow({ type: "withdrawal", typeRaw: "Withdrawal", ticker: "", quantity: 0, amountCad: 1000 })],
      resolveAcc,
      [],
      [{ date: "2025-01-05", amount: 1000, sourceAccountId: "acc-cash", destinationAccountId: "acc-tfsa" }],
      new Set(["acc-tfsa"]),
    );
    assert.equal(r.duplicate, false, "money in is not money out");
  });

  test("an empty portfolio flags nothing", () => {
    const rows = [csvRow(), csvRow({ id: "r2", date: "2025-02-05" })];
    assert.deepEqual(
      markAlreadyImported(rows, resolveAcc, [], [], new Set()).map((r) => r.duplicate),
      [false, false],
    );
  });
});
