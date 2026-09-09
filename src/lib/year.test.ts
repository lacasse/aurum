import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  cashflowInsights,
  categoryShifts,
  contributionsVsValue,
  incomeAllocation,
  incomeMix,
  incomeMixShares,
  incomeTypeShares,
  yearFlow,
  unearnedShare,
  milestones,
  yearInsights,
  yearRows,
  yearShapes,
  yearWaterfall,
} from "./year";
import type { ClassPoint, NetWorthPoint, PortfolioPoint } from "./analytics";
import type { Transaction } from "./types";
import { groupOf } from "./expenses";

const nw = (key: string, net: number) =>
  ({ key, label: key, assets: 0, liabilities: 0, portfolio: 0, pension: 0, net }) as NetWorthPoint;
const port = (key: string, value: number, cost: number) =>
  ({ key, label: key, value, cost }) as PortfolioPoint;
const txn = (date: string, type: "income" | "expense", amount: number, category = "Groceries") =>
  ({ id: date + amount, date, type, amount, category, payee: "x" }) as unknown as Transaction;

describe("yearRows", () => {
  const netWorth = [
    nw("2024-06", 10000),
    nw("2024-12", 20000),
    nw("2025-06", 30000),
    nw("2025-12", 40000),
  ];
  const portfolio = [
    port("2024-06", 5000, 4000),
    port("2024-12", 12000, 9000),
    port("2025-06", 18000, 14000),
    port("2025-12", 26000, 20000),
  ];
  const transactions = [
    txn("2024-03-01", "income", 40000, "Salary"),
    txn("2024-05-01", "expense", 25000),
    txn("2025-03-01", "income", 50000, "Salary"),
    txn("2025-05-01", "expense", 30000),
  ];
  const rows = yearRows(transactions, netWorth, portfolio, { "2025-04": 3000 }, "2026-08-31");

  test("newest year first", () => {
    assert.deepEqual(rows.map((r) => r.year), ["2025", "2024"]);
  });

  test("net worth is taken at the end of the year, and the change with it", () => {
    const [y2025, y2024] = rows;
    assert.equal(y2025.netWorth, 40000);
    assert.equal(y2024.netWorth, 20000);
    assert.equal(y2025.netWorthChange, 20000);
    assert.equal(y2024.netWorthChange, null, "nothing before it to compare with");
  });

  test("income, spending and what was kept", () => {
    const [y2025] = rows;
    assert.equal(y2025.income, 50000);
    assert.equal(y2025.expenses, 30000);
    assert.equal(y2025.netCashflow, 20000);
    assert.equal(y2025.savingsRate, 40);
  });

  test("spending growth is measured against the year before", () => {
    const [y2025, y2024] = rows;
    assert.equal(y2025.expenseGrowth, 20, "30,000 against 25,000");
    assert.equal(y2024.expenseGrowth, null);
  });

  test("the portfolio's cost and profit come from the year's last month", () => {
    const [y2025] = rows;
    assert.equal(y2025.portfolio, 26000);
    assert.equal(y2025.costBasis, 20000);
    assert.equal(y2025.investmentProfit, 6000);
  });

  test("money put in that year is summed from its months alone", () => {
    const [y2025, y2024] = rows;
    assert.equal(y2025.investmentFlows, 3000);
    assert.equal(y2024.investmentFlows, 0);
  });

  test("the year still running is marked as such", () => {
    const running = yearRows(transactions, netWorth, portfolio, {}, "2025-07-15");
    assert.equal(running[0].year, "2025");
    assert.equal(running[0].complete, false);
    assert.equal(running[1].complete, true);
  });

  test("a year with money but no balances on record is still a year", () => {
    const rows = yearRows([txn("2019-01-01", "expense", 100)], netWorth, portfolio, {}, "2026-01-01");
    assert.equal(rows[rows.length - 1].year, "2019");
    assert.equal(rows[rows.length - 1].netWorth, 0);
  });

  test("CAGR compounds from the first year with a positive net worth", () => {
    const [y2025] = rows;
    // 20,000 to 40,000 in one year.
    assert.equal(Math.round(y2025.cagr ?? 0), 100);
    assert.equal(rows[1].cagr, null, "the base year has nothing to compound from");
  });

  test("no income is no savings rate, rather than a rate of zero", () => {
    const rows = yearRows([txn("2025-05-01", "expense", 500)], netWorth, portfolio, {}, "2026-01-01");
    assert.equal(rows.find((r) => r.year === "2025")?.savingsRate, null);
  });
});

describe("milestones", () => {
  const points = [
    { key: "2024-01", net: 10000 },
    { key: "2024-06", net: 60000 },
    { key: "2024-12", net: 90000 },
    { key: "2025-06", net: 210000 },
    { key: "2025-12", net: 120000 },
  ];

  test("the first month each step was passed", () => {
    const found = milestones(points);
    assert.deepEqual(
      found.map((m) => `${m.amount}@${m.month}`),
      ["50000@2024-06", "100000@2025-06", "150000@2025-06", "200000@2025-06"],
    );
  });

  test("several steps crossed at once each get their month", () => {
    // A jump from 90,000 to 210,000 passes three.
    assert.equal(milestones(points).filter((m) => m.month === "2025-06").length, 3);
  });

  test("how long each step took", () => {
    const [first, second] = milestones(points);
    assert.equal(first.monthsFromPrevious, null);
    assert.equal(second.monthsFromPrevious, 12, "June 2024 to June 2025");
  });

  test("falling back below does not un-reach a milestone", () => {
    const found = milestones(points);
    assert.equal(found[found.length - 1].amount, 200000);
  });

  test("a step size of your choosing", () => {
    assert.equal(milestones(points, 100000)[0].amount, 100000);
  });

  test("nothing reached is no milestones", () => {
    assert.deepEqual(milestones([{ key: "2024-01", net: 400 }]), []);
  });
});

