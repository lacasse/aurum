import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { coverage, driverPhrase, netWorthDriver, perMonth, watchList, type WatchInput } from "./story";

// INVENTED: every figure in this file is a round number chosen for the test.

describe("netWorthDriver", () => {
  test("names saving when it is at least twice what markets did", () => {
    assert.equal(netWorthDriver({ saved: 20000, revaluation: 5000 }), "saving");
  });

  test("names markets when they are at least twice what was saved", () => {
    assert.equal(netWorthDriver({ saved: 5000, revaluation: 30000 }), "markets");
  });

  test("names nothing when the two are close, rather than guessing", () => {
    assert.equal(netWorthDriver({ saved: 10000, revaluation: 8000 }), null);
  });

  test("a market fall that outweighs saving is still markets", () => {
    assert.equal(netWorthDriver({ saved: 5000, revaluation: -20000 }), "markets");
  });

  test("a year where nothing moved has no driver", () => {
    assert.equal(netWorthDriver({ saved: 0, revaluation: 0 }), null);
  });
});

describe("driverPhrase", () => {
  test("says a rise came from saving", () => {
    assert.equal(
      driverPhrase({ saved: 20000, revaluation: 2000, openingNetWorth: 100000, netWorth: 122000 }),
      "driven mainly by net savings",
    );
  });

  test("says a fall came from markets", () => {
    assert.equal(
      driverPhrase({ saved: 2000, revaluation: -30000, openingNetWorth: 100000, netWorth: 72000 }),
      "driven mainly by negative revaluation",
    );
  });

  test("says nothing when neither side dominates", () => {
    assert.equal(
      driverPhrase({ saved: 10000, revaluation: 9000, openingNetWorth: 100000, netWorth: 119000 }),
      null,
    );
  });
});

describe("watchList", () => {
  const steady: WatchInput = {
    runway: 8,
    spending: 3000,
    spendingBefore: 3000,
    income: 5000,
    incomeBefore: 5000,
    saved: 24000,
    debtOpening: 1000,
    debtClosing: 500,
    snapshotGaps: 0,
  };

  test("a steady record has nothing to say", () => {
    assert.deepEqual(watchList(steady), []);
  });

  test("thin cash is flagged, and under a month is a concern", () => {
    assert.equal(watchList({ ...steady, runway: 2 })[0].key, "runway");
    assert.equal(watchList({ ...steady, runway: 2 })[0].tone, "caution");
    assert.equal(watchList({ ...steady, runway: 0.5 })[0].tone, "concern");
  });

  test("spending up by a tenth is worth a line; a little up is not", () => {
    assert.equal(watchList({ ...steady, spending: 3300 })[0]?.key, "spending");
    assert.deepEqual(watchList({ ...steady, spending: 3100 }), []);
  });

  test("income down by a tenth is worth a line", () => {
    assert.equal(watchList({ ...steady, income: 4500 })[0]?.key, "income");
  });

  test("debt that grew is flagged; debt paid down is not", () => {
    assert.equal(watchList({ ...steady, debtClosing: 4000 })[0]?.key, "debt");
  });

  test("with nothing to compare against, no change is claimed", () => {
    assert.deepEqual(watchList({ ...steady, spendingBefore: null, incomeBefore: null }), []);
  });

  test("the worst news comes first", () => {
    const items = watchList({ ...steady, spending: 4000, saved: -2000, snapshotGaps: 2 });
    assert.equal(items[0].key, "overspent");
    assert.equal(items[0].tone, "concern");
  });
});

describe("coverage", () => {
  test("is passive income as a share of the floor", () => {
    assert.equal(coverage(500, 2000), 25);
  });

  test("stops at a hundred", () => {
    assert.equal(coverage(5000, 2000), 100);
  });

  test("has no answer without a floor", () => {
    assert.equal(coverage(500, 0), null);
  });
});

describe("perMonth", () => {
  test("divides by the months the window actually ran", () => {
    assert.equal(perMonth(36000, 12), 3000);
    assert.equal(perMonth(9000, 3), 3000);
    assert.equal(perMonth(1000, 0), 0);
  });
});
