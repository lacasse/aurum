import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  categoryRows,
  expenseMonths,
  groupOf,
  latestExpenseMonth,
  monthSummary,
  monthlySpend,
  recurringFloor,
  rollingAverage,
  runningCost,
} from "./expenses";
import type { Transaction } from "./types";

let n = 0;
const txn = (
  date: string,
  amount: number,
  category: string,
  type: "income" | "expense" = "expense",
): Transaction =>
  ({
    id: `t${n++}`,
    date,
    type,
    amount,
    category,
    payee: "x",
  }) as unknown as Transaction;

/** Twelve months of the same three categories, with one month cheaper. */
const steady = (): Transaction[] => {
  const out: Transaction[] = [];
  for (let m = 1; m <= 12; m++) {
    const key = `2025-${String(m).padStart(2, "0")}`;
    out.push(txn(`${key}-05`, 1000, "Housing"));
    out.push(txn(`${key}-10`, m === 6 ? 100 : 400, "Groceries"));
    out.push(txn(`${key}-15`, 200, "Drinks & Dining"));
  }
  return out;
};

describe("grouping", () => {
  test("known categories fall on their default side", () => {
    assert.equal(groupOf("Housing"), "necessity");
    assert.equal(groupOf("Travel"), "discretionary");
  });

  test("debt repayment is not consumption", () => {
    assert.equal(groupOf("Debt Repayment"), "excluded");
  });

  test("an unknown category is discretionary until told otherwise", () => {
    assert.equal(groupOf("Hot air balloons"), "discretionary");
  });

  test("an override wins", () => {
    assert.equal(groupOf("Travel", { Travel: "necessity" }), "necessity");
  });
});

describe("months on record", () => {
  const txns = [
    txn("2025-01-04", 10, "Groceries"),
    txn("2025-03-04", 10, "Groceries"),
    txn("2025-05-04", 9000, "Salary", "income"),
  ];

  test("only months with spending count", () => {
    assert.deepEqual(expenseMonths(txns), ["2025-01", "2025-03"]);
    assert.equal(latestExpenseMonth(txns), "2025-03");
  });

  test("a record with no spending has no latest month", () => {
    assert.equal(latestExpenseMonth([txns[2]]), null);
  });
});

describe("monthlySpend", () => {
  const txns = [
    txn("2025-01-04", 1000, "Housing"),
    txn("2025-01-06", 300, "Travel"),
    txn("2025-01-09", 2500, "Debt Repayment"),
  ];
  const [jan] = monthlySpend(txns);

  test("splits the month three ways", () => {
    assert.equal(jan.necessity, 1000);
    assert.equal(jan.discretionary, 300);
    assert.equal(jan.excluded, 2500);
  });

  test("the total is consumption only — a loan payment is not spending", () => {
    assert.equal(jan.total, 1300);
  });

  test("months with nothing in them are absent rather than zero", () => {
    assert.deepEqual(
      monthlySpend([...txns, txn("2025-04-01", 50, "Groceries")]).map((m) => m.key),
      ["2025-01", "2025-04"],
    );
  });
});

describe("rollingAverage", () => {
  test("is null until the window is full", () => {
    assert.deepEqual(rollingAverage([1, 2, 3, 4], 3), [null, null, 2, 3]);
  });
});

describe("categoryRows", () => {
  const rows = categoryRows(steady(), "2025-12");
  const groceries = rows.find((r) => r.category === "Groceries")!;

  test("ranked by what the month cost", () => {
    assert.equal(rows[0].category, "Housing");
  });

  test("the average excludes the month being read", () => {
    // Eleven months in the window: ten at 400 and June at 100.
    assert.equal(groceries.monthsInWindow, 11);
    assert.equal(groceries.average, Math.round((10 * 400 + 100) / 11 * 100) / 100);
  });

  test("delta is this month against that average", () => {
    assert.equal(groceries.amount, 400);
    assert.ok(groceries.delta > 0);
  });

  test("shares are of consumption and add to a hundred", () => {
    const total = rows.reduce((s, r) => s + r.share, 0);
    assert.ok(Math.abs(total - 100) < 0.001);
  });

  test("a category paid every month says so", () => {
    assert.equal(groceries.monthsSeen, 11);
  });

  test("debt repayment is listed but takes no share", () => {
    const withDebt = categoryRows(
      [...steady(), txn("2025-12-02", 5000, "Debt Repayment")],
      "2025-12",
    );
    const debt = withDebt.find((r) => r.category === "Debt Repayment")!;
    assert.equal(debt.amount, 5000);
    assert.equal(debt.share, 0);
    assert.ok(Math.abs(withDebt.reduce((s, r) => s + r.share, 0) - 100) < 0.001);
  });

  test("a category that stopped still appears", () => {
    const rows = categoryRows(
      [...steady(), txn("2025-02-01", 900, "Travel")],
      "2025-12",
    );
    const travel = rows.find((r) => r.category === "Travel")!;
    assert.equal(travel.amount, 0);
    assert.ok(travel.delta < 0);
  });

  test("last year is null when the record does not reach back", () => {
    assert.equal(groceries.lastYear, null);
  });
});

