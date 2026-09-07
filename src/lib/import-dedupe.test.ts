import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { markAlreadyImported, type TradeRow } from "./trades";
import type { Holding } from "./types";

/*
 * The duplicate check existed and was defeated twice over, so the same trades
 * were imported a second time into positions that already held them: a sale of
 * three shares landed twice and left one share where four were held, and a
 * monthly purchase landed twice and added twenty shares nobody bought.
 *
 * Both failures were in the key. It carried the exact ticker, so a position
 * held as WEQT.TO never matched an export writing WEQT; and the exact amount,
 * so a sale converted to Canadian dollars by hand did not match the same sale
 * converted by the broker.
 */

const held = (over: Partial<Holding> = {}): Holding =>
  ({
    id: "h1", ticker: "WEQT.TO", name: "WEQT", assetClass: "US Equity",
    shares: 10, avgCost: 20, price: 25, history: [], dividendsReceived: 0,
    accountId: "acct-1", currency: "CAD", priceCAD: 25, avgCostCAD: 20,
    dividendsReceivedCAD: 0, historyCAD: [], flows: [],
    ...over,
  }) as unknown as Holding;

const row = (over: Partial<TradeRow> = {}): TradeRow =>
  ({
    date: "2026-06-30", type: "sell", ticker: "WEQT", quantity: 3,
    pricePerUnit: 100, transactedAmount: 300, amountCad: 8365.03,
    currency: "CAD", registration: "RRSP", registrationRaw: "RRSP",
    include: true, duplicate: false, sourceFile: "f.csv",
    ...over,
  }) as unknown as TradeRow;

const accountIdFor = () => "acct-1";
const mark = (rows: TradeRow[], holdings: Holding[]) =>
  markAlreadyImported(rows, accountIdFor, holdings, [], new Set());

describe("a trade already recorded is not imported again", () => {
  test("a bare symbol matches the suffixed position holding it", () => {
    const out = mark(
      [row()],
      [held({ flows: [{ date: "2026-06-30", kind: "sell", amount: 8365.03, shares: -3 }] as never })],
    );
    assert.equal(out[0].duplicate, true, "same trade, different ticker spelling");
    assert.equal(out[0].include, false);
  });

  test("a different conversion of the same sale still matches", () => {
    // The sheet converted by hand; the broker converted its own way. Same sale.
    const out = mark(
      [row({ amountCad: 8383.87 })],
      [held({ flows: [{ date: "2026-06-30", kind: "sell", amount: 8365.03, shares: -3 }] as never })],
    );
    assert.equal(out[0].duplicate, true, "the share count decides, not the money");
  });

  test("a dividend recorded gross matches the same one recorded net of withholding", () => {
    const out = mark(
      [row({ type: "dividend", quantity: 0, amountCad: 8.55 })],
      [held({ flows: [{ date: "2026-06-30", kind: "dividend", amount: 10.14, shares: 0 }] as never })],
    );
    assert.equal(out[0].duplicate, true);
  });

  test("a genuinely new trade on a day that already has one is still imported", () => {
    const out = mark(
      [row({ type: "buy", quantity: 215, amountCad: 5011.8 })],
      [held({ flows: [{ date: "2026-06-30", kind: "buy", amount: 500, shares: 21.45 }] as never })],
    );
    assert.equal(out[0].duplicate, false, "different size, so a different trade");
    assert.equal(out[0].include, true);
  });

  test("the same trade in a different account is not a duplicate", () => {
    const out = markAlreadyImported(
      [row()],
      () => "acct-2",
      [held({ flows: [{ date: "2026-06-30", kind: "sell", amount: 8365.03, shares: -3 }] as never })],
      [], new Set(),
    );
    assert.equal(out[0].duplicate, false);
  });

  test("nothing recorded means nothing is a duplicate", () => {
    assert.equal(mark([row()], [held()])[0].duplicate, false);
  });
});

describe("dates and distributions, where the two records disagree", () => {
  test("a trade date and a settlement date are the same trade", () => {
    // A spreadsheet records the day it was made; an export the day it settled.
    const out = mark(
      [row({ type: "buy", date: "2026-08-17", quantity: 21.45, amountCad: 500 })],
      [held({ flows: [{ date: "2026-08-15", kind: "buy", amount: 500, shares: 21.45 }] as never })],
    );
    assert.equal(out[0].duplicate, true);
  });

  test("a fortnight apart is a different trade, however alike", () => {
    const out = mark(
      [row({ type: "buy", date: "2026-08-31", quantity: 21.45, amountCad: 500 })],
      [held({ flows: [{ date: "2026-08-15", kind: "buy", amount: 500, shares: 21.45 }] as never })],
    );
    assert.equal(out[0].duplicate, false, "a monthly purchase must still import");
  });

  test("one distribution split in the export matches the total on record", () => {
    // The export writes 1.58 and 80.75; the database holds 82.33.
    const stored = held({
      flows: [{ date: "2026-07-06", kind: "dividend", amount: 82.33, shares: 0 }] as never,
    });
    for (const amt of [1.58, 80.75]) {
      const out = mark([row({ type: "dividend", quantity: 0, date: "2026-07-06", amountCad: amt })], [stored]);
      assert.equal(out[0].duplicate, true, `component ${amt} is part of the same payment`);
    }
  });

  test("a distribution written in the security's own currency still matches", () => {
    const out = mark(
      [row({ type: "dividend", quantity: 0, date: "2026-06-10", amountCad: 15.52 })],
      [held({ flows: [{ date: "2026-06-10", kind: "dividend", amount: 22.04, shares: 0 }] as never })],
    );
    assert.equal(out[0].duplicate, true, "the same payment, one side unconverted");
  });

  test("the next quarter's distribution is not the last one", () => {
    const out = mark(
      [row({ type: "dividend", quantity: 0, date: "2026-09-10", amountCad: 22.04 })],
      [held({ flows: [{ date: "2026-06-10", kind: "dividend", amount: 22.04, shares: 0 }] as never })],
    );
    assert.equal(out[0].duplicate, false, "three months apart is a different payment");
  });
});
