/*
 * ALL-FIXTURES-INVENTED. Every row below has the shape of a real export and
 * none of its content: account codes, symbols, names, quantities, prices and
 * amounts are all made up. Statement rows were once pasted in here verbatim,
 * which put account identifiers and real trades into a public repository.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  CHEQUING_HINT,
  isActivityExport,
  parseActivitiesCsv,
} from "./activities";
import { accountForHint } from "./import-router";
import type { Account } from "./types";

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

describe("the account a row names", () => {
  const accounts = [
    { id: "chq", name: "Main Account", kind: "checking" },
    { id: "visa", name: "Visa", kind: "credit" },
    { id: "rrsp", name: "RRSP", kind: "investment", registration: "RRSP" },
    { id: "tfsa", name: "TFSA", kind: "investment", registration: "TFSA" },
  ] as unknown as Account[];

  test("a chequing row says so, rather than saying nothing", () => {
    const res = parse(
      '2026-08-12,22:31:55,,AA1,Chequing,MoneyMovement,AFT_OUT,Pre-authorized Debit,,,,CAD,-175,,,-175',
    );
    assert.equal(res.cash.length, 1);
    assert.equal(res.cash[0].accountHint, CHEQUING_HINT);
    assert.equal(accountForHint(res.cash[0].accountHint, accounts), "chq");
  });

  test("a withholding tax belongs to the plan that paid it", () => {
    const res = parse(
      '2026-08-05,00:00:00,,BB2,RRSP,Tax,NRT,Non-resident tax,,,,USD,-2.15,,,-2.15',
    );
    assert.equal(res.cash[0].accountHint, "RRSP");
    assert.equal(accountForHint(res.cash[0].accountHint, accounts), "rrsp");
  });

  test("a row that named no account is nobody's to guess", () => {
    assert.equal(accountForHint(undefined, accounts), null);
  });

  test("a registration nobody holds does not fall back to the wrong account", () => {
    assert.equal(accountForHint("FHSA", accounts), null);
  });
});

describe("parseActivitiesCsv", () => {
  test("a buy becomes a trade in the account it settled in", () => {
    const res = parse(
      '2026-08-17,11:31:02,2026-08-18,CC3,Non-registered margin,Trade,BUY,WEQT - Broadline: Bought 270.5512 shares at $46.21 per share,LONG,WEQT,Broadline Global Equity Index ETF,CAD,270.5512,46.21,0,-12503.17',
    );
    assert.equal(res.trades.length, 1);
    const [t] = res.trades;
    assert.equal(t.type, "buy");
    assert.equal(t.ticker, "WEQT");
    assert.equal(t.registration, "non-registered");
    assert.equal(t.transactedAmount, 12503.17);
  });

  test("a US trade converts at the rate on the row, not today's", () => {
    const res = parse(
      '2026-06-30,11:52:08,2026-07-01,BB2,RRSP,Trade,SELL,"ZLMN: Sold 5.0000 shares at [figure redacted] per share, FX Rate: 1.3800",LONG,ZLMN,Zellmann Instruments N.V.,USD,-5,842.605,0,4213.03',
    );
    const [t] = res.trades;
    assert.equal(t.type, "sell");
    assert.equal(t.currency, "USD");
    // The rate written on the row, and emphatically not whatever USD is worth now.
    assert.ok(Math.abs(t.amountCad - 4213.03 * 1.38) < 0.01);
  });

  test("a dividend is recorded against the security, not as loose income", () => {
    const res = parse(
      '2026-07-06,00:00:00,,DD4,TFSA,Dividend,-,"DVFD: Cash dividend distribution",,DVFD,Dividend Focus Fund,CAD,52.40,,,52.40',
    );
    assert.equal(res.cash.length, 0);
    assert.equal(res.trades[0].type, "dividend");
    assert.equal(res.trades[0].ticker, "DVFD");
  });

  test("salary is income and a pre-authorized debit is spending", () => {
    const res = parse(
      "2026-06-02,10:00:53,,AA1,Chequing,MoneyMovement,AFT_IN,Direct deposit received,,,,CAD,2870.55,,,2870.55",
      "2026-06-01,22:34:02,,AA1,Chequing,MoneyMovement,AFT_OUT,Pre-authorized Debit,,,,CAD,-58.20,,,-58.20",
    );
    assert.equal(res.cash.length, 2);
    assert.equal(res.cash[0].type, "income");
    assert.equal(res.cash[0].amount, 2870.55);
    assert.equal(res.cash[1].type, "expense");
    assert.equal(res.cash[1].amount, 58.20);
  });

  test("both sides of an internal transfer are dropped, not counted", () => {
    // The same amount leaving chequing and arriving in the RRSP. Counted, it
    // would read as a month of spending followed by a deposit.
    const res = parse(
      "2026-07-15,12:02:02,,AA1,Chequing,MoneyMovement,TRANSFER,Money transfer out of the account,,,,CAD,-500,,,-500",
      "2026-07-15,12:02:02,,BB2,RRSP,MoneyMovement,EFT,Deposit,,,,CAD,500,,,500",
    );
    assert.equal(res.cash.length, 0);
    assert.equal(
      res.skipped.find((s) => s.reason.includes("your own accounts"))?.count,
      2,
    );
  });

  test("a credit card payment is dropped, since the card's own export has the spending", () => {
    const res = parse(
      "2026-08-05,17:48:56,,AA1,Chequing,MoneyMovement,TRANSFER,Credit card payment,,,,CAD,-1240.00,,,-1240.00",
    );
    assert.equal(res.cash.length, 0);
    assert.equal(res.skipped.find((s) => s.reason === "credit card payments")?.count, 1);
  });

  test("a corporate action nothing explains is surfaced rather than guessed at", () => {
    const res = parse(
      "2026-07-01,00:00:00,,BB2,RRSP,CorporateAction,SPLIT,OMNI: 10 for 1,LONG,OMNI,Omnitech,,120,,,",
    );
    assert.equal(res.trades.length, 0);
    assert.equal(res.needsAttention.length, 1);
    assert.match(res.needsAttention[0], /OMNI/);
  });

  test("journalled shares are one security, not a sale of shares never bought", () => {
    // Norbert's Gambit: buy the US listing, journal the shares to the Canadian
    // one, sell that. Read literally the file sells shares of a ticker
    // nothing ever bought.
    const res = parse(
      '2026-06-30,11:57:39,2026-07-02,BB2,RRSP,Trade,BUY,"USDX.U: Bought 430.0000 shares at $12.44 per share, FX Rate: 1.3800",LONG,USDX.U,Meridian US Dollar Currency ETF,USD,430,12.4400,0,-5349.20',
      "2026-07-03,09:30:03,,BB2,RRSP,ListingSwap,-,,LONG,USDX,Meridian US Dollar Currency ETF,,430,,,",
      "2026-07-03,09:30:03,,BB2,RRSP,ListingSwap,-,,LONG,USDX.U,Meridian US Dollar Currency ETF,,-430,,,",
      "2026-07-03,10:47:56,2026-07-06,BB2,RRSP,Trade,SELL,USDX: Sold 430.0000 shares at $16.05 per share,LONG,USDX,Meridian US Dollar Currency ETF,CAD,-430,16.05,0,6901.50",
    );
    const tickers = res.trades.map((t) => t.ticker);
    assert.deepEqual(tickers, ["USDX", "USDX"], "the buy is recorded under the ticker it was sold as");
    assert.deepEqual(
      res.trades.map((t) => t.type),
      ["buy", "sell"],
    );
  });

  test("the journalling fee is money even though the journal is not", () => {
    const res = parse(
      "2026-07-03,09:30:03,,BB2,RRSP,ListingSwap,-,,,,,CAD,-9.75,,,-9.75",
    );
    assert.equal(res.cash.length, 1);
    assert.equal(res.cash[0].type, "expense");
    assert.equal(res.cash[0].amount, 9.75);
  });

  test("a demerger becomes an action on the parent, and the sale stays a sale", () => {
    const res = parse(
      "2026-07-01,00:00:00,,BB2,RRSP,CorporateAction,DEMERGER,TRVM: Corrected quantity of shares by 24.0000,LONG,TRVM,Trevaine Mobility Inc.,,24,,,",
      "2026-07-01,00:00:00,,BB2,RRSP,CorporateAction,DEMERGER,TRVN: Corrected quantity of shares by 0.0000,LONG,TRVN,Trevaine Group plc,,0,,,",
      '2026-07-31,13:18:27,2026-08-03,BB2,RRSP,Trade,SELL,"TRVM: Sold 24.0000 shares at $15.75 per share, FX Rate: 1.3650",LONG,TRVM,Trevaine Mobility Inc.,USD,-24,15.7500,0,378.00',
    );
    // The shares are a real position carved out of the parent, so the sale is
    // an ordinary sale measured against whatever basis came across with them.
    assert.equal(res.actions.length, 1);
    const [a] = res.actions;
    assert.equal(a.kind, "demerger");
    assert.equal(a.from, "TRVN");
    assert.equal(a.to, "TRVM");
    assert.equal(a.shares, 24);
    assert.equal(a.registration, "RRSP");
    assert.equal(a.allocationPct, 0, "the company's allocation is asked for, not guessed");

    assert.equal(res.trades.length, 1);
    assert.equal(res.trades[0].type, "sell");
    assert.equal(res.trades[0].ticker, "TRVM");
    assert.equal(res.needsAttention.length, 0);
  });

  test("the same amount leaving month after month is rent, and says which one", () => {
    const res = parse(
      "2026-06-01,04:00:00,,AA1,Chequing,MoneyMovement,E_TRFOUT,Interac e-Transfer® Out,,,,CAD,-1450,,,-1450",
      "2026-07-01,04:00:00,,AA1,Chequing,MoneyMovement,E_TRFOUT,Interac e-Transfer® Out,,,,CAD,-1450,,,-1450",
      "2026-08-01,04:00:00,,AA1,Chequing,MoneyMovement,E_TRFOUT,Interac e-Transfer® Out,,,,CAD,-1450,,,-1450",
      "2026-08-05,20:54:09,,AA1,Chequing,MoneyMovement,E_TRFOUT,Interac e-Transfer® Out,,,,CAD,-80,,,-80",
    );
    const rent = res.cash.filter((r) => r.category === "Housing");
    assert.equal(rent.length, 3);
    assert.match(rent[0].payee, /\$1450\.00$/, "the payee names the amount, so correcting it teaches this transfer only");
    const oneOff = res.cash.find((r) => r.amount === 80);
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
        "2026-06-02,10:00:53,,AA1,Chequing,MoneyMovement,AFT_IN,Direct deposit received,,,,CAD,2870.55,,,2870.55",
      ].join("\n"),
      new Set(["2026-06-02|2870.55|direct deposit received"]),
      new Set(),
      {},
    );
    assert.equal(res.cash[0].dup, true);
    assert.equal(res.cash[0].include, false);
  });
});
