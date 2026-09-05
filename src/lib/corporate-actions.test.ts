import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CorporateAction, applyAction, describeAction } from "./corporate-actions";
import type { Holding } from "./types";

const parent = {
  id: "h-spgi",
  ticker: "SPGI",
  name: "S&P Global",
  assetClass: "US Equity",
  shares: 16,
  avgCost: 500,
  avgCostCAD: 500,
  price: 600,
  priceCAD: 600,
  history: [],
  historyCAD: [],
  dividendsReceived: 0,
  dividendsReceivedCAD: 0,
  accountId: "acc-rrsp",
  currency: "USD",
  flows: [],
} as unknown as Holding;

const demerger: CorporateAction = {
  id: "a1",
  kind: "demerger",
  date: "2026-07-01",
  from: "SPGI",
  to: "MBGL",
  shares: 16,
  registration: "RRSP",
  registrationRaw: "RRSP",
  allocationPct: 0,
  include: true,
  sourceFile: "activities.csv",
};

describe("applyAction · demerger", () => {
  test("moves the published share of the cost basis to the new holding", () => {
    // 16 shares at $500 is $8,000 of basis; a 10% allocation carries $800.
    const applied = applyAction({ ...demerger, allocationPct: 10 }, parent);
    assert.ok(applied);
    assert.equal(applied.movedBasis, 800);
    assert.equal(applied.child.ticker, "MBGL");
    assert.equal(applied.child.shares, 16);
    assert.equal(applied.child.avgCostCAD, 50);
    // What is left stays with the parent, per share.
    assert.equal(applied.parent?.avgCostCAD, 450);
  });

  test("total cost basis is unchanged — it is divided, not created", () => {
    const applied = applyAction({ ...demerger, allocationPct: 37.5 }, parent);
    assert.ok(applied);
    const before = 16 * 500;
    const after =
      (applied.parent?.avgCostCAD ?? 0) * parent.shares +
      applied.child.avgCostCAD * applied.child.shares;
    assert.equal(after, before);
  });

  test("no allocation leaves the whole basis with the parent", () => {
    // Which is what the tax authorities assume when the company publishes
    // nothing: the new shares carry no cost, so their sale is all gain.
    const applied = applyAction(demerger, parent);
    assert.ok(applied);
    assert.equal(applied.movedBasis, 0);
    assert.equal(applied.child.avgCostCAD, 0);
    assert.equal(applied.parent?.avgCostCAD, 500);
  });

  test("the new shares arrive with a flow, so the position has a history", () => {
    const applied = applyAction({ ...demerger, allocationPct: 10 }, parent);
    assert.equal(applied?.child.flow.kind, "buy");
    assert.equal(applied?.child.flow.date, "2026-07-01");
    assert.equal(applied?.child.flow.shares, 16);
    assert.equal(applied?.child.flow.amount, 800);
  });

  test("an allocation outside 0–100 is clamped rather than trusted", () => {
    assert.equal(applyAction({ ...demerger, allocationPct: 250 }, parent)?.movedBasis, 8000);
    assert.equal(applyAction({ ...demerger, allocationPct: -5 }, parent)?.movedBasis, 0);
  });

  test("nothing to divide when the parent is not held", () => {
    assert.equal(applyAction(demerger, undefined), null);
  });
});

describe("applyAction · merger", () => {
  const merger: CorporateAction = {
    ...demerger,
    kind: "merger",
    from: "SPGI",
    to: "NEWCO",
    shares: 8,
    allocationPct: 100,
  };

  test("the whole cost basis rolls into the new shares", () => {
    const applied = applyAction(merger, parent);
    assert.ok(applied);
    assert.equal(applied.movedBasis, 8000);
    // Half as many shares, so twice the cost each: nothing was realized.
    assert.equal(applied.child.shares, 8);
    assert.equal(applied.child.avgCostCAD, 1000);
    assert.equal(applied.parent?.avgCostCAD, 0);
  });
});

describe("describeAction", () => {
  test("says plainly what an unallocated demerger means", () => {
    const text = describeAction(demerger, 0);
    assert.match(text, /no cost basis moves/);
    assert.match(text, /gain when sold/);
  });

  test("names the amount when there is an allocation", () => {
    const text = describeAction({ ...demerger, allocationPct: 10 }, 800);
    assert.match(text, /10%/);
    assert.match(text, /800\.00/);
  });
});

describe("an action and a trade on the same position", () => {
  /*
   * The bug this guards: a demerger reduces the parent's cost base, and a
   * dividend on that same parent in the same import was planned against the
   * holdings as they were *before* the action. Writing that plan afterwards
   * restored the parent's old basis, while the child kept the basis the action
   * had moved to it — so the two together held more cost than the position ever
   * had. On real data that invented $455 of cost base out of nothing.
   *
   * The fix is ordering: whatever plans the trades has to see the positions the
   * actions left behind. This asserts the arithmetic that makes that visible.
   */
  const spgi: Holding = {
    id: "p1",
    ticker: "SPGI",
    name: "S&P Global",
    assetClass: "US Equity",
    shares: 16,
    avgCost: 580.541265,
    price: 443.47,
    history: [],
    dividendsReceived: 0,
    accountId: "rrsp",
    currency: "USD",
    priceCAD: 443.47,
    avgCostCAD: 580.541265,
    dividendsReceivedCAD: 0,
    historyCAD: [],
    flows: [],
  } as Holding;

  const action: CorporateAction = {
    id: "a1",
    kind: "demerger",
    date: "2026-07-01",
    from: "SPGI",
    to: "MBGL",
    shares: 16,
    registration: "RRSP",
    registrationRaw: "RRSP",
    allocationPct: 4.9004,
    include: true,
    sourceFile: "acts.csv",
  };

  test("cost basis is conserved: what leaves the parent is what reaches the child", () => {
    const before = spgi.shares * spgi.avgCostCAD;
    const applied = applyAction(action, spgi);
    assert.ok(applied);
    assert.ok(applied.parent);
    const parentAfter = applied.parent.avgCostCAD * spgi.shares;
    const childAfter = applied.child.avgCostCAD * applied.child.shares;
    // Within a cent of rounding, nothing is created and nothing is lost.
    assert.ok(
      Math.abs(before - (parentAfter + childAfter)) < 0.05,
      `basis before ${before}, after ${parentAfter} + ${childAfter}`,
    );
  });

  test("the parent's basis actually comes down", () => {
    const applied = applyAction(action, spgi);
    assert.ok(applied?.parent);
    assert.ok(
      applied.parent.avgCostCAD < spgi.avgCostCAD,
      "a demerger that leaves the parent untouched has created cost from nothing",
    );
  });
});