/* ALL-FIXTURES-INVENTED */

const cls = (key: string, over: Partial<ClassPoint> = {}): ClassPoint =>
  ({
    key,
    label: key,
    Cash: 0,
    Bonds: 0,
    Stocks: 0,
    Crypto: 0,
    Pension: 0,
    liabilities: 0,
    net: 0,
    ...over,
  }) as ClassPoint;

const row = (year: string, over: Record<string, unknown> = {}) =>
  ({
    year,
    complete: true,
    income: 100000,
    expenses: 60000,
    expenseGrowth: null,
    netCashflow: 40000,
    uncommittedLiquid: 40000,
    savingsRate: 40,
    netWorth: 200000,
    netWorthChange: 50000,
    portfolio: 0,
    costBasis: 0,
    investmentProfit: 0,
    investmentFlows: 0,
    portfolioReturn: null,
    cagr: null,
    ...over,
  }) as ReturnType<typeof yearRows>[number];

describe("a year as a balance sheet beside its cash flow", () => {
  const rows = [
    row("2025", { netWorth: 150000, netWorthChange: null }),
    row("2026", { netWorth: 200000, netWorthChange: 50000 }),
  ];
  const classes = [
    cls("2025-12", { Cash: 20000, Stocks: 140000, liabilities: 10000 }),
    cls("2026-06", { Cash: 30000, Stocks: 100000, liabilities: 9000 }),
    cls("2026-12", { Cash: 25000, Stocks: 180000, Pension: 20000, liabilities: 8000 }),
  ];

  test("a year closes on the last month the record reaches, not on December", () => {
    const partial = yearShapes([row("2026", { netWorth: 130000 })], [
      cls("2026-05", { Cash: 30000, Stocks: 100000 }),
    ]);
    assert.equal(partial[0].assets, 130000);
  });

  test("assets are the bands added up, and debt is kept apart from them", () => {
    const [, here] = yearShapes(rows, classes);
    assert.equal(here.assets, 225000);
    assert.equal(here.liabilities, 8000);
  });

  test("what you saved and what arrived on its own add up to the change", () => {
    const [, here] = yearShapes(rows, classes);
    assert.equal(here.saved, 40000);
    assert.equal(here.saved + here.revaluation, here.netWorth - here.openingNetWorth);
  });

  test("the opening figure is last year's close", () => {
    const [, here] = yearShapes(rows, classes);
    assert.equal(here.openingNetWorth, 150000);
  });

  test("the first year on record still opens somewhere", () => {
    const [first] = yearShapes(rows, classes);
    assert.equal(Number.isFinite(first.openingNetWorth), true);
  });
});

/*
 * The waterfall's whole claim is that it balances: the last column has to be
 * the balance sheet's own figure, or the chart is telling a story the record
 * does not support.
 */
describe("the year's move, as a waterfall", () => {
  const [shape] = yearShapes(
    [row("2026", { netWorth: 200000, netWorthChange: 50000, income: 100000, expenses: 60000 })],
    [cls("2026-12", { Cash: 25000, Stocks: 175000 })],
  );

  test("it starts at the opening figure and ends at the closing one", () => {
    const steps = yearWaterfall(shape);
    assert.equal(steps[0].top, shape.openingNetWorth);
    assert.equal(steps[steps.length - 1].top, shape.netWorth);
  });

  test("every step starts where the last one finished", () => {
    const steps = yearWaterfall(shape);
    let running = shape.openingNetWorth;
    for (const step of steps.slice(1, -1)) {
      const from = running;
      running += step.delta;
      assert.equal(step.base, Math.min(from, running));
      assert.equal(step.top, Math.max(from, running));
    }
    assert.equal(running, shape.netWorth);
  });

  test("spending points down and income points up", () => {
    const steps = yearWaterfall(shape);
    assert.equal(steps.find((s) => s.label === "Income")?.kind, "up");
    assert.equal(steps.find((s) => s.label === "Spending")?.kind, "down");
  });

  test("the two totals stand on the axis rather than floating", () => {
    const steps = yearWaterfall(shape);
    for (const s of steps.filter((s) => s.kind === "total")) assert.equal(s.base, 0);
  });
});

