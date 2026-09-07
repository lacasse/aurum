import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { useFinance } from "./store";
import type { Holding } from "./types";

/*
 * A cost base is a fact about the day the shares were bought. It used to be
 * re-derived from the live exchange rate on every write, so a price refresh or
 * an unrelated edit restated a US position's Canadian basis at whatever the
 * rate was that afternoon. Four real positions were altered that way, one of
 * them by 38%, with no trade behind the change.
 */

const usdHolding = (over: Partial<Holding> = {}): Holding =>
  ({
    id: "h-usd",
    ticker: "ZLMN",
    name: "Zellmann",
    assetClass: "US Equity",
    shares: 10,
    avgCost: 100, // INVENTED
    price: 120,
    history: [110, 120],
    dividendsReceived: 0,
    accountId: "acct-1",
    currency: "USD",
    priceCAD: 150,
    avgCostCAD: 125, // bought when the rate was 1.25
    dividendsReceivedCAD: 0,
    historyCAD: [],
    flows: [],
    ...over,
  }) as Holding;

describe("a stored Canadian cost base survives a write", () => {
  test("an edit that says nothing about cost leaves the basis alone", () => {
    useFinance.setState({ holdings: [usdHolding()], usdCadRate: 1.5 });
    const h = useFinance.getState().holdings[0];

    // A price change, nothing more. The rate has moved from 1.25 to 1.5.
    useFinance.getState().updateHolding(h.id, {
      ticker: h.ticker,
      name: h.name,
      assetClass: h.assetClass,
      shares: h.shares,
      avgCost: h.avgCost,
      price: 130,
      dividendsReceived: h.dividendsReceived,
      accountId: h.accountId,
      currency: h.currency,
    } as never);

    const after = useFinance.getState().holdings[0];
    assert.equal(after.avgCostCAD, 125, "the basis is what was paid, not avgCost x today's rate");
    assert.notEqual(after.avgCostCAD, 150, "150 would be the live rate reapplied");
    assert.equal(after.priceCAD, 195, "the price, unlike the basis, does follow the rate");
  });

  test("an explicit override still wins, because a correction must be possible", () => {
    useFinance.setState({ holdings: [usdHolding()], usdCadRate: 1.5 });
    const h = useFinance.getState().holdings[0];
    useFinance.getState().updateHolding(h.id, {
      ticker: h.ticker,
      name: h.name,
      assetClass: h.assetClass,
      shares: h.shares,
      avgCost: h.avgCost,
      price: h.price,
      dividendsReceived: h.dividendsReceived,
      accountId: h.accountId,
      currency: h.currency,
      avgCostCADOverride: 131.5,
    } as never);
    assert.equal(useFinance.getState().holdings[0].avgCostCAD, 131.5);
  });

  test("a position with no basis yet is converted once, at the rate of the day", () => {
    useFinance.setState({ holdings: [usdHolding({ avgCostCAD: 0 })], usdCadRate: 1.5 });
    const h = useFinance.getState().holdings[0];
    useFinance.getState().updateHolding(h.id, {
      ticker: h.ticker,
      name: h.name,
      assetClass: h.assetClass,
      shares: h.shares,
      avgCost: h.avgCost,
      price: h.price,
      dividendsReceived: h.dividendsReceived,
      accountId: h.accountId,
      currency: h.currency,
    } as never);
    assert.equal(useFinance.getState().holdings[0].avgCostCAD, 150, "100 x 1.5, the one time the rate is right");
  });
});
