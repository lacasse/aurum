import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { xirr } from "./xirr";

/** Within a tenth of a percentage point. */
function near(actual: number | null, expected: number, label: string) {
  assert.notEqual(actual, null, `${label}: expected a rate, got null`);
  assert.ok(
    Math.abs((actual as number) - expected) < 0.1,
    `${label}: expected ~${expected}%, got ${actual}%`,
  );
}

describe("xirr", () => {
  test("doubling in exactly one year is 100%", () => {
    near(
      xirr([
        { date: "2025-01-01", amount: -100 },
        { date: "2026-01-01", amount: 200 },
      ]),
      100,
      "doubled in a year",
    );
  });

  test("holding flat returns zero", () => {
    near(
      xirr([
        { date: "2025-01-01", amount: -100 },
        { date: "2026-01-01", amount: 100 },
      ]),
      0,
      "flat",
    );
  });

  test("a loss is negative", () => {
    const r = xirr([
      { date: "2025-01-01", amount: -100 },
      { date: "2026-01-01", amount: 50 },
    ]);
    near(r, -50, "halved in a year");
  });

  test("the same gain over a shorter time annualizes higher", () => {
    // This is the whole point of dropping the hardcoded 18-month window: a
    // 10% gain in three months is not a 10% annual return.
    const quick = xirr([
      { date: "2025-01-01", amount: -100 },
      { date: "2025-04-01", amount: 110 },
    ]) as number;
    const slow = xirr([
      { date: "2025-01-01", amount: -100 },
      { date: "2030-01-01", amount: 110 },
    ]) as number;
    assert.ok(quick > 40, `three-month 10% should annualize well above 40%, got ${quick}`);
    assert.ok(slow < 2, `the same 10% over five years should be tiny, got ${slow}`);
  });

  test("money added later is weighted less than money added early", () => {
    // Money-weighted, not time-weighted: when the contribution arrives matters.
    const early = xirr([
      { date: "2025-01-01", amount: -1000 },
      { date: "2026-01-01", amount: 1200 },
    ]) as number;
    const late = xirr([
      { date: "2025-01-01", amount: -100 },
      { date: "2025-11-01", amount: -900 },
      { date: "2026-01-01", amount: 1200 },
    ]) as number;
    assert.ok(late > early, `late funding should show a higher rate (${late} vs ${early})`);
  });

  test("dividends along the way raise the return", () => {
    const withDivs = xirr([
      { date: "2025-01-01", amount: -100 },
      { date: "2025-07-01", amount: 5 },
      { date: "2026-01-01", amount: 100 },
    ]) as number;
    assert.ok(withDivs > 4, `dividends should lift the rate, got ${withDivs}`);
  });

  test("several buys and a final value still solve", () => {
    const r = xirr([
      { date: "2024-01-15", amount: -1000 },
      { date: "2024-06-15", amount: -500 },
      { date: "2025-02-01", amount: 300 },
      { date: "2026-01-01", amount: 1500 },
    ]);
    assert.notEqual(r, null);
  });

  test("returns null rather than a misleading zero when there is nothing to measure", () => {
    assert.equal(xirr([]), null, "no flows");
    assert.equal(xirr([{ date: "2025-01-01", amount: -100 }]), null, "only an outflow");
    assert.equal(
      xirr([
        { date: "2025-01-01", amount: -100 },
        { date: "2025-01-01", amount: 150 },
      ]),
      null,
      "everything on one day has no period to annualize over",
    );
    assert.equal(
      xirr([
        { date: "2025-01-01", amount: -100 },
        { date: "2026-01-01", amount: -50 },
      ]),
      null,
      "money only ever went in",
    );
  });

  test("a total loss does not blow up", () => {
    const r = xirr([
      { date: "2025-01-01", amount: -100 },
      { date: "2026-01-01", amount: 0.01 },
    ]);
    assert.notEqual(r, null);
    assert.ok((r as number) < -99, `near-total loss should approach -100%, got ${r}`);
  });
});
