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
import { ACTIVITY_HEADER as HEADER, activityRow, cashRow, tradeRow } from "./activities.fixture";

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
      cashRow({ date: "2026-08-12", subType: "AFT_OUT", description: "Pre-authorized Debit", netCash: -175 }),
    );
    assert.equal(res.cash.length, 1);
    assert.equal(res.cash[0].accountHint, CHEQUING_HINT);
    assert.equal(accountForHint(res.cash[0].accountHint, accounts), "chq");
  });

  test("a withholding tax belongs to the plan that paid it", () => {
    const res = parse(
      activityRow({
        date: "2026-08-05", accountId: "BB2", accountType: "RRSP",
        activityType: "Tax", subType: "NRT", description: "Non-resident tax",
        currency: "USD", netCash: -2.15,
      }),
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
      tradeRow({
        date: "2026-08-17", settled: "2026-08-18", accountId: "CC3",
        accountType: "Non-registered margin", side: "BUY", symbol: "WEQT",
        name: "Broadline Global Equity Index ETF",
        quantity: 270.5512, unitPrice: 46.21, commission: 0, netCash: -12503.17,
      }),
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
      tradeRow({
        date: "2026-06-30", settled: "2026-07-01", accountId: "BB2", accountType: "RRSP",
        side: "SELL", symbol: "ZLMN", name: "Zellmann Instruments N.V.",
        quantity: 5, unitPrice: 842.6, fxRate: 1.38,
        currency: "USD", commission: 0, netCash: 4213.03,
      }),
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
      cashRow({ date: "2026-06-02", subType: "AFT_IN", description: "Direct deposit received", netCash: 2870.55 }),
      cashRow({ date: "2026-06-01", subType: "AFT_OUT", description: "Pre-authorized Debit", netCash: -58.2 }),
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
      cashRow({ date: "2026-07-15", subType: "TRANSFER", description: "Money transfer out of the account", netCash: -500 }),
      cashRow({ date: "2026-07-15", accountId: "BB2", accountType: "RRSP", subType: "EFT", description: "Deposit", netCash: 500 }),
    );
    assert.equal(res.cash.length, 0);
    assert.equal(
      res.skipped.find((s) => s.reason.includes("your own accounts"))?.count,
      2,
    );
  });

  test("a credit card payment is dropped, since the card's own export has the spending", () => {
    const res = parse(
      cashRow({ date: "2026-08-05", subType: "TRANSFER", description: "Credit card payment", netCash: -1240 }),
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
      activityRow({
        date: "2026-07-03", accountId: "BB2", accountType: "RRSP",
        activityType: "ListingSwap", subType: "-", currency: "CAD", netCash: -9.75,
      }),
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

/*
 * The export writes a depositary receipt under the bare symbol, so `ZQX` may be
 * either the CAD-hedged receipt or the US share and the symbol cannot say
 * which. Only the name and currency can, and the parser used to read neither —
 * so US trades were filed onto the receipt's position and priced as receipts.
 *
 * ALL-FIXTURES-INVENTED
 */
describe("a receipt and its underlying, as the export writes them", () => {
  const CDR_NAME = "Zephyr Industries CDR (CAD Hedged)";
  const US_NAME = "Zephyr Industries Incorporated (Class A)";

  test("a CAD receipt row is filed under the suffixed ticker", () => {
    const res = parse(
      tradeRow({
        date: "2026-04-01",
        accountType: "RRSP",
        symbol: "ZQX",
        name: CDR_NAME,
        currency: "CAD",
        quantity: 10,
        unitPrice: 30,
        side: "BUY",
      }),
    );
    assert.equal(res.trades[0].ticker, "ZQX.NEO");
    assert.equal(res.trades[0].currency, "CAD");
  });

  test("a USD row under the same symbol stays the US listing", () => {
    const res = parse(
      tradeRow({
        date: "2026-04-02",
        accountType: "RRSP",
        symbol: "ZQX",
        name: US_NAME,
        currency: "USD",
        quantity: 4,
        unitPrice: 500,
        side: "BUY",
      }),
    );
    assert.equal(res.trades[0].ticker, "ZQX");
    assert.equal(res.trades[0].currency, "USD");
  });

  test("both in one file stay apart", () => {
    const res = parse(
      tradeRow({
        date: "2026-04-01", accountType: "RRSP", symbol: "ZQX", name: CDR_NAME,
        currency: "CAD", quantity: 10, unitPrice: 30, side: "SELL",
      }),
      tradeRow({
        date: "2026-04-01", accountType: "RRSP", symbol: "ZQX", name: US_NAME,
        currency: "USD", quantity: 4, unitPrice: 500, side: "BUY",
      }),
    );
    assert.deepEqual(res.trades.map((t) => t.ticker), ["ZQX.NEO", "ZQX"]);
  });

  test("an ordinary Canadian security is not mistaken for a receipt", () => {
    const res = parse(
      tradeRow({
        date: "2026-04-03", accountType: "TFSA", symbol: "BMIX",
        name: "Broad Market Index ETF Portfolio",
        currency: "CAD", quantity: 5, unitPrice: 40, side: "BUY",
      }),
    );
    assert.equal(res.trades[0].ticker, "BMIX");
  });
});
