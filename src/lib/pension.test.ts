import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  PENSION_CATEGORY,
  PENSION_INCOME_CATEGORY,
  contributionsByMonth,
  estimateValue,
  lastRecordedMonth,
  summarize,
} from "./pension";
import type { Account, Transaction } from "./types";

const account = {
  id: "p",
  name: "Employer Pension Plan",
  institution: "GC",
  kind: "pension",
  balance: 1000,
  history: [
    { month: "2026-05", value: 800 },
    { month: "2026-06", value: 900 },
    { month: "2026-07", value: 1000 },
  ],
} as unknown as Account;

const contribution = (date: string, amount: number): Transaction =>
  ({
    id: date,
    date,
    type: "income",
    amount,
    category: PENSION_CATEGORY,
    payee: "RSP / Pension",
    destinationAccountId: "p",
  }) as unknown as Transaction;

describe("contributionsByMonth", () => {
  test("totals only what went into the pension", () => {
    const by = contributionsByMonth([
      contribution("2026-06-30", 100),
      contribution("2026-07-31", 150.5),
      { ...contribution("2026-07-15", 900), category: "Salary" } as Transaction,
    ]);
    assert.deepEqual(by, { "2026-06": 100, "2026-07": 150.5 });
  });

  test("adds up two contributions in the same month exactly", () => {
    const by = contributionsByMonth([
      contribution("2026-07-15", 0.1),
      contribution("2026-07-31", 0.2),
    ]);
    assert.equal(by["2026-07"], 0.3, "and not 0.30000000000000004");
  });
});

describe("lastRecordedMonth", () => {
  test("skips over the months the app filled in itself", () => {
    const withEstimate = {
      ...account,
      history: [
        ...account.history,
        { month: "2026-08", value: 1100, estimated: true },
      ],
    };
    assert.equal(lastRecordedMonth(withEstimate), "2026-07");
  });

  test("nothing recorded at all", () => {
    assert.equal(lastRecordedMonth({ ...account, history: [] }), null);
  });
});

describe("estimateValue", () => {
  const by = { "2026-08": 120, "2026-09": 130 };

  test("carries the last real figure forward by what was paid in since", () => {
    assert.equal(estimateValue(account, by, "2026-08"), 1120);
    assert.equal(estimateValue(account, by, "2026-09"), 1250);
  });

  test("an estimate is never built on another estimate", () => {
    // Two skipped months in a row both measure from July, so the second does
    // not add August's contribution twice.
    const withEstimate = {
      ...account,
      history: [...account.history, { month: "2026-08", value: 1120, estimated: true }],
    };
    assert.equal(estimateValue(withEstimate, by, "2026-09"), 1250);
  });

  test("no contributions since means no change", () => {
    assert.equal(estimateValue(account, {}, "2026-08"), 1000);
  });
});

describe("summarize", () => {
  const transactions = [
    contribution("2026-05-31", 100),
    contribution("2026-06-30", 100),
    contribution("2026-07-31", 100),
    contribution("2026-08-31", 120),
  ];

  test("a month with no figure of its own is an estimate", () => {
    const s = summarize(account, transactions, "2026-08");
    assert.equal(s.estimated, true);
    assert.equal(s.value, 1120);
    assert.equal(s.asOf, "2026-07");
    assert.equal(s.contributedSince, 120);
  });

  test("a month the user filled in is not", () => {
    const filled = {
      ...account,
      history: [...account.history, { month: "2026-08", value: 1500 }],
    };
    const s = summarize(filled, transactions, "2026-08");
    assert.equal(s.estimated, false);
    assert.equal(s.value, 1500);
    assert.equal(s.asOf, "2026-08");
  });

  test("the gap between the plan's figure and your own money", () => {
    const s = summarize(account, transactions, "2026-08");
    // 420 paid in against a value of 1,120: the rest is the employer's side.
    assert.equal(s.contributed, 420);
    assert.equal(s.beyondContributions, 700);
  });

  test("contributions accumulate along the series, for the chart", () => {
    const s = summarize(account, transactions, "2026-08");
    assert.deepEqual(
      s.series.map((p) => p.contributed),
      [100, 200, 300],
    );
  });

  test("the line starts from the first contribution, not the first value", () => {
    // Contributions were recorded for years before the transfer value was,
    // and counting only from the account's first month drew a third of what
    // had been paid in.
    const older = [contribution("2024-01-31", 5000), ...transactions];
    const s = summarize(account, older, "2026-08");
    assert.equal(s.series[0].contributed, 5100);
    assert.equal(s.series[s.series.length - 1].contributed, 5300);
  });

  test("no contributions recorded at all does not divide by zero", () => {
    const s = summarize(account, [], "2026-08");
    assert.equal(s.monthly, 0);
    assert.equal(s.contributed, 0);
  });
});

/*
 * Paying in and being paid are opposite flows through the same plan, and the
 * whole reason they are separate categories is that one of them must never be
 * read as the other.
 */
describe("a pension paying out is not a pension being paid into", () => {
  const txn = (date: string, amount: number, category: string): Transaction =>
    ({ id: date + category, date, type: "income", amount, category, payee: "Plan" }) as Transaction;

  test("an annuity payment is not counted as a contribution", () => {
    const months = contributionsByMonth([
      txn("2026-01-31", 500, PENSION_CATEGORY),
      txn("2026-01-31", 3200, PENSION_INCOME_CATEGORY),
    ]);
    // Only the contribution. Counting the payment here would grow the plan
    // every month it paid out.
    assert.equal(months["2026-01"], 500);
  });

  test("a plan that only pays out records no contributions at all", () => {
    const months = contributionsByMonth([
      txn("2026-01-31", 3200, PENSION_INCOME_CATEGORY),
      txn("2026-02-28", 3200, PENSION_INCOME_CATEGORY),
    ]);
    assert.deepEqual(months, {});
  });

  test("the two categories are actually different", () => {
    assert.notEqual(PENSION_CATEGORY, PENSION_INCOME_CATEGORY);
  });
});
