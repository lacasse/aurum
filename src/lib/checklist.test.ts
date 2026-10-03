import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  describeGaps,
  describeTrim,
  incomeBoxes,
  partitionByMonth,
  previousMonthIncome,
  snapshotGaps,
  tradeDraftFrom,
  unconvertedPrices,
} from "./checklist";
import type { TradeRow } from "./trades";
import type { Account } from "./types";
import type { ImportedRow } from "./csv";

let n = 0;
const row = (
  date: string,
  type: "income" | "expense",
  amount: number,
  category: string,
  include = true,
): ImportedRow =>
  ({
    id: `r${n++}`,
    date,
    payee: category,
    amount,
    type,
    sourceFile: "f.csv",
    category,
    suggestedCategory: category,
    confident: true,
    include,
    dup: false,
    explicitType: true,
  }) as ImportedRow;

describe("partitionByMonth", () => {
  const rows = [
    { date: "2026-07-31" },
    { date: "2026-08-01" },
    { date: "2026-08-15" },
    { date: "2026-08-31" },
    { date: "2026-09-01" },
  ];
  const p = partitionByMonth(rows, "2026-08");

  test("keeps the month being closed, edges included", () => {
    assert.deepEqual(
      p.kept.map((r) => r.date),
      ["2026-08-01", "2026-08-15", "2026-08-31"],
    );
  });

  test("separates what came before from what came after", () => {
    assert.deepEqual(p.older.map((r) => r.date), ["2026-07-31"]);
    assert.deepEqual(p.newer.map((r) => r.date), ["2026-09-01"]);
  });

  test("a year boundary is not a special case", () => {
    const q = partitionByMonth(
      [{ date: "2025-12-31" }, { date: "2026-01-15" }, { date: "2026-02-01" }],
      "2026-01",
    );
    assert.equal(q.kept.length, 1);
    assert.equal(q.older.length, 1);
    assert.equal(q.newer.length, 1);
  });

  test("nothing in, nothing out", () => {
    const q = partitionByMonth([], "2026-08");
    assert.deepEqual([q.kept, q.older, q.newer], [[], [], []]);
  });
});

describe("describeTrim", () => {
  test("says nothing when nothing was trimmed", () => {
    assert.equal(describeTrim(0, 0, "Aug ’26", "transactions"), "");
  });

  test("names both sides when both were trimmed", () => {
    const s = describeTrim(3, 2, "Aug ’26", "transactions");
    assert.ok(s.includes("3 from before Aug ’26"));
    assert.ok(s.includes("2 from the month still running"));
  });

  test("names only the side that happened", () => {
    assert.ok(!describeTrim(4, 0, "Aug ’26", "transactions").includes("still running"));
  });
});

describe("previousMonthIncome", () => {
  const income = (date: string, amount: number, category: string) =>
    ({
      id: date + category,
      date,
      amount,
      type: "income" as const,
      category,
      destinationAccountId: "a1",
      payee: "x",
    });

  test("only the month before, and only the categories asked for", () => {
    const rows = [
      income("2026-07-31", 410, "RSP / Pension"),
      income("2026-07-31", 5000, "Salary"),
      income("2026-06-30", 400, "RSP / Pension"),
    ];
    assert.deepEqual(previousMonthIncome(rows, "2026-08", ["RSP / Pension"]), {
      "RSP / Pension": 410,
    });
  });

  test("nothing recorded is nothing carried", () => {
    assert.deepEqual(previousMonthIncome([], "2026-08", ["RSP / Pension"]), {});
  });

  test("spending under the same heading is not income", () => {
    const rows = [
      { ...income("2026-07-31", 410, "RSP / Pension"), type: "expense" as const },
    ];
    assert.deepEqual(previousMonthIncome(rows, "2026-08", ["RSP / Pension"]), {});
  });
});