describe("what the year says", () => {
  const shapes = yearShapes(
    [
      row("2025", { netWorth: 150000, income: 90000, expenses: 66000 }),
      row("2026", { netWorth: 200000, netWorthChange: 50000, income: 100000, expenses: 60000 }),
    ],
    [
      cls("2025-12", { Cash: 20000, Stocks: 140000, liabilities: 20000 }),
      cls("2026-12", { Cash: 25000, Stocks: 180000, liabilities: 10000 }),
    ],
  );

  test("it says how much of the gain was money you added", () => {
    const earned = yearInsights(shapes, "2026").find((i) => i.key === "earned");
    // Saved 40,000 of a 50,000 gain.
    assert.match(earned!.headline, /80%/);
  });

  test("it does not claim saving caused a year that fell", () => {
    const falling = yearShapes(
      [
        row("2025", { netWorth: 150000 }),
        row("2026", { netWorth: 120000, netWorthChange: -30000 }),
      ],
      [cls("2025-12"), cls("2026-12")],
    );
    assert.equal(yearInsights(falling, "2026").some((i) => i.key === "earned"), false);
  });

  test("it projects a payoff only while the debt is falling", () => {
    const debt = yearInsights(shapes, "2026").find((i) => i.key === "debt");
    assert.match(debt!.headline, /fell 50%/);
    assert.equal(debt!.tone, "positive");
  });

  test("and calls out debt that grew instead", () => {
    const worse = yearShapes(
      [row("2025", { netWorth: 150000 }), row("2026", { netWorth: 200000 })],
      [
        cls("2025-12", { liabilities: 10000 }),
        cls("2026-12", { liabilities: 15000 }),
      ],
    );
    const debt = yearInsights(worse, "2026").find((i) => i.key === "debt");
    assert.equal(debt?.tone, "negative");
  });

  test("a year with nothing to compare against says less, not something wrong", () => {
    const alone = yearShapes([row("2026")], [cls("2026-12", { Cash: 1000 })]);
    const keys = yearInsights(alone, "2026").map((i) => i.key);
    assert.equal(keys.includes("spending"), false);
    assert.equal(keys.includes("debt"), false);
  });

  test("a year nobody has is no insights at all", () => {
    assert.deepEqual(yearInsights(shapes, "1999"), []);
  });
});

/*
 * The chart has to look like the same chart whether the balance is four
 * figures or eight, and it has to survive a balance under zero — which is
 * where a lot of records start, a student loan against very little.
 *
 * These pin the model rather than the drawing: every step meets the last,
 * whatever the magnitude, and the closing column is the balance sheet's own
 * figure. The scale that follows from it is computed in the chart.
 */
describe("the waterfall at any size", () => {
  const shapeFor = (openingNetWorth: number, netWorth: number, income: number, expenses: number) =>
    yearShapes(
      [
        row("2025", { netWorth: openingNetWorth }),
        row("2026", { netWorth, income, expenses }),
      ],
      [cls("2025-12"), cls("2026-12")],
    )[1];

  const cases: [string, number, number, number, number][] = [
    ["barely started", 800, 2400, 30000, 28400],
    ["under water", -48000, -21000, 62000, 35000],
    ["crossing zero", -9000, 14000, 60000, 37000],
    ["comfortable", 557619, 658770, 80616, 42327],
    ["very large", 8400000, 9100000, 400000, 180000],
    ["a year that did not move", 500000, 500000, 0, 0],
  ];

  for (const [name, opening, closing, income, expenses] of cases) {
    test(`${name}: the path closes on the balance sheet`, () => {
      const steps = yearWaterfall(shapeFor(opening, closing, income, expenses));
      let running = opening;
      for (const step of steps.slice(1, -1)) running += step.delta;
      assert.equal(Math.round(running), Math.round(closing));
      assert.equal(steps[0].top, opening);
      assert.equal(steps[steps.length - 1].top, closing);
    });

    test(`${name}: every step is a real interval`, () => {
      const steps = yearWaterfall(shapeFor(opening, closing, income, expenses));
      for (const step of steps) {
        assert.ok(Number.isFinite(step.base), `${step.label} base`);
        assert.ok(Number.isFinite(step.top), `${step.label} top`);
        assert.ok(step.top >= step.base || step.kind === "total", `${step.label} inverted`);
      }
    });
  }

  test("a balance under zero still describes its columns, rather than collapsing", () => {
    const steps = yearWaterfall(shapeFor(-48000, -21000, 62000, 35000));
    // The old rendering took top - base and clamped a negative to nothing, so
    // an under-water year drew an empty chart.
    const opening = steps[0];
    assert.equal(opening.top, -48000);
    assert.notEqual(opening.top, 0);
  });
});

/* ALL-FIXTURES-INVENTED */

const groups = (c: string) =>
  c === "Housing" || c === "Groceries"
    ? ("necessity" as const)
    : c === "Debt Repayment"
      ? ("excluded" as const)
      : ("discretionary" as const);

describe("where a year's income went", () => {
  const txns = [
    txn("2026-01-31", "income", 50000, "Salary"),
    txn("2026-02-28", "expense", 12000, "Housing"),
    txn("2026-03-31", "expense", 4000, "Groceries"),
    txn("2026-04-30", "expense", 6000, "Travel"),
    txn("2026-05-31", "expense", 3000, "Debt Repayment"),
    txn("2025-06-30", "expense", 9999, "Housing"),
  ];

  test("the parts add back to the income", () => {
    const a = incomeAllocation(txns, "2026", groups);
    assert.equal(a.income, 50000);
    assert.equal(a.necessities + a.discretionary + a.debt + a.saved, a.income);
  });

  test("debt repayment is kept out of spending", () => {
    const a = incomeAllocation(txns, "2026", groups);
    assert.equal(a.debt, 3000);
    assert.equal(a.discretionary, 6000);
  });

  test("another year's spending is not this year's", () => {
    assert.equal(incomeAllocation(txns, "2026", groups).necessities, 16000);
  });

  test("spending past the income shows as a negative remainder", () => {
    const over = [txn("2026-01-31", "income", 1000, "Salary"), txn("2026-02-01", "expense", 2500, "Travel")];
    assert.equal(incomeAllocation(over, "2026", groups).saved, -1500);
  });

  test("a year with no income is empty rather than a divide by zero", () => {
    const a = incomeAllocation([txn("2026-02-01", "expense", 100, "Travel")], "2026", groups);
    assert.equal(a.income, 0);
    assert.equal(a.saved, -100);
  });
});

