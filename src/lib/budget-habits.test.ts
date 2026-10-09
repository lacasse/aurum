import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  averageBudgets,
  effectiveLimits,
  followsAverage,
  setFollowing,
  budgetHistory,
  budgetStreak,
  categoryStreak,
  judgedMonths,
  personalBests,
  yearReview,
} from "./budget-habits";
import type { Transaction } from "./types";

let n = 0;
const txn = (date: string, amount: number, category: string): Transaction =>
  ({
    id: `t${n++}`,
    date,
    type: "expense",
    amount,
    category,
    payee: "x",
  }) as unknown as Transaction;

const key = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;

/** A year of groceries at 400, with chosen months at another amount. */
const groceries = (year: number, overrides: Record<number, number> = {}) => {
  const out: Transaction[] = [];
  for (let m = 1; m <= 12; m++) {
    out.push(txn(`${key(year, m)}-10`, overrides[m] ?? 400, "Groceries"));
    out.push(txn(`${key(year, m)}-05`, 1000, "Housing"));
  }
  return out;
};

describe("budgetHistory", () => {
  test("counts only budgeted categories, against today's limits", () => {
    const tx = groceries(2025, { 3: 600 });
    const h = budgetHistory(tx, new Map([["Groceries", 500]]), ["2025-02", "2025-03"]);
    assert.equal(h[0].spent, 400);
    assert.equal(h[0].under, true);
    assert.equal(h[1].under, false);
    assert.equal(h[1].categories.Groceries.under, false);
  });

  test("no budgets means no history", () => {
    assert.deepEqual(budgetHistory(groceries(2025), new Map(), ["2025-01"]), []);
  });
});

describe("budgetStreak", () => {
  const limits = new Map([["Groceries", 500]]);
  const months = [7, 8, 9, 10, 11, 12].map((m) => key(2025, m));

  test("counts every month under budget in a row, back from the newest", () => {
    const s = budgetStreak(budgetHistory(groceries(2025), limits, months));
    assert.deepEqual(s, { run: 6, judged: 6 });
  });

  test("a month over ends it", () => {
    const tx = groceries(2025, { 9: 900 });
    const s = budgetStreak(budgetHistory(tx, limits, months));
    assert.deepEqual(s, { run: 3, judged: 6 });
  });

  test("the newest month over is a streak of nothing", () => {
    const tx = groceries(2025, { 12: 900 });
    const s = budgetStreak(budgetHistory(tx, limits, months));
    assert.deepEqual(s, { run: 0, judged: 6 });
  });

  test("no months judged, nothing to count", () => {
    assert.deepEqual(budgetStreak([]), { run: 0, judged: 0 });
  });
});

describe("the monthly streak, per category", () => {
  const limits = new Map([
    ["Groceries", 500],
    ["Dining", 200],
  ]);
  const all = Array.from({ length: 12 }, (_, i) => key(2025, i + 1));
  const dots = (tx: Transaction[], category: string, months = all) =>
    categoryStreak(budgetHistory(tx, limits, months), category);
  const marks = (d: ReturnType<typeof dots>) => d.map((x) => (x.under ? "o" : "x")).join("");

  test("the last six months, oldest first", () => {
    const d = dots(groceries(2025), "Groceries");
    assert.deepEqual(
      d.map((x) => x.key),
      ["2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12"],
    );
    assert.equal(marks(d), "oooooo");
  });

  test("a month over is marked in its own place", () => {
    assert.equal(marks(dots(groceries(2025, { 9: 501 }), "Groceries")), "ooxooo");
  });

  test("every month over", () => {
    const over = Object.fromEntries(all.map((_, i) => [i + 1, 900]));
    assert.equal(marks(dots(groceries(2025, over), "Groceries")), "xxxxxx");
  });

  test("exactly at the limit is within it", () => {
    assert.equal(marks(dots(groceries(2025, { 12: 500 }), "Groceries")), "oooooo");
  });

  test("a cent over is over", () => {
    assert.equal(marks(dots(groceries(2025, { 12: 500.01 }), "Groceries")), "ooooox");
  });

  test("several purchases add up within the month", () => {
    const tx = [...groceries(2025, { 12: 300 }), txn("2025-12-20", 250, "Groceries")];
    assert.equal(marks(dots(tx, "Groceries")), "ooooox");
  });

  test("a month with nothing spent in the category is a month kept", () => {
    // Dining has no transactions at all, but the months are on record.
    const d = dots(groceries(2025), "Dining");
    assert.equal(marks(d), "oooooo");
    assert.ok(d.every((x) => x.spent === 0 && x.limit === 200));
  });

  test("each category is judged on its own", () => {
    const tx = [...groceries(2025), txn("2025-11-02", 260, "Dining")];
    assert.equal(marks(dots(tx, "Groceries")), "oooooo");
    assert.equal(marks(dots(tx, "Dining")), "ooooxo");
  });

  test("a short record shows fewer dots, not empty ones", () => {
    const d = dots(groceries(2025), "Groceries", ["2025-11", "2025-12"]);
    assert.equal(d.length, 2);
  });

  test("a category without a budget has no streak", () => {
    assert.deepEqual(dots(groceries(2025), "Housing"), []);
  });

  test("no budgets at all, no dots", () => {
    assert.deepEqual(categoryStreak(budgetHistory(groceries(2025), new Map(), all), "Groceries"), []);
  });

  test("today's budget judges the past: raising a limit turns old misses into kept months", () => {
    const tx = groceries(2025, { 10: 700 });
    assert.equal(marks(dots(tx, "Groceries")), "oooxoo");
    const raised = categoryStreak(budgetHistory(tx, new Map([["Groceries", 800]]), all), "Groceries");
    assert.equal(marks(raised), "oooooo");
  });
});