describe("incomeBoxes", () => {
  test("an empty box takes last month's figure when there is one", () => {
    const boxes = incomeBoxes([], { "RSP / Pension": 410 });
    const pension = boxes.find((b) => b.category === "RSP / Pension")!;
    assert.equal(pension.carried, 410);
    assert.equal(pension.detected, 0);
  });

  test("what the import found wins over what last month said", () => {
    const boxes = incomeBoxes(
      [row("2026-08-31", "income", 425, "RSP / Pension")],
      { "RSP / Pension": 410 },
    );
    const pension = boxes.find((b) => b.category === "RSP / Pension")!;
    assert.equal(pension.detected, 425);
    assert.equal(pension.carried, undefined);
  });

  test("nothing to carry leaves the box empty", () => {
    const boxes = incomeBoxes([], {});
    assert.ok(boxes.every((b) => b.carried === undefined));
  });

  test("the four standard boxes are always offered, detected or not", () => {
    const boxes = incomeBoxes([]);
    assert.deepEqual(
      boxes.map((b) => b.category),
      ["Salary", "RSP / Pension", "Additional Income", "Interest"],
    );
    assert.ok(boxes.every((b) => b.detected === 0 && b.rows === 0));
  });

  test("a box opens at the total of its category", () => {
    const boxes = incomeBoxes([
      row("2026-08-15", "income", 3200, "Salary"),
      row("2026-08-30", "income", 800, "Salary"),
      row("2026-08-31", "income", 1.42, "Interest"),
    ]);
    const salary = boxes.find((b) => b.category === "Salary")!;
    assert.equal(salary.detected, 4000);
    assert.equal(salary.rows, 2);
    assert.equal(boxes.find((b) => b.category === "Interest")!.detected, 1.42);
  });

  test("an income kind outside the four gets its own box rather than being lost", () => {
    const boxes = incomeBoxes([row("2026-08-10", "income", 120, "Dividends")]);
    const extra = boxes.find((b) => b.category === "Dividends")!;
    assert.equal(extra.detected, 120);
    assert.equal(extra.extra, true);
    // …and it is offered after the four that are always asked for.
    assert.equal(boxes.indexOf(extra), 4);
  });

  test("spending is not income", () => {
    const boxes = incomeBoxes([
      row("2026-08-03", "expense", 84.2, "Groceries"),
      row("2026-08-15", "income", 3200, "Salary"),
    ]);
    assert.equal(boxes.length, 4);
    assert.equal(boxes.find((b) => b.category === "Salary")!.detected, 3200);
  });

  test("a row switched off does not count toward its box", () => {
    const boxes = incomeBoxes([
      row("2026-08-15", "income", 3200, "Salary"),
      row("2026-08-16", "income", 999, "Salary", false),
    ]);
    assert.equal(boxes.find((b) => b.category === "Salary")!.detected, 3200);
    assert.equal(boxes.find((b) => b.category === "Salary")!.rows, 1);
  });

  test("cents survive the totalling", () => {
    const boxes = incomeBoxes([
      row("2026-08-01", "income", 0.1, "Interest"),
      row("2026-08-02", "income", 0.2, "Interest"),
    ]);
    assert.equal(boxes.find((b) => b.category === "Interest")!.detected, 0.3);
  });
});


describe("snapshotGaps", () => {
  /** Twelve months of a steady eleven-position portfolio. */
  const steady = (): Record<string, number> =>
    Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`2026-${String(i + 1).padStart(2, "0")}`, 11]),
    );

  test("a complete record has no gaps", () => {
    assert.deepEqual(snapshotGaps(steady(), "2026-12"), []);
  });

  test("a month nobody recorded is missing", () => {
    const r = steady();
    delete r["2026-07"];
    const gaps = snapshotGaps(r, "2026-12");
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].month, "2026-07");
    assert.equal(gaps[0].kind, "missing");
    assert.equal(gaps[0].expected, 11);
  });

  test("a half-entered month is thin, not missing", () => {
    const r = steady();
    r["2026-07"] = 4;
    const [gap] = snapshotGaps(r, "2026-12");
    assert.equal(gap.kind, "thin");
    assert.equal(gap.positions, 4);
  });

  test("a portfolio that genuinely shrinks is not a gap", () => {
    // Fourteen positions consolidating to ten over five months.
    const r: Record<string, number> = {
      "2026-01": 14,
      "2026-02": 13,
      "2026-03": 12,
      "2026-04": 11,
      "2026-05": 10,
    };
    assert.deepEqual(snapshotGaps(r, "2026-05"), []);
  });

  test("nothing before the record opens counts as missed", () => {
    const gaps = snapshotGaps({ "2026-11": 11, "2026-12": 11 }, "2026-12");
    assert.deepEqual(gaps, []);
  });

  test("an empty record reports nothing rather than every month", () => {
    assert.deepEqual(snapshotGaps({}, "2026-12"), []);
  });

  test("only the window is examined", () => {
    const r = { "2020-01": 5, "2026-12": 11 };
    // The years between are outside a 24-month window and are not listed.
    const gaps = snapshotGaps(r, "2026-12", 24);
    assert.equal(gaps.length, 23);
    assert.ok(gaps.every((g) => g.month >= "2025-01"));
  });

  test("a thin patch at the start of the record is caught by its later neighbour", () => {
    const r: Record<string, number> = {
      "2026-01": 5,
      "2026-02": 5,
      "2026-03": 12,
      "2026-04": 12,
    };
    const gaps = snapshotGaps(r, "2026-04");
    assert.deepEqual(
      gaps.map((g) => g.month),
      ["2026-01", "2026-02"],
    );
    assert.ok(gaps.every((g) => g.kind === "thin"));
  });
});

