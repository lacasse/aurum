import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { monthsToDate, yearToDate } from "./spans";

const months = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03"];
const today = new Date(2026, 2, 15);

describe("the year to date", () => {
  test("a level starts from the close the year opened on", () => {
    assert.deepEqual(yearToDate(months, (m) => m, { withBase: true }, today), [
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
    ]);
  });

  test("a flow is the year's own months only", () => {
    assert.deepEqual(yearToDate(months, (m) => m, { withBase: false }, today), [
      "2026-01",
      "2026-02",
      "2026-03",
    ]);
  });

  test("whole months are counted off the last complete one", () => {
    assert.equal(monthsToDate("2026-08"), 8);
    // January: the only complete months are last year's.
    assert.equal(monthsToDate("2025-12"), 12);
  });
});
