import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { advanceRule, dueOccurrences, nextOccurrence } from "./recurrence";
import type { RecurringRule } from "./types";

function rule(over: Partial<RecurringRule> = {}): RecurringRule {
  return {
    id: "r1",
    type: "expense",
    amount: 100,
    category: "Housing",
    sourceAccountId: "a1",
    payee: "Landlord",
    frequency: "monthly",
    startDate: "2026-01-15",
    nextDate: "2026-01-15",
    active: true,
    ...over,
  };
}

describe("nextOccurrence", () => {
  test("advances by days for the week-based frequencies", () => {
    assert.equal(nextOccurrence("2026-01-15", "weekly", 15), "2026-01-22");
    assert.equal(nextOccurrence("2026-01-15", "biweekly", 15), "2026-01-29");
  });

  test("crosses month and year boundaries", () => {
    assert.equal(nextOccurrence("2026-01-28", "weekly", 28), "2026-02-04");
    assert.equal(nextOccurrence("2026-12-15", "monthly", 15), "2027-01-15");
    assert.equal(nextOccurrence("2026-12-31", "weekly", 31), "2027-01-07");
  });

  test("advances by months and years", () => {
    assert.equal(nextOccurrence("2026-01-15", "monthly", 15), "2026-02-15");
    assert.equal(nextOccurrence("2026-01-15", "quarterly", 15), "2026-04-15");
    assert.equal(nextOccurrence("2026-01-15", "yearly", 15), "2027-01-15");
  });

  test("clamps to the end of a short month, then returns to the anchor day", () => {
    // A rule anchored on the 31st must not drift down to the 28th forever.
    const feb = nextOccurrence("2026-01-31", "monthly", 31);
    assert.equal(feb, "2026-02-28");
    assert.equal(nextOccurrence(feb, "monthly", 31), "2026-03-31");
  });

  test("handles a leap day anniversary", () => {
    assert.equal(nextOccurrence("2028-02-29", "yearly", 29), "2029-02-28");
  });
});

describe("dueOccurrences", () => {
  test("returns nothing when the next date is still in the future", () => {
    assert.deepEqual(dueOccurrences(rule({ nextDate: "2026-09-15" }), "2026-08-27"), []);
  });

  test("catches up every occurrence missed since the last run", () => {
    const due = dueOccurrences(rule({ nextDate: "2026-05-15" }), "2026-08-27");
    assert.deepEqual(due, ["2026-05-15", "2026-06-15", "2026-07-15", "2026-08-15"]);
  });

  test("includes an occurrence falling exactly on today", () => {
    assert.deepEqual(dueOccurrences(rule({ nextDate: "2026-08-27" }), "2026-08-27"), [
      "2026-08-27",
    ]);
  });

  test("stops at the end date and ignores a paused rule", () => {
    assert.deepEqual(
      dueOccurrences(rule({ nextDate: "2026-05-15", endDate: "2026-06-30" }), "2026-08-27"),
      ["2026-05-15", "2026-06-15"],
    );
    assert.deepEqual(dueOccurrences(rule({ active: false }), "2026-08-27"), []);
  });

  test("bounds the catch-up so a mistyped start date cannot flood the ledger", () => {
    const due = dueOccurrences(
      rule({ frequency: "weekly", startDate: "1926-01-15", nextDate: "1926-01-15" }),
      "2026-08-27",
      400,
    );
    assert.equal(due.length, 400);
  });
});

describe("advanceRule", () => {
  test("moves the rule past everything it posted", () => {
    const r = rule({ nextDate: "2026-05-15" });
    const due = dueOccurrences(r, "2026-08-27");
    assert.deepEqual(advanceRule(r, due), { nextDate: "2026-09-15", active: true });
  });

  test("retires a rule once it passes its end date", () => {
    const r = rule({ nextDate: "2026-05-15", endDate: "2026-06-30" });
    const due = dueOccurrences(r, "2026-08-27");
    assert.deepEqual(advanceRule(r, due), { nextDate: "2026-07-15", active: false });
  });

  test("leaves an up-to-date rule where it is", () => {
    const r = rule({ nextDate: "2026-09-15" });
    assert.deepEqual(advanceRule(r, []), { nextDate: "2026-09-15", active: true });
  });
});
