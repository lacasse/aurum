import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  contributionsVsValue,
  incomeMix,
  incomeMixShares,
  incomeTypeShares,
  categoryByYear,
  yearFlow,
  unearnedShare,
  milestones,
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

  test("a finished year is compared whole, with no window against it", () => {
    const [y2025] = rows;
    assert.equal(y2025.elapsed, 1);
    assert.equal(y2025.priorToDateIncome, null);
    assert.equal(y2025.priorToDateExpenses, null);
  });

  test("a running year is compared against the same window of the year before", () => {
    // By the second of July each year has taken one salary; the year before
    // took a second one in the autumn, which is not this comparison's business.
    const partial = yearRows(
      [
        txn("2024-03-01", "income", 40000, "Salary"),
        txn("2024-10-01", "income", 40000, "Salary"),
        txn("2024-05-01", "expense", 20000),
        txn("2025-03-01", "income", 50000, "Salary"),
        txn("2025-05-01", "expense", 10000),
      ],
      netWorth,
      portfolio,
      {},
      "2025-07-02",
    );
    const [y2025] = partial;
    assert.equal(y2025.income, 50000, "the figure shown is still the year so far");
    assert.equal(y2025.priorToDateIncome, 40000, "the autumn salary is out of the window");
    assert.equal(y2025.incomeGrowth, 25);
    assert.equal(y2025.priorToDateExpenses, 20000);
    assert.equal(y2025.expenseGrowth, -50);
  });

  test("the window moves with the date, not with the month", () => {
    const txns = [
      txn("2024-05-20", "expense", 10000),
      txn("2025-05-01", "expense", 3000),
    ];
    const early = yearRows(txns, netWorth, portfolio, {}, "2025-05-10")[0];
    const later = yearRows(txns, netWorth, portfolio, {}, "2025-05-31")[0];
    assert.equal(early.priorToDateExpenses, 0, "the 20th has not come round yet");
    assert.equal(early.expenseGrowth, null, "nothing to compare against");
    assert.equal(later.priorToDateExpenses, 10000);
    assert.equal(later.expenseGrowth, -70);
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

describe("paying down a loan is not spending", () => {
  test("an excluded category is kept out of the year's expenses", () => {
    const [y] = yearRows(
      [
        txn("2025-03-01", "income", 50000, "Salary"),
        txn("2025-05-01", "expense", 20000),
        txn("2025-06-01", "expense", 30000, "Debt Repayment"),
      ],
      [nw("2025-12", 40000)],
      [],
      {},
      "2026-01-01",
    );
    assert.equal(y.expenses, 20000, "the repayment is not consumption");
    assert.equal(y.netCashflow, 30000, "and so it counts as kept");
  });

  test("the caller's own assignment wins over the default", () => {
    const [y] = yearRows(
      [
        txn("2025-03-01", "income", 50000, "Salary"),
        txn("2025-05-01", "expense", 20000, "Travel"),
      ],
      [nw("2025-12", 40000)],
      [],
      {},
      "2026-01-01",
      () => "excluded",
    );
    assert.equal(y.expenses, 0, "the Expenses page decides, not this module");
  });
});

describe("what was repaid is named, opposite what was borrowed", () => {
  const base = [
    txn("2025-03-01", "income", 50000, "Salary"),
    txn("2025-05-01", "expense", 20000, "Groceries"),
    txn("2025-06-01", "expense", 5000, "Debt Repayment"),
  ];
  const flowOf = (txns: Transaction[], group?: (c: string) => "necessity" | "excluded") =>
    yearFlow(txns, "2025", group ? { spendGroup: group } : {});

  test("a band holding only repayments says so", () => {
    const names = flowOf(base).nodes.map((n) => n.name);
    assert.ok(names.includes("Debt repaid"), names.join(", "));
    assert.ok(!names.includes("Not consumption"));
  });

  test("with anything else in it, the general name is kept", () => {
    const names = flowOf(base, (c) =>
      c === "Debt Repayment" || c === "Groceries" ? "excluded" : "necessity",
    ).nodes.map((n) => n.name);
    assert.ok(names.includes("Not consumption"), names.join(", "));
    assert.ok(!names.includes("Debt repaid"));
  });

  test("a year with no repayments has neither", () => {
    const names = flowOf([base[0], base[1]]).nodes.map((n) => n.name);
    assert.ok(!names.includes("Debt repaid"));
    assert.ok(!names.includes("Not consumption"));
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
    elapsed: 1,
    priorToDateIncome: null,
    priorToDateExpenses: null,
    incomeGrowth: null,
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

  test("a gift is neither, and does not flatter the passive band", () => {
    /*
     * Read as "everything not earned by working", the passive band collected
     * gifts too, and a year with a large one reported a quarter of its income
     * as coming from assets when almost none of it had.
     */
    const withGift = [...txns, txn("2026-05-31", "income", 100000, "Gifts")];
    const [row] = incomeTypeShares(withGift);
    assert.equal(Math.round(Number(row.Passive)), 17, "the dividends and the annuity, and nothing else");
    assert.equal(Math.round(Number(row.Other)), 50, "the gift stands on its own");
    assert.equal(
      Math.round(Number(row.Active) + Number(row.Passive) + Number(row.Other)),
      100,
      "the three still account for the whole year",
    );
  });

  test("a refund and a drawdown are not income at all", () => {
    const withBoth = [
      ...txns,
      txn("2026-06-30", "income", 50000, "Refund"),
      txn("2026-07-31", "income", 50000, "Loan Proceeds"),
    ];
    assert.deepEqual(
      incomeTypeShares(withBoth)[0],
      incomeTypeShares(txns)[0],
      "money of yours coming back, and money that is not yours, change nothing",
    );
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
    assert.equal(into(f, "Left in cash"), 36000);
  });

  test("a year that overspent draws where the rest came from", () => {
    const over = [
      txn("2026-01-31", "income", 10000, "Salary"),
      txn("2026-02-28", "expense", 25000, "Housing"),
    ];
    const f = yearFlow(over, "2026");
    assert.equal(into(f, "2026"), 25000);
    assert.equal(outOf(f, "From savings"), 15000);
    assert.equal(f.nodes.some((n) => n.name === "Left in cash"), false);
  });

  test("transfers are not a flow through the year", () => {
    const withTransfer = [
      ...txns,
      { ...txn("2026-05-31", "income", 50000, "Transfer"), type: "transfer" } as unknown as (typeof txns)[number],
    ];
    assert.equal(into(yearFlow(withTransfer, "2026"), "2026"), into(yearFlow(txns, "2026"), "2026"));
  });

  test("sources past the limit are pooled rather than dropped", () => {
    const many = [
      ...txns,
      txn("2026-05-31", "income", 4000, "Freelance"),
      txn("2026-06-30", "income", 3000, "Gifts"),
    ];
    const f = yearFlow(many, "2026", { limit: 1 });
    assert.equal(Math.round(into(f, "2026")), 72000);
    assert.ok(f.nodes.some((n) => n.name === "Other income"));
  });

  test("pooling a single category would only rename it, so it does not", () => {
    // "Other income" standing for one category says less than the category
    // did and takes the same room.
    const f = yearFlow(txns, "2026", { limit: 1 });
    assert.equal(f.nodes.some((n) => n.name === "Other income"), false);
    assert.ok(f.nodes.some((n) => n.name === "Dividends"));
  });

  test("a category too thin to draw is pooled however few there are", () => {
    const lopsided = [
      txn("2026-01-31", "income", 100000, "Salary"),
      txn("2026-02-28", "income", 500, "Interest"),
      txn("2026-03-31", "income", 400, "Gifts"),
      txn("2026-04-30", "income", 300, "Dividends"),
      txn("2026-05-31", "expense", 20000, "Housing"),
    ];
    // Well inside any count cap, and still three bands of about a pixel.
    const f = yearFlow(lopsided, "2026", { limit: 8 });
    const names = f.nodes.map((n) => n.name);
    assert.ok(names.includes("Salary"));
    assert.ok(names.includes("Other income"));
    assert.equal(names.includes("Gifts"), false);
    assert.equal(
      f.links
        .filter((l) => f.nodes[l.source].name === "Other income")
        .reduce((a, l) => a + l.value, 0),
      1200,
    );
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
    { id: "a-chq", name: "Money in", kind: "checking" as const },
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

  test("income lands in the kind of place it was paid into", () => {
    const f = yearFlow(rows, "2026", { accounts });
    assert.equal(into(f, "Money in"), 60000);
    // The account's own name is not the question a cash flow is asked.
    assert.equal(f.nodes.some((n) => n.name === "Chequing"), false);
  });

  test("an account cannot pay out more than reached it", () => {
    const f = yearFlow(rows, "2026", { accounts });
    assert.equal(into(f, "Money in"), outOf(f, "Money in"));
  });

  test("a deposit into an invested account is drawn as a destination", () => {
    const f = yearFlow(rows, "2026", { accounts });
    assert.equal(into(f, "Investments"), 15000);
  });

  test("what the account did not pay out is still kept", () => {
    const f = yearFlow(rows, "2026", { accounts });
    assert.equal(into(f, "Left in cash"), 25000);
  });

  test("a transfer between two cash accounts is not a flow through the year", () => {
    const cash = [...accounts, { id: "a-sav", name: "Savings", kind: "savings" as const }];
    const shuffled = [...rows, at("2026-05-31", "transfer", 5000, "Transfer", "a-chq", "a-sav")];
    assert.equal(
      into(yearFlow(shuffled, "2026", { accounts: cash }), "Money in"),
      into(yearFlow(rows, "2026", { accounts: cash }), "Money in"),
    );
  });

  test("spending from an account income never reached says where it came from", () => {
    const f = yearFlow([at("2026-02-28", "expense", 9000, "Groceries", "a-chq")], "2026", { accounts });
    assert.equal(outOf(f, "From savings"), 9000);
    assert.equal(f.nodes.some((n) => n.name === "Left in cash"), false);
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
    { id: "a-chq", name: "Money in", kind: "checking" as const },
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
    assert.equal(edge("Money in", "Spending"), 25000);
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
    assert.equal(e("Money in", "Spending"), 7000);
    assert.equal(e("Spending", "Debt repaid"), 7000);
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
    assert.equal(role("Money in"), "account");
    assert.equal(role("Left in cash"), "kept");
    // Each end of the spending branch is its own colour.
    assert.equal(role("Necessity"), "necessity");
    assert.equal(role("Discretionary"), "discretionary");
    // The invested bar reads as the invested side, not as cash.
    assert.equal(role("Investments"), "investing");
  });

  test("a deposit goes straight to the invested bar, with no purpose between", () => {
    // A transfer is not spending and not yet a purchase; it is the money
    // moving to where the buying happens.
    assert.equal(edge("Money in", "Investments"), 15000);
    assert.equal(edge("Spending", "Investments"), 0);
  });

  test("a group passes on exactly what it was given", () => {
    for (const g of ["Spending", "Investing"]) assert.equal(into(g), outOf(g));
  });

  test("the account still balances across the extra column", () => {
    assert.equal(into("Money in"), outOf("Money in"));
  });

  test("kept stays one node with nothing under it", () => {
    assert.equal(into("Left in cash"), 20000);
    assert.equal(outOf("Left in cash"), 0);
  });

  test("an account that took money in but bought nothing is not called kept", () => {
    // Either cash sitting there or purchases whose trades were never
    // imported. Neither is money deliberately unspent.
    assert.equal(into("Not itemised"), 15000);
    assert.equal(into("Left in cash"), 20000);
  });
});

/*
 * The invested side. A deposit into an account and a purchase inside it are
 * two different events, and a sale is money arriving rather than a ribbon
 * running backwards.
 */
describe("what the money bought", () => {
  const accounts = [
    { id: "a-chq", name: "Money in", kind: "checking" as const },
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

  test("purchases break down by asset class, hung off the invested bar", () => {
    // No node between them: the bar is already what the money was for, and a
    // shared one would merge the buys before splitting them again.
    assert.equal(edge("Investments", "US Equity"), 20000);
    assert.equal(edge("Investments", "Bonds"), 10000);
    assert.equal(f.nodes.some((n) => n.name === "Bought"), false);
  });

  test("the invested bar balances, however many accounts fed it", () => {
    assert.equal(into(f, "Investments"), 30000);
    assert.equal(outOf(f, "Investments"), 30000);
  });

  test("every invested account answers to the one bar", () => {
    const two = yearFlow(
      [
        ...base,
        at("2026-02-20", "transfer", 10000, "Transfer", "a-chq", "a-tfsa"),
      ],
      "2026",
      {
        accounts: [...accounts, { id: "a-tfsa", name: "TFSA", kind: "investment" as const }],
        holdings: [
          holding("US Equity", [{ date: "2026-03-01", kind: "buy", amount: 40000 }]),
        ],
      },
    );
    assert.equal(into(two, "Investments"), 40000);
    assert.equal(two.nodes.some((n) => n.name === "TFSA"), false);
    assert.equal(two.nodes.some((n) => n.name === "RRSP"), false);
  });

  test("a deposit and the purchase it funded are not the same dollar twice", () => {
    // 90k in, 30k moved on, 60k kept — and the 30k leaves the chequing
    // account once, then leaves the RRSP once as what it bought.
    assert.equal(edge("Money in", "Investments"), 30000);
    assert.equal(into(f, "Left in cash"), 60000);
    assert.equal(into(f, "Money in"), outOf(f, "Money in"));
    // The year's outflows do not include the deposit twice.
    assert.equal(edge("Money in", "US Equity"), 0);
  });

  test("buying and selling the same class nets, and the trading vanishes", () => {
    /*
     * Gross, both legs are drawn and a year that traded heavily without
     * changing the size of its portfolio dwarfs the salary that paid for it.
     * Netted, what is drawn is what the year actually put in.
     */
    const churned = yearFlow(base, "2026", {
      accounts,
      holdings: [
        holding("US Equity", [
          { date: "2026-03-01", kind: "buy", amount: 50000 },
          { date: "2026-06-01", kind: "sell", amount: 20000 },
        ]),
      ],
    });
    assert.equal(into(churned, "US Equity"), 30000, "what was put in, not what was traded");
    assert.equal(
      churned.nodes.some((n) => n.name === "Sold investments"),
      false,
      "no sale on the left, because the class ended the year up",
    );
  });

  test("a round trip is not drawn at all", () => {
    const roundTrip = yearFlow(base, "2026", {
      accounts,
      holdings: [
        holding("US Equity", [
          { date: "2026-03-01", kind: "buy", amount: 40000 },
          { date: "2026-09-01", kind: "sell", amount: 40000 },
        ]),
      ],
    });
    assert.equal(
      roundTrip.nodes.some((n) => n.name === "US Equity"),
      false,
      "bought and sold back, so nothing about the year's money changed",
    );
  });

  test("a class sold down is a source, because a ribbon cannot run backwards", () => {
    const sold = yearFlow(base, "2026", {
      accounts,
      holdings: [
        holding("US Equity", [
          { date: "2026-03-01", kind: "buy", amount: 10000 },
          { date: "2026-06-01", kind: "sell", amount: 35000 },
        ]),
      ],
    });
    assert.equal(outOf(sold, "Sold investments"), 25000, "the net released, not the gross sold");
    assert.equal(
      sold.nodes.some((n) => n.name === "US Equity"),
      false,
      "a class the year took money out of is not somewhere the money went",
    );
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
    assert.equal(into(div, "Investments"), 30000);
    assert.equal(div.nodes.some((n) => n.name === "Dividends"), false);
  });

  test("buying more than was deposited says where the rest came from", () => {
    const over = yearFlow(base, "2026", {
      accounts,
      holdings: [holding("Bonds", [{ date: "2026-04-01", kind: "buy", amount: 45000 }])],
    });
    assert.equal(outOf(over, "From savings"), 15000);
    assert.equal(into(over, "Investments"), 45000);
  });

  test("an asset class carries the colour of the branch that bought it", () => {
    const role = (n: string) => f.nodes.find((x) => x.name === n)?.role;
    assert.equal(role("US Equity"), "investing");
    assert.equal(role("Bonds"), "investing");
    assert.equal(role("Investments"), "investing");
    assert.equal(role("Money in"), "account");
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
    { id: "a-chq", name: "Money in", kind: "checking" as const },
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

  test("a contribution buys an entitlement, not idle cash", () => {
    assert.equal(into("Pension"), 12000);
    assert.equal(into("Left in cash"), 40000);
    assert.equal(f.nodes.some((n) => n.name === "Not itemised"), false);
  });

  test("the plan is its own asset, beside the classes that were bought", () => {
    assert.equal(f.nodes.find((n) => n.name === "Pension")?.role, "pension");
    assert.equal(f.nodes.find((n) => n.name === "Investments")?.role, "investing");
    assert.equal(f.nodes.find((n) => n.name === "Money in")?.role, "account");
  });

  test("a plan that does report its holdings is not counted twice", () => {
    const both = yearFlow(rows, "2026", {
      accounts,
      holdings: [
        {
          accountId: "a-pen",
          assetClass: "Bonds",
          flows: [{ date: "2026-03-01", kind: "buy", amount: 9000, shares: 1 }],
        },
      ] as unknown as NonNullable<Parameters<typeof yearFlow>[2]>["holdings"],
    });
    const got = (n: string) =>
      both.links.filter((l) => both.nodes[l.target].name === n).reduce((a, l) => a + l.value, 0);
    assert.equal(got("Bonds"), 9000);
    assert.equal(got("Pension"), 3000);
  });
});

/*
 * Cards. The demo fixture has no card payments at all, so nothing exercised
 * this until the numbers were questioned.
 */
describe("spending on a card is spending", () => {
  const accounts = [
    { id: "a-chq", name: "Chequing", kind: "checking" as const },
    { id: "a-card", name: "Gold Card", kind: "credit" as const },
  ];
  const t = (
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
    t("2026-01-31", "income", 50000, "Salary", undefined, "a-chq"),
    t("2026-02-10", "expense", 12000, "Groceries", "a-card"),
    t("2026-03-10", "expense", 8000, "Housing", "a-chq"),
    // Paying the card off: a transfer between two of your own accounts.
    t("2026-02-28", "transfer", 12000, "Transfer", "a-chq", "a-card"),
  ];
  const f = yearFlow(rows, "2026", { accounts });
  const into = (n: string) =>
    f.links.filter((l) => f.nodes[l.target].name === n).reduce((a, l) => a + l.value, 0);
  const outOf = (n: string) =>
    f.links.filter((l) => f.nodes[l.source].name === n).reduce((a, l) => a + l.value, 0);

  test("a card is not a place of its own", () => {
    assert.equal(f.nodes.some((n) => n.name === "Gold Card"), false);
    assert.equal(f.nodes.some((n) => n.name === "Credit"), false);
  });

  test("the card's spending is funded by the year, not invented on the left", () => {
    // The old shape charged the card's 12k to "From savings" and let the
    // salary that paid it fall out as cash left over — two equal errors that cancelled.
    assert.equal(f.nodes.some((n) => n.name === "From savings"), false);
    assert.equal(into("Spending"), 20000);
    assert.equal(into("Left in cash"), 30000);
  });

  test("paying the card off is not a second flow", () => {
    // 50k in, 20k spent, 30k kept. The payment moves nothing the chart can see.
    assert.equal(into("Money in"), 50000);
    assert.equal(outOf("Money in"), 50000);
  });

  test("the same year without the payment reads identically", () => {
    // Whether the balance was settled before year end is a question about a
    // balance, not about what the year spent.
    const unpaid = yearFlow(rows.slice(0, 3), "2026", { accounts });
    const spend = (g: ReturnType<typeof yearFlow>) =>
      g.links.filter((l) => g.nodes[l.target].name === "Spending").reduce((a, l) => a + l.value, 0);
    assert.equal(spend(unpaid), spend(f));
  });
});

/*
 * What is left over is the floor of its group, whatever it adds up to. A
 * reader who finds it partway up the column has to stop and check it is not a
 * category.
 */
describe("the pooled remainder sits under the categories", () => {
  const rows = [
    txn("2026-01-31", "income", 100000, "Salary"),
    txn("2026-02-28", "income", 900, "Interest"),
    txn("2026-03-31", "income", 800, "Gifts"),
    txn("2026-04-30", "income", 700, "Dividends"),
    // Smaller than the pooled remainder will be, and still a category.
    txn("2026-05-31", "income", 2000, "Freelance"),
    txn("2026-06-30", "expense", 20000, "Housing"),
  ];
  const f = yearFlow(rows, "2026");
  const order = f.nodes.map((n) => n.name);

  test("it is pooled even though nothing is near the count cap", () => {
    assert.ok(order.includes("Other income"));
    assert.equal(order.includes("Interest"), false);
  });

  test("it comes after every named category, though it outweighs one", () => {
    const other = order.indexOf("Other income");
    assert.ok(other > order.indexOf("Salary"));
    assert.ok(other > order.indexOf("Freelance"));
    const pooled = f.links
      .filter((l) => f.nodes[l.source].name === "Other income")
      .reduce((a, l) => a + l.value, 0);
    assert.equal(pooled, 2400);
    assert.ok(pooled > 2000, "and it does outweigh Freelance");
  });
});

describe("categoryByYear", () => {
  const e = (date: string, amount: number, category: string) =>
    txn(date, "expense", amount, category);
  const rows = [
    e("2023-01-01", 100, "Groceries"),
    e("2024-01-01", 200, "Groceries"),
    e("2025-01-01", 300, "Groceries"),
    e("2026-01-01", 400, "Groceries"),
    e("2027-01-01", 500, "Groceries"),
    e("2027-02-01", 50, "Travel"),
  ];

  test("the most recent years only, oldest first", () => {
    const r = categoryByYear(rows);
    assert.deepEqual(r.years, ["2024", "2025", "2026", "2027"], "2023 falls off the end");
    assert.deepEqual(r.years, [...r.years].sort(), "drawn in reading order");
  });

  test("how many years is a choice", () => {
    assert.deepEqual(categoryByYear(rows, { years: 2 }).years, ["2026", "2027"]);
  });

  test("a category carries a total under each year drawn", () => {
    const g = categoryByYear(rows).rows.find((x) => x.category === "Groceries")!;
    assert.equal(g["2024"], 200);
    assert.equal(g["2027"], 500);
  });

  test("a year the category did not appear in is nought, not missing", () => {
    const g = categoryByYear(rows).rows.find((x) => x.category === "Travel")!;
    assert.equal(g["2024"], 0, "drawn as no bar rather than skipped");
    assert.equal(g["2027"], 50);
  });

  test("categories rank by what they cost across the years drawn", () => {
    const r = categoryByYear(rows);
    assert.deepEqual(r.rows.map((x) => x.category), ["Groceries", "Travel"]);
  });

  test("the tail is pooled, so the categories still add up to the spending", () => {
    const many = [
      ...Array.from({ length: 12 }, (_, i) => e("2026-01-01", 100 - i, `Cat${i}`)),
    ];
    const r = categoryByYear(many, { limit: 3 });
    const names = r.rows.map((x) => x.category);
    assert.equal(names.length, 4, "three categories and the remainder");
    assert.equal(names[names.length - 1], "Other");
    const drawn = r.rows.reduce((a, x) => a + Number(x["2026"]), 0);
    const spent = many.reduce((a, t) => a + Number(t.amount), 0);
    assert.equal(drawn, spent, "nothing is left off the chart");
  });

  test("pooling one category would rename it and save nothing", () => {
    const four = Array.from({ length: 4 }, (_, i) => e("2026-01-01", 100 - i, `Cat${i}`));
    const names = categoryByYear(four, { limit: 3 }).rows.map((x) => x.category);
    assert.deepEqual(names, ["Cat0", "Cat1", "Cat2", "Cat3"], "no lone remainder");
  });

  test("income is not spending", () => {
    const mixed = [e("2026-01-01", 100, "Groceries"), txn("2026-02-01", "income", 900, "Salary")];
    const names = categoryByYear(mixed).rows.map((x) => x.category);
    assert.deepEqual(names, ["Groceries"]);
  });

  test("a record with nothing spent draws nothing", () => {
    assert.deepEqual(categoryByYear([]), { years: [], rows: [] });
  });
});

/*
 * Three faults found by looking at a real year rather than a made-up one. Each
 * was a rule that worked on data shaped the way the sample data is shaped.
 */
describe("the flow, on shapes the sample data does not have", () => {
  const accounts = [
    { id: "a-chq", name: "Chequing", kind: "checking" as const },
    { id: "a-inv", name: "Brokerage", kind: "investment" as const },
    { id: "a-rsp", name: "Plan", kind: "pension" as const },
  ];
  const at = (
    type: "income" | "expense" | "transfer",
    amount: number,
    category: string,
    from?: string,
    to?: string,
  ) =>
    ({
      id: `${category}${amount}${from ?? ""}${to ?? ""}`,
      date: "2026-06-15",
      type,
      amount,
      category,
      payee: "p",
      sourceAccountId: from,
      destinationAccountId: to,
    }) as unknown as Transaction;

  const columnsOf = (f: ReturnType<typeof yearFlow>) => {
    const d = f.nodes.map(() => 0);
    for (let pass = 0; pass < f.nodes.length; pass++) {
      let moved = false;
      for (const l of f.links) {
        if (d[l.target] < d[l.source] + 1) { d[l.target] = d[l.source] + 1; moved = true; }
      }
      if (!moved) break;
    }
    return Math.max(...d) + 1;
  };
  const edge = (f: ReturnType<typeof yearFlow>, from: string, to: string) =>
    f.links
      .filter((l) => f.nodes[l.source].name === from && f.nodes[l.target].name === to)
      .reduce((a, l) => a + l.value, 0);

  test("a contribution filed against chequing still goes into the plan", () => {
    /*
     * Payroll deducts it before the money reaches an account, so the statement
     * line names the chequing account it was deducted from. Read off the
     * account it arrived in the plan never appeared at all.
     */
    const f = yearFlow(
      [at("income", 50000, "Salary", undefined, "a-chq"),
       at("income", 8000, "RSP / Pension", undefined, "a-chq")],
      "2026",
      { accounts },
    );
    assert.equal(edge(f, "RSP / Pension", "Investments"), 8000, "straight to the invested bar");
    assert.equal(edge(f, "RSP / Pension", "Money in"), 0, "not into the spendable bar");
    assert.equal(edge(f, "Investments", "Pension"), 8000, "and it comes out as pension");
  });

  test("a fee charged inside an investment account does not deepen the chart", () => {
    /*
     * The Spending bar shares a column with the invested bar, so a link from
     * one to the other pushes it into the next column and every ordinary link
     * downstream starts to look like it skips one.
     */
    const rows = [
      at("income", 90000, "Salary", undefined, "a-chq"),
      at("expense", 30000, "Housing", "a-chq"),
      at("transfer", 20000, "Transfer", "a-chq", "a-inv"),
      at("expense", 40, "Other", "a-inv"),
    ];
    const f = yearFlow(rows, "2026", { accounts });
    assert.equal(columnsOf(f), 4, "four columns, not five");
    assert.equal(edge(f, "Investments", "Spending"), 0, "never through the Spending bar");
    assert.ok(
      f.links.some((l) => f.nodes[l.source].name === "Investments" && f.nodes[l.target].name === "Discretionary"),
      "straight to what it was for",
    );
  });

  test("the leaves still hold every dollar spent", () => {
    const f = yearFlow(
      [at("income", 90000, "Salary", undefined, "a-chq"),
       at("expense", 30000, "Housing", "a-chq"),
       at("transfer", 20000, "Transfer", "a-chq", "a-inv"),
       at("expense", 40, "Other", "a-inv")],
      "2026",
      { accounts },
    );
    const into = (name: string) =>
      f.links.filter((l) => f.nodes[l.target].name === name).reduce((a, l) => a + l.value, 0);
    assert.equal(into("Necessity") + into("Discretionary"), 30040, "nothing is lost by the shortcut");
  });

  test("the pooled remainder stays at the foot even when it also feeds investments", () => {
    /*
     * Ranked against every bar rather than the ones in its own group, a source
     * paying a little into investments took the invested bar's place and sorted
     * to the top of the column it belongs at the bottom of.
     */
    const rows = [
      at("income", 90000, "Salary", undefined, "a-chq"),
      at("income", 9000, "Freelance", undefined, "a-chq"),
      at("income", 300, "Gifts", undefined, "a-chq"),
      at("income", 200, "Refund", undefined, "a-chq"),
      at("income", 100, "Other", undefined, "a-inv"),
      at("expense", 40000, "Housing", "a-chq"),
    ];
    const f = yearFlow(rows, "2026", { accounts, limit: 2 });
    const sources = f.nodes.filter((n) => n.role === "source").map((n) => n.name);
    const reaching = sources.filter((n) => n !== "Sold investments");
    assert.equal(
      reaching[reaching.indexOf("Other income")],
      "Other income",
      "the remainder is drawn",
    );
    const before = sources.indexOf("Other income");
    const salary = sources.indexOf("Salary");
    assert.ok(before > salary, `Other income (${before}) must sit below Salary (${salary})`);
  });
});

describe("borrowed money is drawn, and not as savings", () => {
  const accounts = [{ id: "a-chq", name: "Chequing", kind: "checking" as const }];
  const at = (type: "income" | "expense", amount: number, category: string, from?: string, to?: string) =>
    ({
      id: category + amount, date: "2026-05-05", type, amount, category, payee: "p",
      sourceAccountId: from, destinationAccountId: to,
    }) as unknown as Transaction;

  const rows = [
    at("income", 60000, "Salary", undefined, "a-chq"),
    at("income", 6500, "Loan Proceeds", undefined, "a-chq"),
    at("expense", 66000, "Housing", "a-chq"),
  ];
  const f = yearFlow(rows, "2026", { accounts });
  const edge = (from: string, to: string) =>
    f.links
      .filter((l) => f.nodes[l.source].name === from && f.nodes[l.target].name === to)
      .reduce((a, l) => a + l.value, 0);
  const names = f.nodes.map((n) => n.name);

  test("a drawdown arrives in the account it landed in", () => {
    assert.equal(edge("Borrowed", "Money in"), 6500);
  });

  test("it is not counted as a balance carried in", () => {
    /*
     * Left out, the account came up short by exactly what was borrowed, and
     * the chart balanced itself by inventing savings the year never touched.
     */
    assert.ok(!names.includes("From savings"), "nothing has to be invented to balance");
  });

  test("what the year actually kept is what is drawn", () => {
    assert.equal(edge("Money in", "Left in cash"), 500, "earned plus borrowed, less what went out");
  });

  test("borrowing does not take a place among the income categories", () => {
    /*
     * It is not one of them, and ranked among them it would push a real
     * category into the pooled remainder.
     */
    const many = [
      ...Array.from({ length: 3 }, (_, i) => at("income", 9000 - i, `Cat${i}`, undefined, "a-chq")),
      at("income", 50000, "Loan Proceeds", undefined, "a-chq"),
    ];
    const g = yearFlow(many, "2026", { accounts, limit: 3 });
    const sources = g.nodes.filter((n) => n.role === "source").map((n) => n.name);
    assert.ok(sources.includes("Borrowed"));
    assert.ok(!sources.includes("Other income"), "the three real categories all still have their own band");
  });

  test("still every dollar in equals every dollar out", () => {
    const inn = new Map<number, number>(), out = new Map<number, number>();
    for (const l of f.links) {
      inn.set(l.target, (inn.get(l.target) ?? 0) + l.value);
      out.set(l.source, (out.get(l.source) ?? 0) + l.value);
    }
    const sources = f.nodes.map((_, i) => i).filter((i) => !inn.has(i));
    const sinks = f.nodes.map((_, i) => i).filter((i) => !out.has(i));
    assert.equal(
      sources.reduce((a, i) => a + (out.get(i) ?? 0), 0),
      sinks.reduce((a, i) => a + (inn.get(i) ?? 0), 0),
    );
  });
});

describe("the spendable bar answers to the accounts", () => {
  const accounts = [{ id: "a-chq", name: "Chequing", kind: "checking" as const }];
  const at = (type: "income" | "expense", amount: number, category: string, from?: string, to?: string) =>
    ({
      id: category + amount + (from ?? "") + (to ?? ""), date: "2026-04-04",
      type, amount, category, payee: "p", sourceAccountId: from, destinationAccountId: to,
    }) as unknown as Transaction;
  const rows = [
    at("income", 60000, "Salary", undefined, "a-chq"),
    at("expense", 50000, "Housing", "a-chq"),
  ];
  const edge = (f: ReturnType<typeof yearFlow>, from: string, to: string) =>
    f.links
      .filter((l) => f.nodes[l.source].name === from && f.nodes[l.target].name === to)
      .reduce((a, l) => a + l.value, 0);
  const named = (f: ReturnType<typeof yearFlow>, n: string) => f.nodes.some((x) => x.name === n);

  test("both balances are drawn, and the year sits between them", () => {
    const f = yearFlow(rows, "2026", { accounts, openingCash: 5000, closingCash: 15000 });
    assert.equal(edge(f, "Opening balance", "Money in"), 5000);
    assert.equal(edge(f, "Money in", "Closing balance"), 15000);
  });

  test("a record that explains the balance leaves nothing over", () => {
    // The opening balance plus what came in, less what went out, is the close.
    const f = yearFlow(rows, "2026", { accounts, openingCash: 5000, closingCash: 15000 });
    assert.equal(named(f, "Not accounted for"), false);
  });

  test("a balance the record cannot reach is drawn as the gap it is", () => {
    /*
     * Closing lower than the movements explain: something left the account
     * that the transactions do not hold, and the chart says only that.
     */
    const short = yearFlow(rows, "2026", { accounts, openingCash: 5000, closingCash: 9000 });
    assert.equal(edge(short, "Money in", "Not accounted for"), 6000);
    assert.equal(named(short, "Left in cash"), false, "not a claim about what was saved");
  });

  test("and the other way, when more arrived than the record shows", () => {
    const over = yearFlow(rows, "2026", { accounts, openingCash: 5000, closingCash: 20000 });
    assert.equal(edge(over, "Not accounted for", "Money in"), 5000);
    assert.equal(named(over, "From savings"), false, "it is not known to have come from savings");
  });

  test("without balances it still says the weaker, true thing", () => {
    /*
     * Nothing to check against, so the difference is only the year's cash
     * change — which is what was left over, and can be called that.
     */
    const bare = yearFlow(rows, "2026", { accounts });
    assert.equal(edge(bare, "Money in", "Left in cash"), 10000);
    assert.equal(named(bare, "Not accounted for"), false);
  });

  test("the bar balances whichever way the gap points", () => {
    for (const closingCash of [9000, 15000, 20000]) {
      const f = yearFlow(rows, "2026", { accounts, openingCash: 5000, closingCash });
      const into = f.links.filter((l) => f.nodes[l.target].name === "Money in").reduce((a, l) => a + l.value, 0);
      const outOf = f.links.filter((l) => f.nodes[l.source].name === "Money in").reduce((a, l) => a + l.value, 0);
      assert.equal(into, outOf, `closing on ${closingCash}`);
    }
  });
});

describe("a band too thin to see is pooled, whatever kind of band it is", () => {
  const accounts = [{ id: "a-chq", name: "Chequing", kind: "checking" as const }];
  const at = (amount: number, category: string) =>
    ({
      id: category + amount, date: "2026-03-03", type: "income", amount, category,
      payee: "p", destinationAccountId: "a-chq",
    }) as unknown as Transaction;
  const spend = {
    id: "out", date: "2026-07-07", type: "expense", amount: 10000, category: "Housing",
    payee: "p", sourceAccountId: "a-chq",
  } as unknown as Transaction;
  const sources = (f: ReturnType<typeof yearFlow>) =>
    f.nodes.filter((n) => n.role === "source").map((n) => n.name);
  const into = (f: ReturnType<typeof yearFlow>, name: string) =>
    f.links.filter((l) => f.nodes[l.target].name === name).reduce((a, l) => a + l.value, 0);

  /* Two thin income categories, so the pooled band exists either way. */
  const base = [at(100000, "Salary"), at(300, "Interest"), at(200, "Gifts"), spend];

  test("a refund below the floor joins them rather than standing alone", () => {
    /*
     * It is not an income category and is not ranked with them, which is why it
     * skipped the floor as well — and was drawn as a band of its own carrying a
     * ribbon too thin to see.
     */
    const f = yearFlow([...base, at(36, "Refund")], "2026", { accounts });
    assert.equal(sources(f).includes("Refunds"), false);
    assert.equal(into(f, "Money in") > 0, true);
    assert.equal(
      f.links
        .filter((l) => f.nodes[l.source].name === "Other income")
        .reduce((a, l) => a + l.value, 0),
      536,
      "the interest, the gift and the refund together",
    );
  });

  test("a drawdown below the floor is pooled too", () => {
    const f = yearFlow([...base, at(40, "Loan Proceeds")], "2026", { accounts });
    assert.equal(sources(f).includes("Borrowed"), false);
  });

  test("but one that carries real weight keeps its own band", () => {
    const f = yearFlow([...base, at(9000, "Loan Proceeds")], "2026", { accounts });
    assert.ok(sources(f).includes("Borrowed"), "well above a hundredth of the income");
  });

  test("the floor is measured against the income, not against every arrival", () => {
    /*
     * Otherwise a year that sold a large holding raises the bar for everything
     * else, and categories that were worth drawing last year vanish this one
     * without the income having changed.
     */
    const holdings = [
      {
        accountId: "a-inv", assetClass: "US Equity",
        flows: [{ date: "2026-02-02", kind: "sell", amount: 900000, shares: -1 }],
      },
    ] as unknown as NonNullable<Parameters<typeof yearFlow>[2]>["holdings"];
    const withSale = yearFlow(base, "2026", {
      accounts: [...accounts, { id: "a-inv", name: "Brokerage", kind: "investment" as const }],
      holdings,
    });
    const plain = yearFlow(base, "2026", { accounts });
    assert.deepEqual(
      sources(withSale).filter((n) => n !== "Sold investments"),
      sources(plain),
      "the same bands are drawn either way",
    );
  });

  test("the opening balance is never pooled away", () => {
    // Where the chart starts, however little the year opened on.
    const f = yearFlow(base, "2026", { accounts, openingCash: 20, closingCash: 90320 });
    assert.ok(sources(f).includes("Opening balance"));
  });

  test("one thin band on its own still says what it is", () => {
    const f = yearFlow([at(100000, "Salary"), at(36, "Refund"), spend], "2026", { accounts });
    assert.ok(sources(f).includes("Refunds"), "renaming it would save nothing");
  });
});
