import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { awaitingPrice, priceReward, rewardFlows } from "./rewards";
import { replayFlows } from "./analytics";
import type { CashFlow, Holding } from "./types";

describe("rewardFlows", () => {
  test("a valued reward is income and an acquisition for the same amount", () => {
    const flows = rewardFlows("2024-03-15", 26, 5980);
    assert.deepEqual(flows, [
      { date: "2024-03-15", kind: "dividend", amount: 5980, shares: 0 },
      { date: "2024-03-15", kind: "buy", amount: 5980, shares: 26 },
    ]);
  });

  test("the cost base rises by what the tokens were worth", () => {
    // Which is the whole point: taxed once as income, and not again as a gain.
    const { costCAD, shares, dividendsCAD } = replayFlows(
      rewardFlows("2024-03-15", 26, 5980),
    );
    assert.equal(costCAD, 5980);
    assert.equal(shares, 26);
    assert.equal(dividendsCAD, 5980);
  });

  test("no price yet records the units and asks for the figure", () => {
    const flows = rewardFlows("2024-03-15", 26, 0);
    assert.equal(flows.length, 1, "no income flow: nobody has said what it was worth");
    assert.equal(flows[0].kind, "buy");
    assert.equal(flows[0].awaitingPrice, true);
  });

  test("a priced reward carries no flag", () => {
    assert.equal(rewardFlows("2024-03-15", 26, 5980)[1].awaitingPrice, undefined);
  });
});

describe("awaitingPrice", () => {
  const holding = (id: string, ticker: string, flows: CashFlow[]) =>
    ({ id, ticker, name: ticker, flows }) as unknown as Holding;

  test("finds the rewards with no value, oldest first", () => {
    const found = awaitingPrice([
      holding("h1", "SOL", [
        { date: "2025-05-20", kind: "buy", amount: 0, shares: 50, awaitingPrice: true },
        { date: "2024-03-15", kind: "buy", amount: 0, shares: 26, awaitingPrice: true },
        { date: "2022-02-01", kind: "buy", amount: 73385.47, shares: 482.45 },
      ]),
      holding("h2", "ETH", [{ date: "2023-01-01", kind: "buy", amount: 100, shares: 1 }]),
    ]);
    assert.deepEqual(
      found.map((r) => `${r.date} ${r.units} ${r.ticker}`),
      ["2024-03-15 26 SOL", "2025-05-20 50 SOL"],
    );
  });

  test("nothing pending is an empty list, not a card", () => {
    assert.deepEqual(awaitingPrice([]), []);
  });
});

describe("priceReward", () => {
  const flows: CashFlow[] = [
    { date: "2022-02-01", kind: "buy", amount: 73385.47, shares: 482.45 },
    { date: "2024-03-15", kind: "buy", amount: 0, shares: 26, awaitingPrice: true },
    { date: "2025-05-20", kind: "buy", amount: 0, shares: 50, awaitingPrice: true },
  ];

  test("fills one reward in, and leaves the others alone", () => {
    const out = priceReward(flows, "2024-03-15", 26, 5980);
    assert.equal(out.length, 4);
    assert.deepEqual(out[1], { date: "2024-03-15", kind: "dividend", amount: 5980, shares: 0 });
    assert.deepEqual(out[2], { date: "2024-03-15", kind: "buy", amount: 5980, shares: 26 });
    assert.equal(out[3].awaitingPrice, true, "the 2025 reward still needs its figure");
  });

  test("the cost base and the income both move", () => {
    const before = replayFlows(flows);
    const after = replayFlows(priceReward(flows, "2024-03-15", 26, 5980));
    assert.equal(after.costCAD - before.costCAD, 5980);
    assert.equal(after.dividendsCAD - before.dividendsCAD, 5980);
    assert.equal(after.shares, before.shares, "no units were created");
  });

  test("a reward on the same day as another is matched by quantity", () => {
    const sameDay: CashFlow[] = [
      { date: "2024-03-15", kind: "buy", amount: 0, shares: 10, awaitingPrice: true },
      { date: "2024-03-15", kind: "buy", amount: 0, shares: 16, awaitingPrice: true },
    ];
    const out = priceReward(sameDay, "2024-03-15", 16, 3680);
    assert.equal(out.find((f) => f.shares === 10)?.awaitingPrice, true);
    assert.equal(out.filter((f) => f.kind === "dividend").length, 1);
  });

  test("a value of zero changes nothing rather than clearing the flag", () => {
    assert.deepEqual(priceReward(flows, "2024-03-15", 26, 0), flows);
  });
});
