import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { movementApplies } from "./types";
import { accumulatePositions, type TradeRow } from "./trades";
import type { Holding } from "./types";

/*
 * A hand-entered balance is a statement about a day: everything up to it is
 * already inside the number. These check that the second counting cannot
 * happen again — importing two years of trades onto a balance entered last
 * week took two investment accounts tens of thousands of dollars negative,
 * and nothing failed, because every individual step was correct.
 */

describe("movementApplies", () => {
  test("an account nobody has stated takes every movement", () => {
    assert.equal(movementApplies({}, "2020-01-01"), true);
    assert.equal(movementApplies({ balanceAsOf: null }, "2026-09-01"), true);
  });

  test("movements after the anchor still apply", () => {
    assert.equal(movementApplies({ balanceAsOf: "2026-08-31" }, "2026-09-01"), true);
  });

  test("movements before it do not", () => {
    assert.equal(movementApplies({ balanceAsOf: "2026-08-31" }, "2026-07-15"), false);
  });

  test("the anchor day itself is already counted", () => {
    // A balance stated on a day is the balance at the end of it.
    assert.equal(movementApplies({ balanceAsOf: "2026-08-31" }, "2026-08-31"), false);
  });

  test("a movement with no date applies, so manual entry is never dropped", () => {
    assert.equal(movementApplies({ balanceAsOf: "2026-08-31" }, undefined), true);
  });
});

const row = (over: Partial<TradeRow> = {}): TradeRow =>
  ({
    date: "2026-09-02",
    type: "buy",
    ticker: "XEQT.TO",
    quantity: 10,
    pricePerUnit: 30,
    transactedAmount: 300,
    amountCad: 300,
    currency: "CAD",
    registration: "non-registered",
    ...over,
  }) as TradeRow;

const accountIdFor = () => "acct-1";
const noHoldings: Holding[] = [];

describe("accumulatePositions and the anchor", () => {
  test("with no anchor, every trade moves cash", () => {
    const r = accumulatePositions([row({ date: "2024-01-05" }), row()], accountIdFor, noHoldings);
    assert.equal(r.cashDeltas.get("acct-1"), -600);
  });

  test("trades already inside a stated balance leave it alone", () => {
    const r = accumulatePositions(
      [row({ date: "2024-01-05" }), row()],
      accountIdFor,
      noHoldings,
      () => "2026-08-31",
    );
    assert.equal(r.cashDeltas.get("acct-1"), -300);
  });

  test("the position is still built from every trade, only the cash stops", () => {
    /*
     * The distinction the fix turns on: history is what the holding is made
     * of, so dropping those rows would be a different and worse bug than the
     * one being fixed.
     */
    const r = accumulatePositions(
      [row({ date: "2024-01-05" }), row()],
      accountIdFor,
      noHoldings,
      () => "2026-08-31",
    );
    const pos = r.positions.find((p) => p.ticker === "XEQT.TO");
    assert.ok(pos);
    assert.equal(pos.shares, 20);
    assert.equal(pos.flows.length, 2);
  });

  test("an anchor on one account does not silence another", () => {
    const r = accumulatePositions(
      [row({ date: "2024-01-05", registration: "RRSP" }), row({ date: "2024-01-05" })],
      (reg) => (reg === "RRSP" ? "acct-rrsp" : "acct-1"),
      noHoldings,
      (id) => (id === "acct-1" ? "2026-08-31" : null),
    );
    assert.equal(r.cashDeltas.get("acct-rrsp"), -300);
    assert.equal(r.cashDeltas.get("acct-1"), undefined);
  });
});

/*
 * The duplicate-position fault, kept as a test.
 *
 * A broker export writes bare symbols where a position is held with its venue
 * suffix. Matching on exact equality opened a second holding beside the real
 * one and counted the same trade twice -- seven positions in one import.
 */
describe("an imported row finds the position it belongs to", () => {
  const held = (ticker: string, accountId: string, shares = 100): Holding =>
    ({
      id: `h-${ticker}-${accountId}`,
      ticker,
      name: ticker,
      assetClass: "US Equity",
      shares,
      avgCost: 20,
      price: 25,
      history: [],
      dividendsReceived: 0,
      accountId,
      currency: "CAD",
      priceCAD: 25,
      avgCostCAD: 20,
      dividendsReceivedCAD: 0,
      historyCAD: [],
      flows: [],
    }) as unknown as Holding;

  test("a bare symbol lands on the position held with a venue suffix", () => {
    const r = accumulatePositions(
      [row({ ticker: "WEQT" })],
      accountIdFor,
      [held("WEQT.TO", "acct-1")],
    );
    assert.equal(r.positions.length, 1, "one position, not two");
    assert.equal(r.positions[0].ticker, "WEQT.TO", "kept the spelling already held");
    assert.ok(r.positions[0].existing, "matched the existing holding");
    assert.equal(r.positions[0].shares, 110, "the buy added to what was held");
  });

  test("two rows in one file do not open a second holding between them", () => {
    const r = accumulatePositions(
      [row({ ticker: "WEQT", date: "2026-09-01" }), row({ ticker: "WEQT", date: "2026-09-02" })],
      accountIdFor,
      [held("WEQT.TO", "acct-1")],
    );
    assert.equal(r.positions.length, 1);
    assert.equal(r.positions[0].shares, 120);
  });

  test("a symbol nobody holds still opens a position, as it must", () => {
    const r = accumulatePositions([row({ ticker: "NEWCO" })], accountIdFor, []);
    assert.equal(r.positions.length, 1);
    assert.equal(r.positions[0].ticker, "NEWCO");
    assert.equal(r.positions[0].existing, undefined);
  });

  test("an exact match still wins over a suffix match", () => {
    const r = accumulatePositions(
      [row({ ticker: "WEQT" })],
      accountIdFor,
      [held("WEQT", "acct-1", 5), held("WEQT.TO", "acct-1", 900)],
    );
    assert.equal(r.positions.length, 1);
    assert.equal(r.positions[0].ticker, "WEQT");
    assert.equal(r.positions[0].shares, 15);
  });
});