describe("describeGaps", () => {
  test("says nothing about a complete record", () => {
    assert.equal(describeGaps([]), "");
  });

  test("names the months it is missing", () => {
    const s = describeGaps([
      { month: "2026-03", kind: "missing", positions: 0, expected: 11 },
      { month: "2026-07", kind: "missing", positions: 0, expected: 11 },
    ]);
    assert.ok(s.includes("Mar 2026"));
    assert.ok(s.includes("Jul 2026"));
  });

  test("keeps the two kinds of hole apart", () => {
    const s = describeGaps([
      { month: "2026-03", kind: "missing", positions: 0, expected: 11 },
      { month: "2026-07", kind: "thin", positions: 4, expected: 11 },
    ]);
    assert.ok(s.includes("no closing value"));
    assert.ok(s.includes("only partly recorded"));
  });
});

describe("unconvertedPrices", () => {
  // INVENTED: made-up tickers and round prices.
  const h = (ticker: string, currency: string, shares: number, price: number, priceCAD: number) =>
    ({ ticker, currency, shares, price, priceCAD }) as Parameters<typeof unconvertedPrices>[0][number];

  test("names open US-dollar positions whose Canadian price was never converted", () => {
    assert.deepEqual(
      unconvertedPrices([
        h("AAA", "USD", 10, 100, 100), // unconverted
        h("BBB", "USD", 10, 100, 138), // converted
        h("CCC", "CAD", 10, 100, 100), // a Canadian listing: equal is right
        h("DDD", "USD", 0, 100, 100), // closed: its value is zero either way
        h("EEE", "USD", 5, 50, 0), // no Canadian price at all
      ]),
      ["AAA", "EEE"],
    );
  });
});

describe("tradeDraftFrom", () => {
  // INVENTED: accounts in the order the store keeps them, chequing first.
  const accounts = [
    { id: "chq", name: "Chequing", kind: "checking", registration: "non-registered" },
    { id: "nonreg", name: "Brokerage", kind: "investment", registration: "non-registered" },
    { id: "tfsa", name: "TFSA", kind: "investment", registration: "TFSA" },
  ] as Account[];
  const imported = (over: Partial<TradeRow> = {}): TradeRow => ({
    id: "t", date: "2026-09-10", type: "dividend", typeRaw: "Dividend", ticker: "OMNI",
    quantity: 0, pricePerUnit: 0, transactedAmount: 12.5, registration: "TFSA",
    registrationRaw: "TFSA", currency: "CAD", amountCad: 12.5, include: true,
    duplicate: false, sourceFile: "x.csv", ...over,
  });

  test("a dividend arrives as one unit priced at the payment, not as zero", () => {
    const d = tradeDraftFrom(imported(), accounts);
    assert.equal(d.quantity, "1");
    assert.equal(d.price, "12.5");
    assert.equal(d.accountId, "tfsa");
  });

  test("a USD dividend with no stated rate leaves the conversion to the form", () => {
    const d = tradeDraftFrom(imported({ currency: "USD", transactedAmount: 8, amountCad: 8 }), accounts);
    assert.equal(d.cadAmount, "");
  });

  test("a stated conversion is kept", () => {
    const d = tradeDraftFrom(imported({ currency: "USD", transactedAmount: 8, amountCad: 11 }), accounts);
    assert.equal(d.cadAmount, "11");
  });

  test("a buy keeps its shares and price", () => {
    const d = tradeDraftFrom(imported({ type: "buy", quantity: 5, pricePerUnit: 40, transactedAmount: 200 }), accounts);
    assert.deepEqual([d.quantity, d.price], ["5", "40"]);
  });

  test("a non-registered trade lands in the brokerage, not the chequing account", () => {
    const d = tradeDraftFrom(imported({ registration: "non-registered" }), accounts);
    assert.equal(d.accountId, "nonreg");
  });
});
