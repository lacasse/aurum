import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { useFinance } from "./store";
import type { Holding } from "./types";

/*
 * A price refresh used to save the whole holding it had in memory. A tab
 * opened before the trades were corrected kept polling, and at the next price
 * tick wrote its old trades back over the correction. A quote has to reach
 * the price and nothing else.
 */

const holding = (over: Partial<Holding> = {}): Holding =>
  ({
    id: "h-1",
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
    avgCostCAD: 125,
    dividendsReceivedCAD: 0,
    historyCAD: [137.5, 150],
    flows: [{ date: "2024-01-10", kind: "buy", amount: 1250, shares: 10 }],
    ...over,
  }) as Holding;

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function captureRequests() {
  const sent: { url: string; method: string; body: unknown }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    sent.push({
      url: String(url),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  return sent;
}

describe("a price refresh records the price and nothing else", () => {
  test("only the quote is sent, never the holding", () => {
    const sent = captureRequests();
    useFinance.setState({ holdings: [holding()], usdCadRate: 1.5 });
    useFinance.getState().setHoldingPrice("h-1", 130);

    assert.equal(sent.length, 1);
    assert.equal(sent[0].method, "PATCH");
    assert.match(sent[0].url, /\/api\/holdings\/h-1$/);
    assert.deepEqual(sent[0].body, { price: 130, priceCAD: 195 });
  });

  test("trades, units and cost base are left exactly as they were", () => {
    captureRequests();
    const before = holding();
    useFinance.setState({ holdings: [before], usdCadRate: 1.5 });
    useFinance.getState().setHoldingPrice("h-1", 130);
    const after = useFinance.getState().holdings[0];

    assert.equal(after.price, 130);
    assert.equal(after.priceCAD, 195);
    assert.deepEqual(after.history, [110, 130]);
    assert.deepEqual(after.historyCAD, [137.5, 195]);
    assert.deepEqual(after.flows, before.flows);
    assert.equal(after.shares, before.shares);
    assert.equal(after.avgCost, before.avgCost);
    assert.equal(after.avgCostCAD, before.avgCostCAD);
  });

  test("a Canadian listing is its own Canadian price", () => {
    const sent = captureRequests();
    useFinance.setState({ holdings: [holding({ currency: "CAD", priceCAD: 120 })], usdCadRate: 1.5 });
    useFinance.getState().setHoldingPrice("h-1", 130);
    assert.deepEqual(sent[0].body, { price: 130, priceCAD: 130 });
  });
});