describe("what changed against last year", () => {
  const txns = [
    txn("2026-01-31", "expense", 5000, "Travel"),
    txn("2025-01-31", "expense", 1000, "Travel"),
    txn("2026-02-28", "expense", 1000, "Groceries"),
    txn("2025-02-28", "expense", 4000, "Groceries"),
    txn("2026-03-31", "expense", 200, "Health"),
  ];

  test("the largest movers come first, whichever way they moved", () => {
    const rows = categoryShifts(txns, "2026");
    assert.deepEqual(rows.map((r) => r.category), ["Travel", "Groceries", "Health"]);
    assert.equal(rows[0].change, 4000);
    assert.equal(rows[1].change, -3000);
  });

  test("a category that appeared this year counts as its whole self", () => {
    const rows = categoryShifts(txns, "2026");
    assert.equal(rows.find((r) => r.category === "Health")?.change, 200);
  });

  test("a category that did not move is left out", () => {
    const steady = [
      txn("2026-01-31", "expense", 500, "Groceries"),
      txn("2025-01-31", "expense", 500, "Groceries"),
    ];
    assert.deepEqual(categoryShifts(steady, "2026"), []);
  });

  test("a first year reports its own spending as the whole change", () => {
    const only = [txn("2026-01-31", "expense", 500, "Groceries")];
    assert.equal(categoryShifts(only, "2026")[0].change, 500);
  });

  test("a year the record does not reach has nothing to report", () => {
    const only = [txn("2026-01-31", "expense", 500, "Groceries")];
    assert.deepEqual(categoryShifts(only, "2024"), []);
  });
});

describe("what the cash flow says", () => {
  const txns = [
    txn("2026-01-31", "income", 10000, "Salary"),
    txn("2026-01-31", "expense", 3000, "Housing"),
    txn("2026-02-28", "income", 10000, "Salary"),
    txn("2026-02-28", "expense", 9000, "Travel"),
    txn("2026-03-31", "income", 10000, "Salary"),
    txn("2026-03-31", "expense", 1000, "Travel"),
  ];

  test("it says how much of income was committed before any choice", () => {
    const i = cashflowInsights(txns, "2026", groups).find((x) => x.key === "committed");
    // 3,000 of necessities against 30,000 of income.
    assert.match(i!.headline, /10%/);
  });

  test("it names the months that did the most and least work", () => {
    const i = cashflowInsights(txns, "2026", groups).find((x) => x.key === "months");
    assert.match(i!.headline, /Mar 2026 kept the most/);
    assert.match(i!.headline, /Feb 2026 the least/);
  });

  test("too few months to have extremes says nothing about them", () => {
    const short = [txn("2026-01-31", "income", 10000, "Salary")];
    assert.equal(cashflowInsights(short, "2026", groups).some((x) => x.key === "months"), false);
  });

  test("a year with no income says nothing at all", () => {
    assert.deepEqual(cashflowInsights([txn("2026-01-01", "expense", 10, "Travel")], "2026", groups), []);
  });
});

describe("what you put in, against what it became", () => {
  test("contributions accumulate while the value is read as it stands", () => {
    const pts = contributionsVsValue([
      row("2024", { investmentFlows: 10000, portfolio: 10500 }),
      row("2025", { investmentFlows: 12000, portfolio: 26000 }),
      row("2026", { investmentFlows: 8000, portfolio: 42000 }),
    ]);
    assert.deepEqual(pts.map((p) => p.contributed), [10000, 22000, 30000]);
    assert.deepEqual(pts.map((p) => p.value), [10500, 26000, 42000]);
  });

  test("a withdrawal pulls the contributed line back down", () => {
    const pts = contributionsVsValue([
      row("2025", { investmentFlows: 20000, portfolio: 21000 }),
      row("2026", { investmentFlows: -5000, portfolio: 17000 }),
    ]);
    assert.equal(pts[1].contributed, 15000);
  });

  test("years before anything was invested are left out", () => {
    const pts = contributionsVsValue([
      row("2023", { investmentFlows: 0, portfolio: 0 }),
      row("2024", { investmentFlows: 0, portfolio: 0 }),
      row("2025", { investmentFlows: 5000, portfolio: 5100 }),
    ]);
    assert.deepEqual(pts.map((p) => p.label), ["2025"]);
  });
});

describe("where the income came from", () => {
  const txns = [
    txn("2025-01-31", "income", 50000, "Salary"),
    txn("2025-06-30", "income", 400, "Dividends"),
    txn("2026-01-31", "income", 52000, "Salary"),
    txn("2026-06-30", "income", 3000, "Dividends"),
    txn("2026-07-31", "income", 900, "Interest"),
    txn("2026-08-31", "income", 20000, "Loan Proceeds"),
  ];

  test("a year is a row and a source is a column", () => {
    const { rows, sources } = incomeMix(txns);
    assert.deepEqual(rows.map((r) => r.label), ["2025", "2026"]);
    assert.ok(sources.includes("Salary"));
    assert.equal(rows[1].Dividends, 3000);
  });

  test("borrowed money is not a source of income", () => {
    const { rows, sources } = incomeMix(txns);
    assert.equal(sources.includes("Loan Proceeds"), false);
    assert.equal(rows[1]["Loan Proceeds"], undefined);
  });

  test("sources past the limit are pooled rather than dropped", () => {
    const { rows, sources } = incomeMix(txns, 1);
    assert.deepEqual(sources, ["Salary", "Other"]);
    // Dividends and interest, neither lost nor listed.
    assert.equal(rows[1].Other, 3900);
  });

  test("the share that did not come from working", () => {
    // 3,900 of 55,900, borrowing excluded.
    assert.equal(Math.round(unearnedShare(txns, "2026")!), 7);
  });

  test("a year that earned nothing has no share, rather than zero", () => {
    assert.equal(unearnedShare(txns, "2019"), null);
  });
});

