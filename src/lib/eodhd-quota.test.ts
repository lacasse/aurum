import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  grant,
  resetsAt,
  selectEodhdDue,
  usedFrom,
  utcDay,
  validateLimit,
} from "./eodhd-quota";

/*
 * These tests never make a network request. That is the point: the allowance
 * being protected is 20 calls a day for the whole account, so a test suite that
 * exercised the real endpoint would spend the very thing it is guarding.
 */

const LIMIT = 20;

describe("utcDay", () => {
  test("keys on the UTC date, since that is when EODHD resets", () => {
    assert.equal(utcDay(new Date("2026-08-28T23:59:59Z")), "2026-08-28");
    assert.equal(utcDay(new Date("2026-08-29T00:00:00Z")), "2026-08-29");
  });

  test("late-evening local time in the west is already the next UTC day", () => {
    // 20:30 in Toronto on the 28th is 00:30 UTC on the 29th — a fresh allowance.
    assert.equal(utcDay(new Date("2026-08-29T00:30:00Z")), "2026-08-29");
  });
});

describe("resetsAt", () => {
  test("is the next midnight GMT", () => {
    assert.equal(resetsAt(new Date("2026-08-28T13:00:00Z")), "2026-08-29T00:00:00.000Z");
    assert.equal(resetsAt(new Date("2026-08-28T00:00:00Z")), "2026-08-29T00:00:00.000Z");
  });
});

describe("usedFrom", () => {
  test("reads the count for today", () => {
    assert.equal(usedFrom("2026-08-28:7", "2026-08-28"), 7);
  });

  test("treats another day's ledger as a fresh allowance", () => {
    assert.equal(usedFrom("2026-08-27:20", "2026-08-28"), 0);
  });

  test("treats a missing or malformed ledger as unused", () => {
    for (const value of [undefined, "", "garbage", "2026-08-28:", "2026-08-28:abc"]) {
      assert.equal(usedFrom(value, "2026-08-28"), 0, `value ${String(value)}`);
    }
  });
});

describe("grant", () => {
  const today = "2026-08-28";

  test("grants what is asked for when the day is untouched", () => {
    const g = grant(undefined, today, 5, LIMIT);
    assert.equal(g.granted, 5);
    assert.equal(g.nextValue, `${today}:5`);
  });

  test("never grants beyond the daily limit", () => {
    assert.equal(grant(undefined, today, 500, LIMIT).granted, LIMIT);
    assert.equal(grant(`${today}:19`, today, 500, LIMIT).granted, 1);
  });

  test("grants partially rather than refusing outright", () => {
    // 219 holdings and 6 calls left should still refresh six of them.
    const g = grant(`${today}:14`, today, 219, LIMIT);
    assert.equal(g.granted, 6);
    assert.equal(g.nextValue, `${today}:20`);
  });

  test("grants nothing once the allowance is spent", () => {
    const g = grant(`${today}:20`, today, 10, LIMIT);
    assert.equal(g.granted, 0);
    assert.equal(g.nextValue, `${today}:20`, "a refused request must not inflate the count");
  });

  test("a full ledger from yesterday does not restrict today", () => {
    assert.equal(grant("2026-08-27:20", today, 20, LIMIT).granted, 20);
  });

  test("repeated reservations accumulate up to the cap and then stop", () => {
    let value: string | undefined;
    let total = 0;
    for (let i = 0; i < 30; i++) {
      const g = grant(value, today, 1, LIMIT);
      total += g.granted;
      value = g.nextValue;
    }
    assert.equal(total, LIMIT, "30 single-call requests yield exactly 20 calls");
    assert.equal(value, `${today}:20`);
  });

  test("a zero or negative limit blocks everything", () => {
    assert.equal(grant(undefined, today, 5, 0).granted, 0);
  });

  test("ignores nonsense requests", () => {
    assert.equal(grant(undefined, today, 0, LIMIT).granted, 0);
    assert.equal(grant(undefined, today, -5, LIMIT).granted, 0);
  });
});

describe("selectEodhdDue", () => {
  const today = "2026-08-28";
  const items = ["A", "B", "C", "D"].map((ticker) => ({ ticker }));

  test("skips tickers already priced today", () => {
    const seen = new Map([["A", today], ["C", today]]);
    assert.deepEqual(
      selectEodhdDue(items, seen, today).map((i) => i.ticker),
      ["B", "D"],
    );
  });

  test("spends the allowance on the longest-stale first", () => {
    const seen = new Map([
      ["A", "2026-08-27"],
      ["B", "2026-08-20"],
      ["C", "2026-08-25"],
      // D has never been fetched
    ]);
    assert.deepEqual(
      selectEodhdDue(items, seen, today).map((i) => i.ticker),
      ["D", "B", "C", "A"],
    );
  });

  test("returns nothing once everything has been priced today", () => {
    const seen = new Map(items.map((i) => [i.ticker, today]));
    assert.deepEqual(selectEodhdDue(items, seen, today), []);
  });

  test("rotates: yesterday's refreshed tickers go to the back of the queue", () => {
    // 4 holdings, 2 calls a day. Day one prices A and B…
    const budget = 2;
    const seen = new Map<string, string>();
    const day1 = selectEodhdDue(items, seen, "2026-08-27").slice(0, budget);
    assert.deepEqual(day1.map((i) => i.ticker), ["A", "B"]);
    for (const i of day1) seen.set(i.ticker, "2026-08-27");
    // …so day two must reach the two that were missed, not repeat A and B.
    const day2 = selectEodhdDue(items, seen, "2026-08-28").slice(0, budget);
    assert.deepEqual(day2.map((i) => i.ticker), ["C", "D"]);
  });
});

describe("validateLimit", () => {
  test("holds calls back from type-ahead validation", () => {
    assert.equal(validateLimit(20, 5), 15);
  });

  test("validation stops while the refresh can still spend", () => {
    // 16 calls gone: past validation's ceiling, but the price refresh — which
    // draws on the full allowance — still has four to reach stale holdings.
    const today = "2026-08-28";
    const ledger = `${today}:16`;
    assert.equal(grant(ledger, today, 1, validateLimit(20, 5)).granted, 0);
    assert.equal(grant(ledger, today, 1, 20).granted, 1);
  });

  test("never goes negative, so a pinned limit cannot invert the budget", () => {
    // CI pins EODHD_DAY_LIMIT to 0; a naive subtraction would give -5, and a
    // negative ceiling is not a smaller budget, it is an unguarded one.
    assert.equal(validateLimit(0, 5), 0);
    assert.equal(validateLimit(3, 5), 0);
    assert.equal(validateLimit(20, -5), 20);
  });

  test("a zeroed validation budget grants nothing", () => {
    assert.equal(grant(undefined, "2026-08-28", 1, validateLimit(0, 5)).granted, 0);
  });
});
