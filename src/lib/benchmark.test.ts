import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MAX_FILL_MONTHS, missingMonths, nextMonth, parseMonthlyBars } from "./benchmark";

describe("missingMonths", () => {
  test("nothing is missing when the series is current", () => {
    assert.deepEqual(missingMonths("2026-08", "2026-08"), [], "must cost no call");
  });

  test("lists the completed months after the last stored", () => {
    assert.deepEqual(missingMonths("2026-07", "2026-10"), ["2026-08", "2026-09"]);
  });

  test("the month in progress is not fetched", () => {
    // Its close does not exist yet; the checklist records it at month end.
    assert.deepEqual(missingMonths("2026-07", "2026-08"), []);
  });

  test("crosses a year boundary", () => {
    assert.deepEqual(missingMonths("2026-11", "2027-02"), ["2026-12", "2027-01"]);
  });

  test("stops at what the provider can actually serve", () => {
    const gap = missingMonths("2020-01", "2026-08");
    assert.equal(gap.length, MAX_FILL_MONTHS);
    assert.equal(gap[0], "2020-02");
    assert.equal(gap[gap.length - 1], "2021-01");
  });

  test("an empty series is not a gap to fill", () => {
    // Nothing stored means the shipped migration has not run; fetching a
    // decade one year at a time is not the answer to that.
    assert.deepEqual(missingMonths(null, "2026-08"), []);
  });

  test("nextMonth rolls the year", () => {
    assert.equal(nextMonth("2026-12"), "2027-01");
    assert.equal(nextMonth("2026-01"), "2026-02");
  });
});

describe("parseMonthlyBars", () => {
  test("keys a monthly bar by its month and takes the close", () => {
    const bars = parseMonthlyBars([
      { date: "2026-07-02", close: 44.8 },
      { date: "2026-08-04", close: 45.92 },
    ]);
    assert.deepEqual([...bars], [["2026-07", 44.8], ["2026-08", 45.92]]);
  });

  test("skips bars with no usable close", () => {
    const bars = parseMonthlyBars([
      { date: "2026-07-02", close: 0 },
      { date: "2026-08-04" },
      { date: "2026-09-01", close: 46.1 },
    ]);
    assert.deepEqual([...bars], [["2026-09", 46.1]]);
  });

  test("an error payload is an empty map, not a throw", () => {
    assert.equal(parseMonthlyBars({ Message: "nope" }).size, 0);
    assert.equal(parseMonthlyBars(null).size, 0);
  });
});