describe("income as shares of each year", () => {
  const txns = [
    txn("2025-01-31", "income", 90000, "Salary"),
    txn("2025-06-30", "income", 10000, "Dividends"),
    txn("2026-01-31", "income", 75000, "Salary"),
    txn("2026-06-30", "income", 25000, "Dividends"),
  ];

  test("each year adds to a hundred", () => {
    const rows = incomeMixShares(incomeMix(txns));
    for (const row of rows) {
      const total = Object.entries(row)
        .filter(([k]) => k !== "label")
        .reduce((a, [, v]) => a + Number(v), 0);
      assert.equal(Math.round(total), 100);
    }
  });

  test("a source growing as a share is visible even when the total grew too", () => {
    const rows = incomeMixShares(incomeMix(txns));
    assert.equal(Math.round(Number(rows[0].Dividends)), 10);
    assert.equal(Math.round(Number(rows[1].Dividends)), 25);
  });

  test("a year with no income stays in the run at zero rather than vanishing", () => {
    const gap = incomeMixShares({
      rows: [{ label: "2025", Salary: 100 }, { label: "2026", Salary: 0 }],
      sources: ["Salary"],
    });
    assert.equal(gap.length, 2);
    assert.equal(gap[1].Salary, 0);
  });
});

describe("pension in, pension out", () => {
  const txns = [
    txn("2026-01-31", "income", 60000, "Salary"),
    txn("2026-02-28", "income", 6000, "RSP / Pension"),
    txn("2026-03-31", "income", 30000, "Pension Income"),
    txn("2026-04-30", "income", 4000, "Dividends"),
  ];

  test("a contribution is earned; an annuity is not", () => {
    // 30,000 of annuity and 4,000 of dividends against 100,000 of income.
    assert.equal(Math.round(unearnedShare(txns, "2026")!), 34);
  });

  test("saving into a plan does not make you look less independent", () => {
    const saving = [
      txn("2026-01-31", "income", 60000, "Salary"),
      txn("2026-02-28", "income", 40000, "RSP / Pension"),
    ];
    assert.equal(unearnedShare(saving, "2026"), 0);
  });

  test("freelance work counts as work", () => {
    const gig = [
      txn("2026-01-31", "income", 50000, "Salary"),
      txn("2026-02-28", "income", 50000, "Freelance"),
    ];
    assert.equal(unearnedShare(gig, "2026"), 0);
  });

  test("the two show as separate sources in the mix", () => {
    const { sources } = incomeMix(txns);
    assert.ok(sources.includes("RSP / Pension"));
    assert.ok(sources.includes("Pension Income"));
  });
});

describe("income split active against passive", () => {
  const txns = [
    txn("2026-01-31", "income", 60000, "Salary"),
    txn("2026-02-28", "income", 6000, "RSP / Pension"),
    txn("2026-03-31", "income", 30000, "Pension Income"),
    txn("2026-04-30", "income", 4000, "Dividends"),
  ];

  test("the two shares add to a hundred", () => {
    const [row] = incomeTypeShares(txns);
    assert.equal(Math.round(Number(row.Active) + Number(row.Passive)), 100);
  });

  test("a pension contribution is active and a pension payment is passive", () => {
    const [row] = incomeTypeShares(txns);
    // 66,000 of work against 34,000 that arrived without it.
    assert.equal(Math.round(Number(row.Active)), 66);
  });

  test("it agrees with the sentence beside it", () => {
    const [row] = incomeTypeShares(txns);
    assert.equal(Math.round(Number(row.Passive)), Math.round(unearnedShare(txns, "2026")!));
  });
});

/*
 * The trunk is what makes the flow chart honest: both halves have to meet in
 * the middle, so it cannot draw more leaving than arrived.
 */
