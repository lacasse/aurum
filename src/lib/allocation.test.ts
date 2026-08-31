import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { drift } from "./allocation";

const positions = [
  { ticker: "BTC", name: "Bitcoin", marketValue: 6000 },
  { ticker: "CAGE.TO", name: "Global Equity", marketValue: 3000 },
  { ticker: "SOL", name: "Solana", marketValue: 1000 },
];

describe("drift", () => {
  test("says the gap in points and in money", () => {
    // 60% held against a 20% target, on a $10,000 portfolio.
    const { rows } = drift(positions, { BTC: 20, "CAGE.TO": 70, SOL: 10 });
    const btc = rows.find((r) => r.ticker === "BTC");
    assert.equal(btc?.actualPct, 60);
    assert.equal(btc?.driftPct, 40);
    assert.equal(btc?.driftValue, 4000, "$4,000 more than intended");
  });

  test("under target is a negative drift, not an absent one", () => {
    const { rows } = drift(positions, { "CAGE.TO": 70 });
    const cage = rows.find((r) => r.ticker === "CAGE.TO");
    assert.equal(cage?.driftPct, -40);
    assert.equal(cage?.driftValue, -4000);
  });

  test("a holding with no target is left without a comparison", () => {
    const { rows, untargeted } = drift(positions, { BTC: 100 });
    assert.equal(untargeted, 2);
    const sol = rows.find((r) => r.ticker === "SOL");
    assert.equal(sol?.targetPct, null);
    assert.equal(sol?.driftValue, null);
  });

  test("tickers match whatever case they were typed in", () => {
    const { rows } = drift(positions, { btc: 20 });
    assert.equal(rows.find((r) => r.ticker === "BTC")?.targetPct, 20);
  });

  test("a target of zero means hold none, which is not the same as no target", () => {
    const { rows, untargeted } = drift(positions, { BTC: 0, "CAGE.TO": 100 });
    const btc = rows.find((r) => r.ticker === "BTC");
    assert.equal(btc?.targetPct, 0);
    assert.equal(btc?.driftValue, 6000, "all of it is above target");
    assert.equal(untargeted, 1, "only SOL has no target");
  });

  test("targets are totalled so a plan that does not add to 100 can say so", () => {
    assert.equal(drift(positions, { BTC: 20, SOL: 5 }).targetTotal, 25);
  });

  test("a target for something sold still counts towards the total", () => {
    // Dropping it would make the plan quietly add up to less than all of it.
    assert.equal(drift(positions, { BTC: 40, GONE: 60 }).targetTotal, 100);
  });

  test("the overweight total is what rebalancing would have to sell", () => {
    const { overweight } = drift(positions, { BTC: 20, "CAGE.TO": 70, SOL: 10 });
    assert.equal(overweight, 4000);
  });

  test("an empty portfolio divides by nothing", () => {
    const { rows } = drift([{ ticker: "BTC", name: "Bitcoin", marketValue: 0 }], { BTC: 100 });
    assert.equal(rows[0].actualPct, 0);
    assert.equal(rows[0].driftValue, 0);
  });
});
