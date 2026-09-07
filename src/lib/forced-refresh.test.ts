import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { grantCredits, parseLedger } from "./twelvedata-quota";
import { grant, usedFrom } from "./eodhd-quota";

/*
 * A forced refresh is the user saying "spend it anyway".
 *
 * The limits exist so the app cannot quietly exhaust a day of calls on its own
 * schedule. They are not a reason to refuse someone who has been shown the cost
 * and asked for the price regardless. What the override must not do is hide the
 * spending: the ledger is how the next automatic refresh knows what is left.
 */

const NOW = new Date("2026-09-07T12:00:00Z");
const DAY = "2026-09-07";

describe("Twelve Data, forced", () => {
  // A limit of 8 keeps one credit in reserve, so 7 is all an ordinary refresh
  // may spend in a minute. That reserve is the point of effectiveLimit.
  const FULL = grantCredits(undefined, NOW, 7, 8, 800).nextValue;

  test("the per-minute limit stops an ordinary refresh", () => {
    assert.equal(grantCredits(FULL, NOW, 1, 8, 800).granted, false);
  });

  test("and does not stop a forced one", () => {
    assert.equal(grantCredits(FULL, NOW, 1, 8, 800, true).granted, true);
  });

  test("what a forced refresh spends is still recorded", () => {
    const after = grantCredits(FULL, NOW, 3, 8, 800, true);
    const ledger = parseLedger(after.nextValue, NOW);
    assert.equal(ledger.minute.used, 10, "7 within the limit, plus 3 over it");
    assert.equal(ledger.day.used, 10, "the day's tally moved too");
  });

  test("forcing zero credits still grants nothing", () => {
    assert.equal(grantCredits(undefined, NOW, 0, 8, 800, true).granted, false);
  });
});

describe("EODHD, forced", () => {
  test("the day's cap grants only what is left, ordinarily", () => {
    const spent = grant(undefined, DAY, 20, 20).nextValue;
    assert.equal(grant(spent, DAY, 5, 20).granted, 0);
  });

  test("a forced refresh gets everything it asks for", () => {
    const spent = grant(undefined, DAY, 20, 20).nextValue;
    assert.equal(grant(spent, DAY, 5, 20, true).granted, 5);
  });

  test("and the overspend is written down, not hidden", () => {
    const spent = grant(undefined, DAY, 20, 20).nextValue;
    const after = grant(spent, DAY, 5, 20, true);
    assert.equal(usedFrom(after.nextValue, DAY), 25, "over the cap, and visibly so");
  });

  test("tomorrow starts clean regardless", () => {
    const over = grant(undefined, DAY, 25, 20, true).nextValue;
    assert.equal(usedFrom(over, "2026-09-08"), 0);
  });
});