describe("the year as one flow", () => {
  const txns = [
    txn("2026-01-31", "income", 60000, "Salary"),
    txn("2026-02-28", "income", 5000, "Dividends"),
    txn("2026-03-31", "expense", 20000, "Housing"),
    txn("2026-04-30", "expense", 9000, "Groceries"),
  ];

  const into = (f: ReturnType<typeof yearFlow>, name: string) =>
    f.links.filter((l) => f.nodes[l.target].name === name).reduce((a, l) => a + l.value, 0);
  const outOf = (f: ReturnType<typeof yearFlow>, name: string) =>
    f.links.filter((l) => f.nodes[l.source].name === name).reduce((a, l) => a + l.value, 0);

  test("everything arriving at the trunk leaves it again", () => {
    const f = yearFlow(txns, "2026");
    assert.equal(Math.round(into(f, "2026")), Math.round(outOf(f, "2026")));
  });

  test("what was not spent leaves as kept", () => {
    const f = yearFlow(txns, "2026");
    assert.equal(into(f, "Kept"), 36000);
  });

  test("a year that overspent draws where the rest came from", () => {
    const over = [
      txn("2026-01-31", "income", 10000, "Salary"),
      txn("2026-02-28", "expense", 25000, "Housing"),
    ];
    const f = yearFlow(over, "2026");
    assert.equal(into(f, "2026"), 25000);
    assert.equal(outOf(f, "From savings"), 15000);
    assert.equal(f.nodes.some((n) => n.name === "Kept"), false);
  });

  test("transfers are not a flow through the year", () => {
    const withTransfer = [
      ...txns,
      { ...txn("2026-05-31", "income", 50000, "Transfer"), type: "transfer" } as unknown as (typeof txns)[number],
    ];
    assert.equal(into(yearFlow(withTransfer, "2026"), "2026"), into(yearFlow(txns, "2026"), "2026"));
  });

  test("sources past the limit are pooled rather than dropped", () => {
    const f = yearFlow(txns, "2026", { limit: 1 });
    assert.equal(Math.round(into(f, "2026")), 65000);
    assert.ok(f.nodes.some((n) => n.name === "Other income"));
  });

  test("a year with nothing in it draws nothing", () => {
    assert.deepEqual(yearFlow([], "2026"), { nodes: [], links: [] });
  });
});

/*
 * The middle column. A year's money is not one pool: it lands in an account
 * and leaves that account again, and which one it left is the question a cash
 * flow is actually asked.
 */
describe("the flow through the accounts", () => {
  const accounts = [
    { id: "a-chq", name: "Chequing", kind: "checking" as const },
    { id: "a-inv", name: "Portfolio", kind: "investment" as const },
  ];
  const at = (
    date: string,
    type: "income" | "expense" | "transfer",
    amount: number,
    category: string,
    from?: string,
    to?: string,
  ) =>
    ({
      ...txn(date, type === "transfer" ? "expense" : type, amount, category),
      type,
      sourceAccountId: from,
      destinationAccountId: to,
    }) as unknown as Transaction;

  const rows = [
    at("2026-01-31", "income", 60000, "Salary", undefined, "a-chq"),
    at("2026-03-31", "expense", 20000, "Housing", "a-chq"),
    at("2026-04-30", "transfer", 15000, "Transfer", "a-chq", "a-inv"),
  ];
  const into = (f: ReturnType<typeof yearFlow>, name: string) =>
    f.links.filter((l) => f.nodes[l.target].name === name).reduce((a, l) => a + l.value, 0);
  const outOf = (f: ReturnType<typeof yearFlow>, name: string) =>
    f.links.filter((l) => f.nodes[l.source].name === name).reduce((a, l) => a + l.value, 0);

  test("income lands in the account it was paid into", () => {
    const f = yearFlow(rows, "2026", { accounts });
    assert.equal(into(f, "Chequing"), 60000);
  });

  test("an account cannot pay out more than reached it", () => {
    const f = yearFlow(rows, "2026", { accounts });
    assert.equal(into(f, "Chequing"), outOf(f, "Chequing"));
  });

  test("a deposit into an invested account is drawn as a destination", () => {
    const f = yearFlow(rows, "2026", { accounts });
    assert.equal(into(f, "Portfolio"), 15000);
  });

  test("what the account did not pay out is still kept", () => {
    const f = yearFlow(rows, "2026", { accounts });
    assert.equal(into(f, "Kept"), 25000);
  });

  test("a transfer between two cash accounts is not a flow through the year", () => {
    const cash = [...accounts, { id: "a-sav", name: "Savings", kind: "savings" as const }];
    const shuffled = [...rows, at("2026-05-31", "transfer", 5000, "Transfer", "a-chq", "a-sav")];
    assert.equal(
      into(yearFlow(shuffled, "2026", { accounts: cash }), "Chequing"),
      into(yearFlow(rows, "2026", { accounts: cash }), "Chequing"),
    );
  });

  test("spending from an account income never reached says where it came from", () => {
    const f = yearFlow([at("2026-02-28", "expense", 9000, "Groceries", "a-chq")], "2026", { accounts });
    assert.equal(outOf(f, "From savings"), 9000);
    assert.equal(f.nodes.some((n) => n.name === "Kept"), false);
  });

  test("a row naming no account still routes through the year", () => {
    const f = yearFlow([...rows, txn("2026-06-30", "expense", 4000, "Travel")], "2026", { accounts });
    assert.equal(outOf(f, "2026"), 4000);
  });
});

/*
 * The split before the detail. How a year divided between spending and
 * investing is one glance; which categories and which accounts is the next.
 */
