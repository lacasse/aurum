import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  conflictingGranularity,
  granularityClashes,
  monthOf,
  type Transaction,
} from "./types";

/*
 * A month is kept one way or the other: as a set of month-end totals, or as the
 * individual transactions themselves. Holding both counts the same money twice,
 * and nothing on the page says so — the figures stay plausible, only larger.
 *
 * It happened when months already summarised from a spreadsheet were imported
 * again from bank and card exports. Two months read at roughly triple their
 * real spending, and a month's pay was counted twice because the checklist
 * writes a month-end total beside deposits the bank export had already brought
 * in.
 *
 * ALL-FIXTURES-INVENTED
 */

const txn = (over: Partial<Transaction> = {}): Transaction => ({
  id: "t1",
  date: "2026-06-30",
  type: "expense",
  amount: 100,
  category: "Groceries",
  payee: "Example Store",
  granularity: "individual",
  ...over,
});

describe("a month is kept one way or the other", () => {
  test("individual rows refuse a monthly total for the same month", () => {
    const clash = conflictingGranularity(
      [txn({ date: "2026-06-12" }), txn({ id: "t2", date: "2026-06-19" })],
      txn({ id: "new", date: "2026-06-30", granularity: "monthly" }),
    );
    assert.equal(clash?.count, 2);
    assert.equal(clash?.month, "2026-06");
    assert.equal(clash?.existing, "individual");
  });

  test("a monthly total refuses individual rows for the same month", () => {
    const clash = conflictingGranularity(
      [txn({ date: "2026-06-30", granularity: "monthly" })],
      txn({ id: "new", date: "2026-06-12" }),
    );
    assert.equal(clash?.existing, "monthly");
  });

  test("the same kind twice is not a conflict", () => {
    assert.equal(
      conflictingGranularity([txn({ date: "2026-06-12" })], txn({ id: "new", date: "2026-06-19" })),
      null,
    );
  });
});

describe("what the rule does not reach across", () => {
  test("an adjacent month is a different month", () => {
    assert.equal(
      conflictingGranularity(
        [txn({ date: "2026-05-31", granularity: "monthly" })],
        txn({ id: "new", date: "2026-06-01" }),
      ),
      null,
    );
  });

  test("income and expenses are counted separately", () => {
    assert.equal(
      conflictingGranularity(
        [txn({ date: "2026-06-12", type: "expense" })],
        txn({ id: "new", date: "2026-06-30", type: "income", granularity: "monthly" }),
      ),
      null,
    );
  });

  test("a row with no granularity is treated as one event", () => {
    const legacy = { date: "2026-06-12", type: "expense" as const };
    const clash = conflictingGranularity(
      [legacy],
      txn({ id: "new", date: "2026-06-30", granularity: "monthly" }),
    );
    assert.equal(clash?.existing, "individual");
  });

  test("nothing recorded means nothing conflicts", () => {
    assert.equal(conflictingGranularity([], txn({ granularity: "monthly" })), null);
  });
});

describe("a whole import is checked before any of it is written", () => {
  const summarised: Transaction[] = [
    txn({ id: "s1", date: "2026-06-30", granularity: "monthly" }),
    txn({ id: "s2", date: "2026-06-30", category: "Housing", granularity: "monthly" }),
    txn({ id: "s3", date: "2026-06-30", type: "income", granularity: "monthly" }),
  ];
  const incoming = [
    { date: "2026-06-02", type: "expense" as const, granularity: "individual" as const },
    { date: "2026-06-14", type: "expense" as const, granularity: "individual" as const },
    { date: "2026-06-14", type: "income" as const, granularity: "individual" as const },
    { date: "2026-07-03", type: "expense" as const, granularity: "individual" as const },
  ];

  test("a covered month is reported once, with both counts", () => {
    const found = granularityClashes(summarised, incoming);
    assert.deepEqual(
      found.map((c) => [c.month, c.type, c.count, c.incoming]),
      [
        ["2026-06", "expense", 2, 2],
        ["2026-06", "income", 1, 1],
      ],
    );
  });

  test("a month nobody has summarised is not reported", () => {
    const found = granularityClashes(summarised, incoming);
    assert.ok(!found.some((c) => c.month === "2026-07"), "July is free");
  });

  test("expense and income are asked separately", () => {
    // Only the income side is summarised, so importing spending is fine.
    const found = granularityClashes(
      [txn({ id: "s3", type: "income", granularity: "monthly" })],
      [{ date: "2026-06-02", type: "expense" as const, granularity: "individual" as const }],
    );
    assert.deepEqual(found, []);
  });

  test("an empty record blocks nothing", () => {
    assert.deepEqual(granularityClashes([], incoming), []);
  });
});

describe("the month a row belongs to", () => {
  test("is read off the date", () => {
    assert.equal(monthOf("2026-06-30"), "2026-06");
    assert.equal(monthOf("2026-01-01"), "2026-01");
  });
});