describe("judgedMonths", () => {
  const months = ["2025-10", "2025-11", "2025-12", "2026-01"];

  test("up to and including the month being read", () => {
    assert.deepEqual(judgedMonths(months, "2025-12", "2026-03"), ["2025-10", "2025-11", "2025-12"]);
  });

  test("never the month still running, even when it is the one being read", () => {
    assert.deepEqual(judgedMonths(months, "2026-01", "2026-01"), ["2025-10", "2025-11", "2025-12"]);
  });

  test("a gap in the record is skipped, not counted as a month", () => {
    assert.deepEqual(judgedMonths(["2025-08", "2025-10"], "2025-10", "2026-01"), ["2025-08", "2025-10"]);
  });

  test("looking back before the record begins judges nothing", () => {
    assert.deepEqual(judgedMonths(months, "2025-09", "2026-03"), []);
  });
});

describe("personalBests", () => {
  test("a regular category beating every month behind it", () => {
    const tx = groceries(2025, { 12: 250 });
    const b = personalBests(tx, "2025-12");
    assert.deepEqual(b, [{ category: "Groceries", amount: 250, months: 11 }]);
  });

  test("a tie is not a best, and nor is a short record", () => {
    assert.deepEqual(personalBests(groceries(2025), "2025-12"), []);
    assert.deepEqual(personalBests(groceries(2025, { 4: 100 }), "2025-04"), []);
  });

  test("an occasional category does not qualify by being absent", () => {
    const tx = [...groceries(2025), txn("2025-02-01", 300, "Travel"), txn("2025-12-01", 10, "Travel")];
    assert.ok(!personalBests(tx, "2025-12").some((b) => b.category === "Travel"));
  });
});

describe("yearReview", () => {
  test("reads the year against the one before", () => {
    const tx = [...groceries(2024), ...groceries(2025, { 6: 100 })];
    const r = yearReview(tx, 2025, {}, new Map([["Groceries", 450]]), "2026-01");
    assert.equal(r.months, 12);
    assert.equal(r.total, 12 * 1400 - 300);
    assert.equal(r.previousTotal, 12 * 1400);
    assert.deepEqual(r.cheapest, { key: "2025-06", total: 1100 });
    assert.equal(r.improved?.category, "Groceries");
    assert.equal(r.largest?.category, "Housing");
    assert.equal(r.judged, 12);
    assert.equal(r.monthsUnder, 12);
    // 11 months 50 under, one month 350 under.
    assert.equal(r.kept, 11 * 50 + 350);
  });

  test("a month still running is not judged", () => {
    const r = yearReview(groceries(2025), 2025, {}, new Map([["Groceries", 450]]), "2025-12");
    assert.equal(r.judged, 11);
  });
});