describe("what the money left an account for", () => {
  const accounts = [
    { id: "a-chq", name: "Chequing", kind: "checking" as const },
    { id: "a-inv", name: "Portfolio", kind: "investment" as const },
  ];
  const at = (
    date: string,
    type: "income" | "expense" | "transfer",
    amount: number,
    category: string,
    from?: string,
    to?: string,
  ) =>
    ({
      ...txn(date, type === "transfer" ? "expense" : type, amount, category),
      type,
      sourceAccountId: from,
      destinationAccountId: to,
    }) as unknown as Transaction;

  const rows = [
    at("2026-01-31", "income", 60000, "Salary", undefined, "a-chq"),
    at("2026-03-31", "expense", 20000, "Housing", "a-chq"),
    at("2026-03-31", "expense", 5000, "Travel", "a-chq"),
    at("2026-04-30", "transfer", 15000, "Transfer", "a-chq", "a-inv"),
  ];
  const f = yearFlow(rows, "2026", { accounts });
  const into = (name: string) =>
    f.links.filter((l) => f.nodes[l.target].name === name).reduce((a, l) => a + l.value, 0);
  const outOf = (name: string) =>
    f.links.filter((l) => f.nodes[l.source].name === name).reduce((a, l) => a + l.value, 0);
  const edge = (from: string, to: string) =>
    f.links
      .filter((l) => f.nodes[l.source].name === from && f.nodes[l.target].name === to)
      .reduce((a, l) => a + l.value, 0);

  test("spending ends at whether it could have been avoided", () => {
    assert.equal(edge("Chequing", "Spending"), 25000);
    assert.equal(edge("Spending", "Necessity"), 20000);
    assert.equal(edge("Spending", "Discretionary"), 5000);
    // The categories themselves are not drawn: two ends, not ten.
    assert.equal(f.nodes.some((n) => n.name === "Housing"), false);
    assert.equal(f.nodes.some((n) => n.name === "Travel"), false);
  });

  test("paying off debt is not counted as consumption", () => {
    const d = yearFlow(
      [
        at("2026-01-31", "income", 30000, "Salary", undefined, "a-chq"),
        at("2026-02-28", "expense", 7000, "Debt Repayment", "a-chq"),
      ],
      "2026",
      { accounts },
    );
    const e = (from: string, to: string) =>
      d.links
        .filter((l) => d.nodes[l.source].name === from && d.nodes[l.target].name === to)
        .reduce((a, l) => a + l.value, 0);
    assert.equal(e("Chequing", "Spending"), 7000);
    assert.equal(e("Spending", "Not consumption"), 7000);
    assert.equal(d.nodes.some((n) => n.name === "Debt Repayment"), false);
  });

  test("an override moves a category to the other branch", () => {
    const o = yearFlow(rows, "2026", {
      accounts,
      spendGroup: (c) => (c === "Travel" ? "necessity" : groupOf(c)),
    });
    const e = (from: string, to: string) =>
      o.links
        .filter((l) => o.nodes[l.source].name === from && o.nodes[l.target].name === to)
        .reduce((a, l) => a + l.value, 0);
    assert.equal(e("Spending", "Necessity"), 25000);
    assert.equal(o.nodes.some((n) => n.name === "Discretionary"), false);
  });

  test("every node says what it is, so colour is not read off the name", () => {
    const role = (n: string) => f.nodes.find((x) => x.name === n)?.role;
    assert.equal(role("Salary"), "source");
    assert.equal(role("Chequing"), "account");
    assert.equal(role("Kept"), "kept");
    // Each end of the spending branch is its own colour.
    assert.equal(role("Necessity"), "necessity");
    assert.equal(role("Discretionary"), "discretionary");
    // An account that buys things reads as the invested side, not as cash.
    assert.equal(role("Portfolio"), "investing");
  });

  test("a deposit goes straight to the account, with no purpose between", () => {
    // A transfer is not spending and not yet a purchase; it is the money
    // moving to where the buying happens.
    assert.equal(edge("Chequing", "Portfolio"), 15000);
    assert.equal(edge("Spending", "Portfolio"), 0);
  });

  test("a group passes on exactly what it was given", () => {
    for (const g of ["Spending", "Investing"]) assert.equal(into(g), outOf(g));
  });

  test("the account still balances across the extra column", () => {
    assert.equal(into("Chequing"), outOf("Chequing"));
  });

  test("kept stays one node with nothing under it", () => {
    assert.equal(into("Kept"), 20000);
    assert.equal(outOf("Kept"), 0);
  });

  test("an account that took money in but bought nothing is not called kept", () => {
    // Either cash sitting there or purchases whose trades were never
    // imported. Neither is money deliberately unspent.
    assert.equal(into("Not itemised"), 15000);
    assert.equal(into("Kept"), 20000);
  });
});

/*
 * The invested side. A deposit into an account and a purchase inside it are
 * two different events, and a sale is money arriving rather than a ribbon
 * running backwards.
 */
