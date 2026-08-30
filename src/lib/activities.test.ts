import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isActivityExport, parseActivitiesCsv } from "./activities";

const HEADER =
  "effective_date,effective_time,settlement_date,account_id,account_type,activity_type,activity_sub_type,description,direction,symbol,name,currency,quantity,unit_price,commission,net_cash_amount";

function parse(...rows: string[]) {
  return parseActivitiesCsv(
    "activities.csv",
    [HEADER, ...rows].join("\n"),
    new Set(),
    new Set(),
    {},
    ["Groceries", "Dining", "Housing", "Taxes", "Fees", "Other"],
  );
}

describe("isActivityExport", () => {
  test("recognises the export by its columns", () => {
    assert.equal(isActivityExport(HEADER.split(",")), true);
  });

  test("does not claim a card statement", () => {
    assert.equal(
      isActivityExport(["transaction_date", "merchant", "amount", "category"]),
      false,
    );
  });
});

describe("parseActivitiesCsv", () => {
  test("a buy becomes a trade in the account it settled in", () => {
    const res = parse(
      '2026-08-17,11:31:02,2026-08-18,HQB5,Non-registered margin,Trade,BUY,XEQT - iShares: Bought 389.4418 shares at $46.22 per share,LONG,XEQT,iShares Core Equity ETF Portfolio,CAD,389.4418,46.22,0,-18000',
    );
    assert.equal(res.trades.length, 1);
    const [t] = res.trades;
    assert.equal(t.type, "buy");
    assert.equal(t.ticker, "XEQT");
    assert.equal(t.registration, "non-registered");
    assert.equal(t.transactedAmount, 18000);
  });

  test("a US trade converts at the rate on the row, not today's", () => {
    const res = parse(
      '2026-06-30,11:52:08,2026-07-01,HQ0,RRSP,Trade,SELL,"ASML: Sold 3.0000 shares at $1963.20 per share, FX Rate: 1.4235",LONG,ASML,ASML Holding N.V.,USD,-3,1963.205,0,5889.62',
    );
    const [t] = res.trades;
    assert.equal(t.type, "sell");
    assert.equal(t.currency, "USD");
    // 5889.62 × 1.4235, and emphatically not 5889.62 × whatever USD is worth now.
    assert.ok(Math.abs(t.amountCad - 5889.62 * 1.4235) < 0.01);
  });

  test("a dividend is recorded against the security, not as loose income", () => {
    const res = parse(
      '2026-07-06,00:00:00,,H73,TFSA,Dividend,-,"CAGE: Cash dividend distribution",,CAGE,Avantis,CAD,78.02,,,78.02',
    );
    assert.equal(res.cash.length, 0);
    assert.equal(res.trades[0].type, "dividend");
    assert.equal(res.trades[0].ticker, "CAGE");
  });

  test("salary is income and a pre-authorized debit is spending", () => {
    const res = parse(
      "2026-06-02,10:00:53,,WK2,Chequing,MoneyMovement,AFT_IN,Direct deposit received,,,,CAD,3142.92,,,3142.92",
      "2026-06-01,22:34:02,,WK2,Chequing,MoneyMovement,AFT_OUT,Pre-authorized Debit,,,,CAD,-41.63,,,-41.63",
    );
    assert.equal(res.cash.length, 2);
    assert.equal(res.cash[0].type, "income");
    assert.equal(res.cash[0].amount, 3142.92);
    assert.equal(res.cash[1].type, "expense");
    assert.equal(res.cash[1].amount, 41.63);
  });

  test("both sides of an internal transfer are dropped, not counted", () => {
    // The same $500 leaving chequing and arriving in the RRSP. Counted, it
    // would read as a month of spending followed by a deposit.
    const res = parse(
      "2026-07-15,12:02:02,,WK2,Chequing,MoneyMovement,TRANSFER,Money transfer out of the account,,,,CAD,-500,,,-500",
      "2026-07-15,12:02:02,,HQ0,RRSP,MoneyMovement,EFT,Deposit,,,,CAD,500,,,500",
    );
    assert.equal(res.cash.length, 0);
    assert.equal(
      res.skipped.find((s) => s.reason.includes("your own accounts"))?.count,
      2,
    );
  });

  test("a credit card payment is dropped, since the card's own export has the spending", () => {
    const res = parse(
      "2026-08-05,17:48:56,,WK2,Chequing,MoneyMovement,TRANSFER,Credit card payment,,,,CAD,-1977.24,,,-1977.24",
    );
    assert.equal(res.cash.length, 0);
    assert.equal(res.skipped.find((s) => s.reason === "credit card payments")?.count, 1);
  });

  test("corporate actions are surfaced rather than guessed at", () => {
    const res = parse(
      "2026-07-01,00:00:00,,HQ0,RRSP,CorporateAction,DEMERGER,MBGL: Corrected quantity of shares by 16.0000,LONG,MBGL,Mobility Global Inc.,,16,,,",
    );
    assert.equal(res.trades.length, 0);
    assert.equal(res.needsAttention.length, 1);
    assert.match(res.needsAttention[0], /MBGL/);
  });

  test("the trailing 'as of' line is not a transaction", () => {
    const res = parse('"As of 2026-08-30 09:23 GMT-04:00"');
    assert.equal(res.cash.length, 0);
    assert.equal(res.trades.length, 0);
  });

  test("a row already recorded arrives switched off", () => {
    const res = parseActivitiesCsv(
      "a.csv",
      [
        HEADER,
        "2026-06-02,10:00:53,,WK2,Chequing,MoneyMovement,AFT_IN,Direct deposit received,,,,CAD,3142.92,,,3142.92",
      ].join("\n"),
      new Set(["2026-06-02|3142.92|direct deposit received"]),
      new Set(),
      {},
    );
    assert.equal(res.cash[0].dup, true);
    assert.equal(res.cash[0].include, false);
  });
});
