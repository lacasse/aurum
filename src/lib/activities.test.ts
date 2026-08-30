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

  test("a corporate action nothing explains is surfaced rather than guessed at", () => {
    const res = parse(
      "2026-07-01,00:00:00,,HQ0,RRSP,CorporateAction,SPLIT,NVDA: 10 for 1,LONG,NVDA,NVIDIA,,90,,,",
    );
    assert.equal(res.trades.length, 0);
    assert.equal(res.needsAttention.length, 1);
    assert.match(res.needsAttention[0], /NVDA/);
  });

  test("journalled shares are one security, not a sale of shares never bought", () => {
    // Norbert's Gambit: buy the US listing, journal the shares to the Canadian
    // one, sell that. Read literally the file sells 592 shares of a ticker
    // nothing ever bought.
    const res = parse(
      '2026-06-30,11:57:39,2026-07-02,HQ0,RRSP,Trade,BUY,"DLR.U: Bought 592.0000 shares at $10.09 per share, FX Rate: 1.4235",LONG,DLR.U,Global X US Dollar Currency ETF,USD,592,10.0958,0,-5976.71',
      "2026-07-03,09:30:03,,HQ0,RRSP,ListingSwap,-,,LONG,DLR,Global X US Dollar Currency ETF,,592,,,",
      "2026-07-03,09:30:03,,HQ0,RRSP,ListingSwap,-,,LONG,DLR.U,Global X US Dollar Currency ETF,,-592,,,",
      "2026-07-03,10:47:56,2026-07-06,HQ0,RRSP,Trade,SELL,DLR: Sold 592.0000 shares at $14.33 per share,LONG,DLR,Global X US Dollar Currency ETF,CAD,-592,14.33,0,8483.36",
    );
    const tickers = res.trades.map((t) => t.ticker);
    assert.deepEqual(tickers, ["DLR", "DLR"], "the buy is recorded under the ticker it was sold as");
    assert.deepEqual(
      res.trades.map((t) => t.type),
      ["buy", "sell"],
    );
  });

  test("the journalling fee is money even though the journal is not", () => {
    const res = parse(
      "2026-07-03,09:30:03,,HQ0,RRSP,ListingSwap,-,,,,,CAD,-11.24,,,-11.24",
    );
    assert.equal(res.cash.length, 1);
    assert.equal(res.cash[0].type, "expense");
    assert.equal(res.cash[0].amount, 11.24);
  });

  test("a demerger becomes an action on the parent, and the sale stays a sale", () => {
    const res = parse(
      "2026-07-01,00:00:00,,HQ0,RRSP,CorporateAction,DEMERGER,MBGL: Corrected quantity of shares by 16.0000,LONG,MBGL,Mobility Global Inc.,,16,,,",
      "2026-07-01,00:00:00,,HQ0,RRSP,CorporateAction,DEMERGER,SPGI: Corrected quantity of shares by 0.0000,LONG,SPGI,S&P Global Inc.,,0,,,",
      '2026-07-31,13:18:27,2026-08-03,HQ0,RRSP,Trade,SELL,"MBGL: Sold 16.0000 shares at $20.38 per share, FX Rate: 1.4014",LONG,MBGL,Mobility Global Inc.,USD,-16,20.3842,0,326.15',
    );
    // The shares are a real position carved out of the parent, so the sale is
    // an ordinary sale measured against whatever basis came across with them.
    assert.equal(res.actions.length, 1);
    const [a] = res.actions;
    assert.equal(a.kind, "demerger");
    assert.equal(a.from, "SPGI");
    assert.equal(a.to, "MBGL");
    assert.equal(a.shares, 16);
    assert.equal(a.registration, "RRSP");
    assert.equal(a.allocationPct, 0, "the company's allocation is asked for, not guessed");

    assert.equal(res.trades.length, 1);
    assert.equal(res.trades[0].type, "sell");
    assert.equal(res.trades[0].ticker, "MBGL");
    assert.equal(res.needsAttention.length, 0);
  });

  test("the same amount leaving month after month is rent, and says which one", () => {
    const res = parse(
      "2026-06-01,04:00:00,,WK2,Chequing,MoneyMovement,E_TRFOUT,Interac e-Transfer® Out,,,,CAD,-1300,,,-1300",
      "2026-07-01,04:00:00,,WK2,Chequing,MoneyMovement,E_TRFOUT,Interac e-Transfer® Out,,,,CAD,-1300,,,-1300",
      "2026-08-01,04:00:00,,WK2,Chequing,MoneyMovement,E_TRFOUT,Interac e-Transfer® Out,,,,CAD,-1300,,,-1300",
      "2026-08-05,20:54:09,,WK2,Chequing,MoneyMovement,E_TRFOUT,Interac e-Transfer® Out,,,,CAD,-65,,,-65",
    );
    const rent = res.cash.filter((r) => r.category === "Housing");
    assert.equal(rent.length, 3);
    assert.match(rent[0].payee, /\$1300\.00$/, "the payee names the amount, so correcting it teaches this transfer only");
    const oneOff = res.cash.find((r) => r.amount === 65);
    assert.notEqual(oneOff?.category, "Housing", "a one-off transfer is not rent");
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