describe("averageBudgets", () => {
  test("each category's last twelve finished months, divided by twelve, to the dollar", () => {
    const tx = [...groceries(2024), ...groceries(2025, { 6: 100 })];
    const b = averageBudgets(tx, {}, "2026-01");
    assert.equal(b.get("Housing"), 1000);
    // Eleven months at 400 and one at 100.
    assert.equal(b.get("Groceries"), Math.round((11 * 400 + 100) / 12));
  });

  test("a month still running is left out", () => {
    const tx = [...groceries(2025), txn("2026-01-03", 5000, "Groceries")];
    assert.equal(averageBudgets(tx, {}, "2026-01").get("Groceries"), 400);
  });

  test("a short record divides by the months it has", () => {
    const tx = groceries(2025).filter((t) => t.date >= "2025-10");
    assert.equal(averageBudgets(tx, {}, "2026-01").get("Groceries"), 400);
  });

  test("an occasional category is averaged over every month, not only its own", () => {
    const tx = [...groceries(2025), txn("2025-03-01", 1200, "Travel")];
    assert.equal(averageBudgets(tx, {}, "2026-01").get("Travel"), 100);
  });

  test("anything not counted as spending gets no budget", () => {
    const tx = [...groceries(2025), txn("2025-05-01", 900, "Debt Repayment")];
    assert.equal(averageBudgets(tx, {}, "2026-01").has("Debt Repayment"), false);
  });

  test("nothing on record, nothing to set", () => {
    assert.equal(averageBudgets([], {}, "2026-01").size, 0);
  });
});

describe("effectiveLimits", () => {
  const manual = [
    { category: "Groceries", limit: 999 },
    { category: "Housing", limit: 1200 },
  ];
  const tx = groceries(2025);
  const none = { all: false, categories: [] };
  const all = { all: true, categories: [] };

  test("the budgets set by hand, when nothing follows the average", () => {
    const l = effectiveLimits(manual, none, tx, {}, "2026-01");
    assert.deepEqual([...l], [["Groceries", 999], ["Housing", 1200]]);
  });

  test("the 12-month average for every category, when all follow it", () => {
    const l = effectiveLimits(manual, all, tx, {}, "2026-01");
    assert.equal(l.get("Groceries"), 400);
    assert.equal(l.get("Housing"), 1000);
  });

  test("some by hand, some on the average", () => {
    const l = effectiveLimits(manual, { all: false, categories: ["Groceries"] }, tx, {}, "2026-01");
    assert.equal(l.get("Groceries"), 400, "follows the average");
    assert.equal(l.get("Housing"), 1200, "kept as set");
  });

  test("a category on the average gets one even with nothing set by hand", () => {
    const l = effectiveLimits([], { all: false, categories: ["Housing"] }, tx, {}, "2026-01");
    assert.deepEqual([...l], [["Housing", 1000]]);
  });

  test("following it keeps up as months finish", () => {
    const later = [...tx, txn("2026-01-10", 1600, "Groceries"), txn("2026-01-05", 1000, "Housing")];
    // January still running: not counted.
    assert.equal(effectiveLimits(manual, all, later, {}, "2026-01").get("Groceries"), 400);
    // January finished: the window moves on, dropping last January.
    assert.equal(effectiveLimits(manual, all, later, {}, "2026-02").get("Groceries"), 500);
  });
});

describe("setFollowing", () => {
  const cats = ["Dining", "Groceries", "Housing"];

  test("one category on, one at a time", () => {
    const a = setFollowing({ all: false, categories: [] }, "Dining", true, cats);
    assert.deepEqual(a, { all: false, categories: ["Dining"] });
    assert.equal(followsAverage(a, "Dining"), true);
    assert.equal(followsAverage(a, "Housing"), false);
  });

  test("the last one on becomes every category, new ones included", () => {
    const a = setFollowing({ all: false, categories: ["Dining", "Groceries"] }, "Housing", true, cats);
    assert.deepEqual(a, { all: true, categories: [] });
    assert.equal(followsAverage(a, "Travel"), true);
  });

  test("taking one off every category leaves the others following", () => {
    const a = setFollowing({ all: true, categories: [] }, "Groceries", false, cats);
    assert.deepEqual(a, { all: false, categories: ["Dining", "Housing"] });
  });

  test("taking one off a list removes only it", () => {
    const a = setFollowing({ all: false, categories: ["Dining", "Housing"] }, "Dining", false, cats);
    assert.deepEqual(a, { all: false, categories: ["Housing"] });
  });
});
