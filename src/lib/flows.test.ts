import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  allTrades,
  holdingAfterFlowEdit,
  replayFlows,
} from "./flows";
import { planTrades, type TradeInput } from "./trade-batch";
import type { CashFlow, Holding } from "./types";

const holding = (over: Partial<Holding> = {}): Holding =>
  ({
    id: "h1",
    ticker: "XEQT.TO",
    name: "XEQT",
    assetClass: "US Equity",
    shares: 0,
    avgCost: 0,
    price: 36,
    history: [],
    dividendsReceived: 0,
    accountId: "acct-1",
    currency: "CAD",
    priceCAD: 36,
    avgCostCAD: 0,
    dividendsReceivedCAD: 0,
    historyCAD: [],
    flows: [],
    ...over,
  }) as Holding;

const buy = (date: string, shares: number, amount: number): CashFlow => ({
  date,
  kind: "buy",
  amount,
  shares,
});
const sell = (date: string, shares: number, amount: number): CashFlow => ({
  date,
  kind: "sell",
  amount,
  shares: -shares,
});
const div = (date: string, amount: number): CashFlow => ({
  date,
  kind: "dividend",
  amount,
  shares: 0,
});

describe("replayFlows", () => {
  test("nothing recorded is a position of nothing", () => {
    assert.deepEqual(replayFlows([]), { shares: 0, avgCost: 0, dividends: 0 });
  });

  test("one buy prices itself", () => {
    const r = replayFlows([buy("2026-01-05", 10, 350)]);
    assert.equal(r.shares, 10);
    assert.equal(r.avgCost, 35);
  });

  test("a second buy averages against the first", () => {
    const r = replayFlows([buy("2026-01-05", 10, 350), buy("2026-02-05", 10, 450)]);
    assert.equal(r.shares, 20);
    assert.equal(r.avgCost, 40);
  });

  test("a sale takes shares off and leaves the average alone", () => {
    const r = replayFlows([
      buy("2026-01-05", 10, 350),
      buy("2026-02-05", 10, 450),
      sell("2026-03-05", 5, 250),
    ]);
    assert.equal(r.shares, 15);
    assert.equal(r.avgCost, 40);
  });

  test("dividends total up and touch neither shares nor cost", () => {
    const r = replayFlows([buy("2026-01-05", 10, 350), div("2026-04-01", 12.5)]);
    assert.equal(r.shares, 10);
    assert.equal(r.avgCost, 35);
    assert.equal(r.dividends, 12.5);
  });

  test("order is by date, not by position in the array", () => {
    /*
     * The June buy is stored first. Chronologically the January lot is bought
     * and wholly sold before June, so the position reopens at June's own price
     * of 60. Read in the order stored, the two lots would average to 50 and the
     * sale would come off that — which is the wrong cost base for shares still
     * held, and the reason the replay sorts.
     */
    const r = replayFlows([
      buy("2026-06-05", 10, 600),
      buy("2026-01-05", 10, 400),
      sell("2026-03-05", 10, 500),
    ]);
    assert.equal(r.shares, 10);
    assert.equal(r.avgCost, 60);
  });

  test("a position sold out and bought back starts its cost base again", () => {
    const r = replayFlows([
      buy("2026-01-05", 10, 400),
      sell("2026-03-05", 10, 500),
      buy("2026-06-05", 4, 320),
    ]);
    assert.equal(r.shares, 4);
    assert.equal(r.avgCost, 80);
  });

  test("a history that oversells clamps at nothing held", () => {
    const r = replayFlows([buy("2026-01-05", 10, 350), sell("2026-02-05", 25, 900)]);
    assert.equal(r.shares, 0);
  });

  test("agrees with what planTrades built", () => {
    /*
     * The two must not drift: a position built by importing trades and the
     * same position replayed here have to hold the same numbers, or an edit
     * on the transactions page would silently restate a portfolio.
     */
    const rows: TradeInput[] = [
      {
        date: "2026-01-05",
        action: "buy",
        ticker: "XEQT.TO",
        quantity: "10",
        price: "35",
        accountId: "acct-1",
        currency: "CAD",
        cadAmount: "",
      },
      {
        date: "2026-02-05",
        action: "buy",
        ticker: "XEQT.TO",
        quantity: "30",
        price: "45",
        accountId: "acct-1",
        currency: "CAD",
        cadAmount: "",
      },
      {
        date: "2026-03-05",
        action: "sell",
        ticker: "XEQT.TO",
        quantity: "12",
        price: "50",
        accountId: "acct-1",
        currency: "CAD",
        cadAmount: "",
      },
    ];
    const plan = planTrades(
      rows,
      [{ ticker: "XEQT.TO", name: "XEQT", assetClass: "US Equity" }],
      [],
      1.35,
    );
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    const change = plan.batch.changes[0];
    const replayed = replayFlows(change.flows);
    assert.equal(replayed.shares, change.shares);
    assert.equal(replayed.avgCost, change.avgCost);
    assert.equal(replayed.dividends, change.dividendsReceived);
  });
});

describe("holdingAfterFlowEdit", () => {
  const h = holding({
    flows: [buy("2026-01-05", 10, 350), buy("2026-02-05", 10, 450), div("2026-03-01", 20)],
  });

  test("removing a buy reprices what is left", () => {
    const next = holdingAfterFlowEdit(h, 1, null);
    assert.ok(next);
    assert.equal(next.flows.length, 2);
    assert.equal(next.shares, 10);
    assert.equal(next.avgCost, 35);
    assert.equal(next.dividends, 20);
  });

  test("correcting an amount reprices without changing the count", () => {
    const next = holdingAfterFlowEdit(h, 1, buy("2026-02-05", 10, 250));
    assert.ok(next);
    assert.equal(next.shares, 20);
    assert.equal(next.avgCost, 30);
  });

  test("removing the dividend clears it", () => {
    const next = holdingAfterFlowEdit(h, 2, null);
    assert.ok(next);
    assert.equal(next.dividends, 0);
    assert.equal(next.shares, 20);
  });

  test("an index that is not there changes nothing", () => {
    assert.equal(holdingAfterFlowEdit(h, 9, null), null);
    assert.equal(holdingAfterFlowEdit(holding(), 0, null), null);
  });
});

describe("allTrades", () => {
  test("flattens every position, newest first, keeping the way back", () => {
    const rows = allTrades([
      holding({ id: "a", ticker: "AAA", flows: [buy("2026-01-05", 1, 10)] }),
      holding({
        id: "b",
        ticker: "BBB",
        flows: [buy("2026-03-05", 2, 20), div("2026-02-05", 5)],
      }),
    ]);
    assert.deepEqual(
      rows.map((r) => [r.ticker, r.date, r.index]),
      [
        ["BBB", "2026-03-05", 0],
        ["BBB", "2026-02-05", 1],
        ["AAA", "2026-01-05", 0],
      ],
    );
  });

  test("a position with no trade history contributes none", () => {
    assert.equal(allTrades([holding({ flows: [] })]).length, 0);
  });
});
