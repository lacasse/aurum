import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  DAY_RESERVE,
  MINUTE_RESERVE,
  dayKey,
  effectiveLimit,
  grantCredits,
  minuteKey,
  parseLedger,
  serializeLedger,
} from "./twelvedata-quota";

/*
 * No test here makes a network request. The allowance being protected is 8
 * credits a minute for the whole account, so a suite that exercised the real
 * endpoint would spend the very thing it exists to guard.
 */

const MIN = 8;
const DAY = 800;
// What is actually spendable once headroom is held back.
const MIN_CAP = MIN - MINUTE_RESERVE;
const DAY_CAP = DAY - DAY_RESERVE;

const AT = new Date("2026-08-28T13:30:00Z");

describe("window keys", () => {
  test("the minute window rolls at the top of each minute", () => {
    assert.equal(minuteKey(new Date("2026-08-28T13:30:59Z")), minuteKey(AT));
    assert.notEqual(minuteKey(new Date("2026-08-28T13:31:00Z")), minuteKey(AT));
  });

  test("the day window rolls at midnight UTC", () => {
    assert.equal(dayKey(new Date("2026-08-28T23:59:59Z")), dayKey(AT));
    assert.notEqual(dayKey(new Date("2026-08-29T00:00:00Z")), dayKey(AT));
  });
});

describe("effectiveLimit", () => {
  test("holds back headroom and never goes negative", () => {
    assert.equal(effectiveLimit(8, 1), 7);
    assert.equal(effectiveLimit(0, 1), 0, "a pinned-off limit must not wrap");
  });
});

describe("parseLedger", () => {
  test("reads both windows", () => {
    const value = `${minuteKey(AT)}:3|${dayKey(AT)}:120`;
    const l = parseLedger(value, AT);
    assert.equal(l.minute.used, 3);
    assert.equal(l.day.used, 120);
  });

  test("a window from an earlier minute has already reset", () => {
    const value = `${minuteKey(AT) - 1}:7|${dayKey(AT)}:120`;
    const l = parseLedger(value, AT);
    assert.equal(l.minute.used, 0, "last minute's spend does not restrict this one");
    assert.equal(l.day.used, 120, "the day window is untouched by that");
  });

  test("treats missing or malformed values as unused", () => {
    for (const value of [undefined, "", "garbage", "x:y|z:w", "5|"]) {
      const l = parseLedger(value, AT);
      assert.equal(l.minute.used, 0, `value ${String(value)}`);
      assert.equal(l.day.used, 0, `value ${String(value)}`);
    }
  });

  test("round-trips through serializeLedger", () => {
    const value = `${minuteKey(AT)}:3|${dayKey(AT)}:120`;
    assert.equal(serializeLedger(parseLedger(value, AT)), value);
  });
});

describe("grantCredits", () => {
  test("grants within both limits and records the spend", () => {
    const g = grantCredits(undefined, AT, 5, MIN, DAY);
    assert.equal(g.granted, true);
    assert.equal(g.ledger.minute.used, 5);
    assert.equal(g.ledger.day.used, 5);
  });

  test("refuses a batch that would breach the per-minute limit", () => {
    const at = `${minuteKey(AT)}:${MIN_CAP - 1}|${dayKey(AT)}:10`;
    assert.equal(grantCredits(at, AT, 1, MIN, DAY).granted, true, "the last credit fits");
    assert.equal(grantCredits(at, AT, 2, MIN, DAY).granted, false, "two do not");
  });

  test("is all-or-nothing: a refused batch does not part-spend", () => {
    const at = `${minuteKey(AT)}:${MIN_CAP}|${dayKey(AT)}:10`;
    const g = grantCredits(at, AT, 8, MIN, DAY);
    assert.equal(g.granted, false);
    assert.equal(g.ledger.minute.used, MIN_CAP, "the count did not move");
    assert.equal(g.nextValue, at);
  });

  test("refuses once the day is spent, even with the minute free", () => {
    const at = `${minuteKey(AT)}:0|${dayKey(AT)}:${DAY_CAP}`;
    assert.equal(grantCredits(at, AT, 1, MIN, DAY).granted, false);
  });

  test("repeated reservations stop exactly at the per-minute cap", () => {
    let value: string | undefined;
    let total = 0;
    for (let i = 0; i < 30; i++) {
      const g = grantCredits(value, AT, 1, MIN, DAY);
      if (g.granted) total += 1;
      value = g.nextValue;
    }
    assert.equal(total, MIN_CAP, `30 single-credit requests yield exactly ${MIN_CAP}`);
  });

  test("a new minute restores the allowance without resetting the day", () => {
    const spent = `${minuteKey(AT)}:${MIN_CAP}|${dayKey(AT)}:200`;
    const nextMinute = new Date(AT.getTime() + 60_000);
    const g = grantCredits(spent, nextMinute, 5, MIN, DAY);
    assert.equal(g.granted, true);
    assert.equal(g.ledger.day.used, 205, "the daily count carries over");
  });

  test("a zero limit blocks everything, which is how CI pins it off", () => {
    assert.equal(grantCredits(undefined, AT, 1, 0, DAY).granted, false);
    assert.equal(grantCredits(undefined, AT, 1, MIN, 0).granted, false);
  });

  test("ignores nonsense requests", () => {
    assert.equal(grantCredits(undefined, AT, 0, MIN, DAY).granted, false);
    assert.equal(grantCredits(undefined, AT, -5, MIN, DAY).granted, false);
  });
});