describe("monthSummary", () => {
  const s = monthSummary(steady(), "2025-12");

  test("totals the month's consumption", () => {
    assert.equal(s.total, 1600);
    assert.equal(s.necessity, 1400);
    assert.equal(s.discretionary, 200);
  });

  test("discretionary share is of consumption", () => {
    assert.equal(Math.round(s.discretionaryShare!), 13);
  });

  test("compares against the month before and the eleven behind it", () => {
    assert.equal(s.previous, 1600);
    assert.equal(s.averageMonths, 11);
  });

  test("ranks the month against every other on record", () => {
    const cheapest = monthSummary(steady(), "2025-06");
    assert.equal(cheapest.rank, 12);
    assert.equal(cheapest.months, 12);
  });
});

describe("recurringFloor", () => {
  const floor = recurringFloor(steady(), {}, 12, "2025-12");

  test("keeps the categories that arrive every month", () => {
    assert.deepEqual(
      floor.items.map((i) => i.category).sort(),
      ["Drinks & Dining", "Groceries", "Housing"],
    );
  });

  test("uses the median, so one cheap month does not move the floor", () => {
    assert.equal(floor.items.find((i) => i.category === "Groceries")!.typical, 400);
    assert.equal(floor.total, 1600);
  });

  test("drops a category that only turned up occasionally", () => {
    const withTravel = recurringFloor(
      [...steady(), txn("2025-03-01", 4000, "Travel")],
      {},
      12,
      "2025-12",
    );
    assert.ok(!withTravel.items.some((i) => i.category === "Travel"));
  });

  test("debt repayment is never part of the floor", () => {
    const withDebt = recurringFloor(
      [
        ...steady(),
        ...Array.from({ length: 12 }, (_, i) =>
          txn(`2025-${String(i + 1).padStart(2, "0")}-20`, 800, "Debt Repayment"),
        ),
      ],
      {},
      12,
      "2025-12",
    );
    assert.ok(!withDebt.items.some((i) => i.category === "Debt Repayment"));
  });
});

describe("runningCost", () => {
  const txns = [
    txn("2025-01-10", 600, "Transport"),
    txn("2025-04-10", 300, "Transport"),
    txn("2025-06-10", 300, "Insurance"),
    txn("2024-11-10", 999, "Transport"),
    txn("2025-03-10", 500, "Groceries"),
  ];
  const cost = runningCost(txns, ["Transport", "Insurance"], "2025-01", "2025-06");

  test("counts only the chosen categories inside the window", () => {
    assert.equal(cost.total, 1200);
  });

  test("divides by every month owned, not only the months with a bill", () => {
    assert.equal(cost.months, 6);
    assert.equal(cost.monthsWithSpend, 3);
    assert.equal(cost.perMonth, 200);
    assert.equal(cost.perYear, 2400);
  });

  test("names the most expensive month", () => {
    assert.equal(cost.largest?.key, "2025-01");
    assert.equal(cost.largest?.value, 600);
  });

  test("the series covers quiet months too", () => {
    assert.equal(cost.series.length, 6);
    assert.equal(cost.series[1].value, 0);
  });

  test("spans a year boundary", () => {
    const wide = runningCost(txns, ["Transport"], "2024-11", "2025-01");
    assert.equal(wide.months, 3);
    assert.equal(wide.total, 1599);
  });

  test("no categories means no answer rather than a division by zero", () => {
    const none = runningCost(txns, [], "2025-01", "2025-06");
    assert.equal(none.months, 0);
    assert.equal(none.perMonth, 0);
  });
});