describe("what the money bought", () => {
  const accounts = [
    { id: "a-chq", name: "Chequing", kind: "checking" as const },
    { id: "a-rrsp", name: "RRSP", kind: "investment" as const },
  ];
  const at = (
    date: string,
    type: "income" | "expense" | "transfer",
    amount: number,
    category: string,
    from?: string,
    to?: string,
  ) =>
    ({
      ...txn(date, type === "transfer" ? "expense" : type, amount, category),
      type,
      sourceAccountId: from,
      destinationAccountId: to,
    }) as unknown as Transaction;

  const holding = (
    assetClass: "US Equity" | "Bonds",
    flows: { date: string; kind: "buy" | "sell" | "dividend"; amount: number }[],
    accountId = "a-rrsp",
  ) =>
    ({
      accountId,
      assetClass,
      flows: flows.map((f) => ({ ...f, shares: f.kind === "sell" ? -1 : 1 })),
    }) as unknown as Parameters<typeof yearFlow>[2] extends { holdings?: infer H }
      ? H extends (infer E)[]
        ? E
        : never
      : never;

  const base = [
    at("2026-01-31", "income", 90000, "Salary", undefined, "a-chq"),
    at("2026-02-15", "transfer", 30000, "Transfer", "a-chq", "a-rrsp"),
  ];
  const holdings = [
    holding("US Equity", [{ date: "2026-03-01", kind: "buy", amount: 20000 }]),
    holding("Bonds", [{ date: "2026-03-02", kind: "buy", amount: 10000 }]),
  ];
  const f = yearFlow(base, "2026", { accounts, holdings });
  const edge = (from: string, to: string) =>
    f.links
      .filter((l) => f.nodes[l.source].name === from && f.nodes[l.target].name === to)
      .reduce((a, l) => a + l.value, 0);
  const into = (g: ReturnType<typeof yearFlow>, name: string) =>
    g.links.filter((l) => g.nodes[l.target].name === name).reduce((a, l) => a + l.value, 0);
  const outOf = (g: ReturnType<typeof yearFlow>, name: string) =>
    g.links.filter((l) => g.nodes[l.source].name === name).reduce((a, l) => a + l.value, 0);

  test("purchases break down by asset class, not by account", () => {
    assert.equal(edge("RRSP", "Bought"), 30000);
    assert.equal(edge("Bought", "US Equity"), 20000);
    assert.equal(edge("Bought", "Bonds"), 10000);
  });

  test("the account it was bought in still balances", () => {
    assert.equal(into(f, "RRSP"), 30000);
    assert.equal(outOf(f, "RRSP"), 30000);
  });

  test("a deposit and the purchase it funded are not the same dollar twice", () => {
    // 90k in, 30k moved on, 60k kept — and the 30k leaves the chequing
    // account once, then leaves the RRSP once as what it bought.
    assert.equal(edge("Chequing", "RRSP"), 30000);
    assert.equal(into(f, "Kept"), 60000);
    assert.equal(into(f, "Chequing"), outOf(f, "Chequing"));
    // The year's outflows do not include the deposit twice.
    assert.equal(edge("Chequing", "Bought"), 0);
  });

  test("a sale is a source, because a ribbon cannot run backwards", () => {
    const sold = yearFlow(base, "2026", {
      accounts,
      holdings: [
        holding("US Equity", [
          { date: "2026-03-01", kind: "buy", amount: 50000 },
          { date: "2026-06-01", kind: "sell", amount: 20000 },
        ]),
      ],
    });
    assert.equal(outOf(sold, "Sold investments"), 20000);
    assert.equal(into(sold, "RRSP"), 50000);
    assert.equal(outOf(sold, "RRSP"), 50000);
    // Netted instead, the class would be 30k and the sale invisible.
    assert.equal(into(sold, "US Equity"), 50000);
  });

  test("a dividend is not taken from the trade history", () => {
    // It is already an income row under its own category; counting the
    // holding's copy as well would inflate the year by every distribution.
    const div = yearFlow(base, "2026", {
      accounts,
      holdings: [
        holding("US Equity", [
          { date: "2026-03-01", kind: "buy", amount: 30000 },
          { date: "2026-05-01", kind: "dividend", amount: 4000 },
        ]),
      ],
    });
    assert.equal(into(div, "RRSP"), 30000);
    assert.equal(div.nodes.some((n) => n.name === "Dividends"), false);
  });

  test("buying more than was deposited says where the rest came from", () => {
    const over = yearFlow(base, "2026", {
      accounts,
      holdings: [holding("Bonds", [{ date: "2026-04-01", kind: "buy", amount: 45000 }])],
    });
    assert.equal(outOf(over, "From savings"), 15000);
    assert.equal(into(over, "RRSP"), 45000);
  });

  test("an asset class carries the colour of the branch that bought it", () => {
    const role = (n: string) => f.nodes.find((x) => x.name === n)?.role;
    assert.equal(role("US Equity"), "investing");
    assert.equal(role("Bonds"), "investing");
    assert.equal(role("RRSP"), "investing");
    assert.equal(role("Chequing"), "account");
    assert.equal(role("Salary"), "source");
  });

  test("a flow outside the year is not this year's", () => {
    const last = yearFlow(base, "2026", {
      accounts,
      holdings: [holding("Bonds", [{ date: "2025-04-01", kind: "buy", amount: 45000 }])],
    });
    assert.equal(last.nodes.some((n) => n.name === "Bonds"), false);
  });
});

/*
 * An account is the invested kind or it is not. Deciding by whether a
 * transfer happened to arrive this year read a pension paid into directly as
 * a chequing account, so its contributions came out as money left unspent.
 */
describe("an account is invested by what it is", () => {
  const accounts = [
    { id: "a-pen", name: "Pension Plan", kind: "pension" as const },
    { id: "a-chq", name: "Chequing", kind: "checking" as const },
  ];
  const rows = [
    {
      ...txn("2026-01-31", "income", 12000, "RSP / Pension"),
      destinationAccountId: "a-pen",
    } as unknown as Transaction,
    {
      ...txn("2026-01-31", "income", 40000, "Salary"),
      destinationAccountId: "a-chq",
    } as unknown as Transaction,
  ];
  const f = yearFlow(rows, "2026", { accounts });
  const into = (name: string) =>
    f.links.filter((l) => f.nodes[l.target].name === name).reduce((a, l) => a + l.value, 0);

  test("a pension paid into directly is not cash left unspent", () => {
    assert.equal(into("Not itemised"), 12000);
    assert.equal(into("Kept"), 40000);
  });

  test("and it reads as the invested side", () => {
    assert.equal(f.nodes.find((n) => n.name === "Pension Plan")?.role, "investing");
    assert.equal(f.nodes.find((n) => n.name === "Chequing")?.role, "account");
  });
});
