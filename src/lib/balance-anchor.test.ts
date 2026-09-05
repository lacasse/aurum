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
