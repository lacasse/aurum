import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  allTimeSeries,
  budgetRows,
  incomeBySource,
  chainedReturns,
  netExternalFlows,
  annualized,
  portfolioMwrr,
  overMonths,
  portfolioMwrrOver,
  simpleReturn,
  cashflowSeries,
  consolidateHoldings,
  monthlyAverages,
  accountValueAt,
  holdingExposure,
  firstFlowMonth,
  monthsSince,
  replayFlows,
  sortHoldingRows,
  monthTotals,
  spendByCategory,
  stackedSpend,
  avgSpendByCategory,
  firstAccountMonth,
  netWorthOver,
  netWorthByClass,
  fiProgress,
  savingsRate,
  runwayMonths,
  DEFAULT_WITHDRAWAL_RATE,
  netWorthSeries,
} from "./analytics";
import { currentMonthKey, lastCompleteMonthKey, lastMonthKeys } from "./format";
import type { Account, Budget, Holding, Transaction } from "./types";

const MONTH = currentMonthKey();
const DAY = `${MONTH}-05`;

function txn(over: Partial<Transaction> & Pick<Transaction, "amount" | "type">): Transaction {
  return {
    id: Math.random().toString(36).slice(2),
    date: DAY,
    category: "Groceries",
    sourceAccountId: "a1",
    payee: "Market",
    ...over,
  };
}

describe("monthTotals", () => {
  test("totals income and expenses without floating-point drift", () => {
    // Ten 0.10 expenses sum to exactly 1.00; naive accumulation does not.
    const transactions = Array.from({ length: 10 }, () => txn({ amount: 0.1, type: "expense" }));
    const totals = monthTotals(transactions, MONTH);
    assert.equal(totals.expenses, 1);
    assert.equal(totals.income, 0);
    assert.equal(totals.net, -1);
  });

  test("nets income against expenses exactly", () => {
    const totals = monthTotals(
      [txn({ amount: 0.3, type: "income" }), txn({ amount: 0.1, type: "expense" })],
      MONTH,
    );
    assert.equal(totals.net, 0.2);
    assert.notEqual(0.3 - 0.1, 0.2, "precondition: float subtraction drifts");
  });

  test("ignores transactions outside the requested month", () => {
    const totals = monthTotals(
      [txn({ amount: 100, type: "income", date: "1999-01-01" })],
      MONTH,
    );
    assert.equal(totals.income, 0);
    assert.equal(totals.savingsRate, 0);
  });

  test("computes a savings rate", () => {
    const totals = monthTotals(
      [txn({ amount: 100, type: "income" }), txn({ amount: 25, type: "expense" })],
      MONTH,
    );
    assert.equal(totals.savingsRate, 75);
  });
});

describe("spendByCategory", () => {
  test("groups expenses exactly and sorts by size", () => {
    const rows = spendByCategory(
      [
        txn({ amount: 0.1, type: "expense", category: "Dining" }),
        txn({ amount: 0.2, type: "expense", category: "Dining" }),
        txn({ amount: 5, type: "expense", category: "Transport" }),
        txn({ amount: 999, type: "income", category: "Salary" }),
      ],
      MONTH,
    );
    assert.deepEqual(rows, [
      { name: "Transport", value: 5 },
      { name: "Dining", value: 0.3 },
    ]);
  });
});

describe("cashflowSeries", () => {
  test("places totals in the right month and nets them exactly", () => {
    const series = cashflowSeries(
      [txn({ amount: 0.1, type: "expense" }), txn({ amount: 0.3, type: "income" })],
      12,
    );
    const current = series.find((p) => p.key === MONTH);
    assert.ok(current, "current month is present in the series");
    assert.equal(current.income, 0.3);
    assert.equal(current.expenses, 0.1);
    assert.equal(current.net, 0.2);
  });
});

describe("charts that compare months end at the last complete one", () => {
  const complete = lastCompleteMonthKey();
  const lastDay = `${complete}-15`;

  test("cashflowSeries can stop before the month in progress", () => {
    const series = cashflowSeries(
      [
        txn({ amount: 100, type: "expense" }),
        txn({ amount: 40, type: "expense", date: lastDay }),
      ],
      12,
      complete,
    );
    // The partial month is a short month, not a frugal one, so it is not drawn
    // beside twelve whole ones.
    assert.equal(series.find((p) => p.key === MONTH), undefined);
    assert.equal(series[series.length - 1].key, complete);
    assert.equal(series[series.length - 1].expenses, 40);
  });

  test("stackedSpend stops there too, so the two line up", () => {
    const rows = stackedSpend(
      [txn({ amount: 40, type: "expense", date: lastDay })],
      ["Groceries"],
      12,
      complete,
    );
    assert.equal(rows[rows.length - 1].key, complete);
    assert.equal(rows[rows.length - 1].Groceries, 40);
  });
});

describe("avgSpendByCategory", () => {
  const complete = lastCompleteMonthKey();
  const months = lastMonthKeys(12, complete);
  const spend = (month: string, amount: number, category: string) =>
    txn({ amount, type: "expense", category, date: `${month}-10` });

  test("divides by the months on record, not by the twelve asked for", () => {
    // Three months of history, $300 of rent in each: the average month has
    // $300 of rent in it, not $75.
    const rows = avgSpendByCategory(
      months.slice(-3).map((m) => spend(m, 300, "Housing")),
      12,
      complete,
    );
    assert.deepEqual(rows, [{ name: "Housing", value: 300 }]);
  });

  test("ranks the categories by what they cost per month", () => {
    const rows = avgSpendByCategory(
      [
        spend(months[10], 100, "Groceries"),
        spend(months[11], 900, "Housing"),
        spend(months[11], 50, "Groceries"),
      ],
      12,
      complete,
    );
    assert.deepEqual(
      rows.map((r) => r.name),
      ["Housing", "Groceries"],
    );
    assert.equal(rows[0].value, 450);
    assert.equal(rows[1].value, 75);
  });

  test("the slices add up to the average-expenses figure beside them", () => {
    const transactions = [
      spend(months[10], 100, "Groceries"),
      spend(months[11], 900, "Housing"),
      txn({ amount: 2000, type: "income", date: `${months[11]}-01` }),
    ];
    const total = avgSpendByCategory(transactions, 12, complete).reduce(
      (sum, r) => sum + r.value,
      0,
    );
    assert.equal(total, monthlyAverages(transactions, 12).expenses);
  });

  test("the month in progress is not one of the months averaged", () => {
    const rows = avgSpendByCategory(
      [spend(MONTH, 500, "Housing"), spend(months[11], 100, "Housing")],
      12,
      complete,
    );
    assert.deepEqual(rows, [{ name: "Housing", value: 100 }]);
  });

  test("nothing recorded is no slices, rather than a division by zero", () => {
    assert.deepEqual(avgSpendByCategory([], 12, complete), []);
  });
});

describe("netWorthSeries", () => {
  test("an account counts nothing before its own record begins", () => {
    // The same rule as `netWorthOver`, so the accounts page and the dashboard
    // do not disagree about the same month.
    const months = lastMonthKeys(3);
    const opened = {
      id: "p",
      kind: "investment",
      balance: 900,
      history: [{ month: months[2], value: 900 }],
    } as unknown as Parameters<typeof netWorthSeries>[0][number];
    const series = netWorthSeries([opened], [], 3);
    assert.equal(series[0].assets, 0);
    assert.equal(series[1].assets, 0);
    assert.equal(series[2].assets, 900);
  });
});

describe("the pension is not counted as money", () => {
  const portfolio = [
    { key: "2026-07", label: "Jul ’26", value: 1000, cost: 800 },
    { key: "2026-08", label: "Aug ’26", value: 1200, cost: 800 },
  ];
  const chequing = {
    id: "c",
    kind: "checking",
    balance: 500,
    history: [{ month: "2026-07", value: 400 }],
  } as unknown as Parameters<typeof netWorthOver>[0][number];
  const pension = {
    id: "p",
    kind: "pension",
    balance: 37489.8,
    history: [{ month: "2026-07", value: 37489.8 }],
  } as unknown as Parameters<typeof netWorthOver>[0][number];

  test("it has its own band, and assets means what you can draw on", () => {
    const [, now] = netWorthOver([chequing, pension], portfolio);
    assert.equal(now.assets, 500, "not 37,989.80");
    assert.equal(now.pension, 37489.8);
  });

  test("it still counts in net worth, because it is yours", () => {
    const [, now] = netWorthOver([chequing, pension], portfolio);
    assert.equal(now.net, 500 + 37489.8 + 1200);
  });

  test("the same split on the eighteen-month series", () => {
    const months = lastMonthKeys(2);
    const held = {
      id: "p",
      kind: "pension",
      balance: 1000,
      history: [{ month: months[0], value: 1000 }],
    } as unknown as Parameters<typeof netWorthSeries>[0][number];
    const series = netWorthSeries([held], [], 2);
    assert.equal(series[1].assets, 0);
    assert.equal(series[1].pension, 1000);
    assert.equal(series[1].net, 1000);
  });
});

describe("savingsRate", () => {
  test("what came in, less what went out, over what came in", () => {
    assert.equal(savingsRate(8485, 4736), ((8485 - 4736) / 8485) * 100);
  });

  test("spending more than came in is a negative rate, not a floor at zero", () => {
    assert.equal(savingsRate(1000, 1500), -50);
  });

  test("no income is no rate", () => {
    // A month with nothing coming in did not fail to save.
    assert.equal(savingsRate(0, 500), null);
  });
});

describe("runwayMonths", () => {
  test("cash over a month of spending", () => {
    assert.equal(runwayMonths(3628, 4736), 3628 / 4736);
  });

  test("a negative balance covers nothing rather than a negative time", () => {
    assert.equal(runwayMonths(-200, 1000), 0);
  });

  test("spending nothing has no answer, not an infinite one", () => {
    assert.equal(runwayMonths(5000, 0), null);
  });
});

describe("fiProgress", () => {
  test("the target follows from what a year costs, and is not entered", () => {
    // The workbook's own figures: $3,961.115 a month at 3.5% is $1,358,096.60,
    // and $509,242.63 of net worth is 37.5% of the way there.
    const fi = fiProgress(509242.63, 3961.115);
    assert.equal(fi.target, 1358096.57);
    assert.equal(Math.round(fi.pct * 10) / 10, 37.5);
  });

  test("the payout is the rate on net worth", () => {
    const fi = fiProgress(509242.63, 3961.115);
    assert.equal(fi.yearly, 17823.49);
    assert.equal(fi.monthly, 1485.29);
  });

  test("progress and coverage are the same number", () => {
    // Net worth over the target equals the payout over a month's spending,
    // which is why one percentage answers both questions.
    const fi = fiProgress(400000, 3000);
    assert.equal(
      Math.round(fi.pct * 100) / 100,
      Math.round((fi.monthly / 3000) * 10000) / 100,
    );
  });

  test("a different rate moves the target and the payout together", () => {
    const strict = fiProgress(500000, 4000, 0.03);
    const loose = fiProgress(500000, 4000, 0.04);
    assert.ok(strict.target > loose.target, "a lower rate needs a bigger pot");
    assert.ok(strict.monthly < loose.monthly);
    assert.ok(strict.pct < loose.pct);
  });

  test("the shortfall is what a month still needs", () => {
    const fi = fiProgress(509242.63, 4736);
    assert.equal(fi.shortfall, roundTo(4736 - fi.monthly));
    function roundTo(n: number) {
      return Math.round(n * 100) / 100;
    }
  });

  test("nothing spent is no target, rather than an infinite one", () => {
    const fi = fiProgress(500000, 0);
    assert.equal(fi.target, 0);
    assert.equal(fi.pct, 0);
    assert.equal(fi.shortfall, 0);
  });

  test("the default rate is the one the record has always used", () => {
    assert.equal(DEFAULT_WITHDRAWAL_RATE, 0.035);
  });
});

describe("netWorthByClass", () => {
  const months = ["2026-06", "2026-07", "2026-08"];
  const holding = (ticker: string, assetClass: string, flows: unknown[] = []) =>
    ({
      id: ticker,
      ticker,
      name: ticker,
      assetClass,
      shares: 0,
      avgCost: 0,
      avgCostCAD: 0,
      price: 0,
      priceCAD: 0,
      dividendsReceived: 0,
      dividendsReceivedCAD: 0,
      history: [],
      historyCAD: [],
      currency: "CAD",
      accountId: "a1",
      flows,
    }) as unknown as Holding;

  const chequing = {
    id: "c",
    kind: "checking",
    balance: 500,
    history: [{ month: "2026-06", value: 500 }],
  } as unknown as Account;
  const pension = {
    id: "p",
    kind: "pension",
    balance: 9000,
    history: [{ month: "2026-07", value: 9000 }],
  } as unknown as Account;
  const loan = {
    id: "l",
    kind: "loan",
    balance: 200,
    history: [{ month: "2026-06", value: 200 }],
  } as unknown as Account;

  const snapshots = {
    "2026-07": { "BTC": 4000, "XEQT.TO": 3000, "XGB.TO": 1000 },
    "2026-08": { "BTC": 5000, "XEQT.TO": 3200, "XGB.TO": 900 },
  };
  const holdings = [
    holding("BTC", "Crypto"),
    holding("XEQT.TO", "Intl Equity"),
    holding("XGB.TO", "Bonds"),
  ];

  test("splits the portfolio by what each holding is", () => {
    const series = netWorthByClass([chequing], holdings, {}, months, snapshots);
    const july = series[1];
    assert.equal(july.Crypto, 4000);
    assert.equal(july.Stocks, 3000);
    assert.equal(july.Bonds, 1000);
  });

  test("US and international equity are one band", () => {
    // The split between them is a question about the stocks, not about the mix.
    const series = netWorthByClass(
      [chequing],
      [holding("VOO", "US Equity"), holding("CAGE.TO", "Intl Equity")],
      {},
      months,
      { "2026-07": { VOO: 100, "CAGE.TO": 250 } },
    );
    assert.equal(series[1].Stocks, 350);
  });

  test("cash and the pension are bands of their own", () => {
    const series = netWorthByClass([chequing, pension], holdings, {}, months, snapshots);
    assert.equal(series[0].Cash, 500);
    assert.equal(series[0].Pension, 0, "the pension has no record for June");
    assert.equal(series[1].Pension, 9000);
  });

  test("debts sit beside the bands, not inside them", () => {
    const series = netWorthByClass([chequing, loan], holdings, {}, months, snapshots);
    assert.equal(series[1].liabilities, 200);
    assert.equal(series[1].net, 500 + 4000 + 3000 + 1000 - 200);
  });

  test("the bands and the debt add up to net worth", () => {
    const series = netWorthByClass([chequing, pension, loan], holdings, {}, months, snapshots);
    for (const p of series) {
      const bands = p.Cash + p.Bonds + p.Stocks + p.Crypto + p.Pension;
      assert.equal(Math.round((bands - p.liabilities) * 100) / 100, p.net);
    }
  });

  test("a class nothing is held in stays at zero rather than vanishing", () => {
    const series = netWorthByClass([chequing], [holding("BTC", "Crypto")], {}, months, {
      "2026-07": { BTC: 100 },
    });
    assert.equal(series[1].Bonds, 0);
    assert.equal(series[1].Stocks, 0);
  });

  test("a recorded ticker nobody holds any more still counts as its class", () => {
    // Sold in 2022, but it was bonds while it was open.
    const series = netWorthByClass([chequing], holdings, {}, months, {
      "2026-07": { "XGB.TO": 1500 },
    });
    assert.equal(series[1].Bonds, 1500);
  });
});

describe("firstAccountMonth", () => {
  const acc = (id: string, first: string) =>
    ({
      id,
      kind: "checking",
      balance: 0,
      history: [{ month: first, value: 0 }],
    }) as unknown as Parameters<typeof firstAccountMonth>[0][number];

  test("finds the earliest recorded month across the accounts", () => {
    assert.equal(firstAccountMonth([acc("a", "2022-06"), acc("b", "2020-02")]), "2020-02");
  });

  test("says nothing when no account has a history", () => {
    assert.equal(firstAccountMonth([]), null);
  });
});

describe("netWorthOver", () => {
  const portfolio = [
    { key: "2020-01", label: "Jan ’20", value: 0, cost: 0 },
    { key: "2023-01", label: "Jan ’23", value: 1000, cost: 900 },
    { key: "2026-01", label: "Jan ’26", value: 5000, cost: 3000 },
  ];
  const chequing = {
    id: "c",
    kind: "checking",
    balance: 300,
    history: [
      { month: "2020-01", value: 100 },
      { month: "2023-01", value: 200 },
    ],
  } as unknown as Parameters<typeof netWorthOver>[0][number];
  const pension = {
    id: "p",
    kind: "investment",
    balance: 40000,
    history: [{ month: "2026-01", value: 40000 }],
  } as unknown as Parameters<typeof netWorthOver>[0][number];
  const loan = {
    id: "l",
    kind: "loan",
    balance: 50,
    history: [{ month: "2020-01", value: 500 }],
  } as unknown as Parameters<typeof netWorthOver>[0][number];

  test("spans exactly the months the portfolio series covers", () => {
    const series = netWorthOver([chequing], portfolio);
    assert.deepEqual(series.map((p) => p.key), ["2020-01", "2023-01", "2026-01"]);
  });

  test("an account is worth nothing before its own record begins", () => {
    // Holding the first known balance backwards would put a pension opened
    // this year into years that never had it.
    const series = netWorthOver([chequing, pension], portfolio);
    assert.equal(series[0].assets, 100);
    assert.equal(series[1].assets, 200);
    assert.equal(series[2].assets, 300 + 40000);
  });

  test("liabilities come off, and the portfolio comes from the series", () => {
    const series = netWorthOver([chequing, loan], portfolio);
    assert.equal(series[0].liabilities, 500);
    assert.equal(series[0].net, 100 - 500);
    assert.equal(series[2].portfolio, 5000);
    // Past the end of both histories, each account holds today's balance.
    assert.equal(series[2].net, 300 + 5000 - 50);
  });

  test("the US side of an account belongs only to the current month", () => {
    const usd = {
      ...(chequing as unknown as Record<string, unknown>),
      balanceUSD: 100,
    } as unknown as Parameters<typeof netWorthOver>[0][number];
    const series = netWorthOver([usd], portfolio, 1.4);
    assert.equal(series[0].assets, 100);
    assert.equal(series[2].assets, 300 + 140);
  });
});

describe("budgetRows", () => {
  test("computes spend and remaining exactly", () => {
    const budgets: Budget[] = [{ category: "Groceries", limit: 1 }];
    const transactions = Array.from({ length: 3 }, () =>
      txn({ amount: 0.1, type: "expense", category: "Groceries" }),
    );
    const [row] = budgetRows(budgets, transactions, MONTH);
    assert.equal(row.spent, 0.3);
    assert.equal(row.remaining, 0.7);

    let naive = 0;
    for (const t of transactions) naive += t.amount;
    assert.notEqual(naive, 0.3, "precondition: naive accumulation drifts");
  });

  test("ignores other categories and other months", () => {
    const budgets: Budget[] = [{ category: "Groceries", limit: 100 }];
    const [row] = budgetRows(
      budgets,
      [
        txn({ amount: 10, type: "expense", category: "Dining" }),
        txn({ amount: 10, type: "expense", category: "Groceries", date: "1999-01-01" }),
      ],
      MONTH,
    );
    assert.equal(row.spent, 0);
    assert.equal(row.remaining, 100);
    assert.equal(row.pct, 0);
  });
});

describe("consolidateHoldings", () => {
  const lot = (over: Partial<Holding>): Holding =>
    ({
      id: "h",
      ticker: "XEQT",
      name: "XEQT",
      assetClass: "US Equity",
      shares: 10,
      avgCost: 30,
      price: 40,
      history: [38, 40],
      dividendsReceived: 0,
      accountId: "acc-tfsa",
      currency: "CAD",
      priceCAD: 40,
      avgCostCAD: 30,
      dividendsReceivedCAD: 0,
      historyCAD: [38, 40],
      flows: [],
      ...over,
    }) as Holding;

  test("a ticker held in two accounts appears once, tagged with both", () => {
    const rows = consolidateHoldings([
      lot({ id: "a", accountId: "acc-tfsa" }),
      lot({ id: "b", accountId: "acc-rrsp" }),
    ]);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].accountIds, ["acc-tfsa", "acc-rrsp"]);
    assert.equal(rows[0].lots.length, 2, "the per-account detail is kept");
  });

  test("shares, cost and dividends are the combined totals", () => {
    const rows = consolidateHoldings([
      lot({ id: "a", shares: 10, avgCostCAD: 30, dividendsReceivedCAD: 5 }),
      lot({ id: "b", accountId: "acc-rrsp", shares: 30, avgCostCAD: 50, dividendsReceivedCAD: 7 }),
    ]);
    const [r] = rows;
    assert.equal(r.shares, 40);
    assert.equal(r.costBasis, 10 * 30 + 30 * 50);
    assert.equal(r.avgCostCAD, 45, "share-weighted, not the mean of 30 and 50");
    assert.equal(r.marketValue, 40 * 40);
    assert.equal(r.totalDividends, 12);
    assert.equal(r.gain, 1600 - 1800);
    assert.equal(r.totalReturn, -200 + 12);
  });

  test("MWRR reflects the pooled position, not one account's", () => {
    const pooled = consolidateHoldings([
      lot({ id: "a", shares: 10, avgCostCAD: 20 }),
      lot({ id: "b", accountId: "acc-rrsp", shares: 10, avgCostCAD: 60 }),
    ])[0];
    // Pooled basis 800 against 800 of value is a flat return, even though one
    // account doubled and the other lost a third.
    assert.equal(pooled.costBasis, 800);
    assert.equal(pooled.marketValue, 800);
    assert.equal(pooled.mwrr, null, "no flows means no measurable return");
  });

  test("weights are shares of the whole portfolio and sum to 100", () => {
    const rows = consolidateHoldings([
      lot({ id: "a", ticker: "XEQT", shares: 10 }),
      lot({ id: "b", ticker: "XEQT", accountId: "acc-rrsp", shares: 10 }),
      lot({ id: "c", ticker: "VFV", shares: 20 }),
    ]);
    assert.equal(rows.length, 2);
    assert.equal(Math.round(rows.reduce((s, r) => s + r.weightPct, 0)), 100);
  });

  test("differing case in the ticker is still one security", () => {
    const rows = consolidateHoldings([
      lot({ id: "a", ticker: "xeqt" }),
      lot({ id: "b", ticker: "XEQT", accountId: "acc-rrsp" }),
    ]);
    assert.equal(rows.length, 1);
  });

  test("an unpriced lot does not drag the price to zero", () => {
    const rows = consolidateHoldings([
      lot({ id: "a", priceCAD: 0, price: 0 }),
      lot({ id: "b", accountId: "acc-rrsp", priceCAD: 40 }),
    ]);
    assert.equal(rows[0].priceCAD, 40);
  });
});

describe("accountValueAt", () => {
  const acc = {
    id: "a",
    name: "Chequing",
    institution: "Bank",
    kind: "checking",
    balance: 500,
    history: [
      { month: "2026-01", value: 100 },
      { month: "2026-02", value: 200 },
    ],
  } as unknown as Parameters<typeof accountValueAt>[0];

  test("reads the recorded month when there is one", () => {
    assert.equal(accountValueAt(acc, "2026-02"), 200);
  });

  test("before the history starts, holds the earliest figure", () => {
    assert.equal(accountValueAt(acc, "2025-11"), 100);
  });

  test("a gap in the middle holds the figure before it, not after", () => {
    const gappy = {
      ...(acc as unknown as Record<string, unknown>),
      history: [
        { month: "2026-01", value: 100 },
        { month: "2026-04", value: 400 },
      ],
    } as unknown as Parameters<typeof accountValueAt>[0];
    assert.equal(accountValueAt(gappy, "2026-02"), 100);
    assert.equal(accountValueAt(gappy, "2026-03"), 100);
  });

  test("after the history ends, holds today's balance", () => {
    // Not the earliest: a chart running past the last recorded month used to
    // fall back to the oldest value and drew a cliff at its right edge.
    assert.equal(accountValueAt(acc, "2026-06"), 500);
  });
});

describe("monthlyAverages", () => {
  const months = lastMonthKeys(4).filter((k) => k !== MONTH);
  const [m1, m2, m3] = months;

  test("averages over months with activity, not over empty ones", () => {
    // One month of income among three: the average is that month's figure
    // spread over the months that happened, not over the whole window.
    const avg = monthlyAverages(
      [txn({ amount: 3000, type: "income", category: "Salary", date: `${m3}-15` })],
      12,
    );
    assert.equal(avg.months, 1);
    assert.equal(avg.income, 3000);
  });

  test("ignores the month in progress", () => {
    const avg = monthlyAverages(
      [
        txn({ amount: 100, type: "income", category: "Salary", date: `${m3}-02` }),
        txn({ amount: 9999, type: "income", category: "Salary", date: DAY }),
      ],
      12,
    );
    assert.equal(avg.income, 100, "a partial month would drag every average");
  });

  test("passive income counts dividends and interest only", () => {
    const avg = monthlyAverages(
      [
        txn({ amount: 4000, type: "income", category: "Salary", date: `${m3}-01` }),
        txn({ amount: 120, type: "income", category: "Dividends", date: `${m3}-02` }),
        txn({ amount: 30, type: "income", category: "Interest", date: `${m3}-03` }),
      ],
      12,
    );
    assert.equal(avg.passive, 150);
    assert.equal(avg.income, 4150);
  });

  test("free cash flow is what landed, less everything that was spent", () => {
    const avg = monthlyAverages(
      [
        txn({ amount: 5000, type: "income", category: "Salary", date: `${m3}-01` }),
        // Illiquid: a pension contribution never reaches the account.
        txn({ amount: 500, type: "income", category: "RSP / Pension", date: `${m3}-01` }),
        txn({ amount: 1500, type: "expense", category: "Housing", date: `${m3}-02` }),
        txn({ amount: 400, type: "expense", category: "Debt Repayment", date: `${m3}-03` }),
        // Dinner out is spent as surely as rent is.
        txn({ amount: 300, type: "expense", category: "Dining", date: `${m3}-04` }),
      ],
      12,
    );
    assert.equal(avg.income, 5500);
    assert.equal(avg.expenses, 2200);
    assert.equal(avg.uncommittedLiquid, 5000 - 1500 - 400 - 300);
  });

  test("a dividend is return on the portfolio, not money to live on", () => {
    // It lands in the brokerage that earned it. Counting it would say the
    // month had more spendable money in it than the month had.
    const avg = monthlyAverages(
      [
        txn({ amount: 4000, type: "income", category: "Salary", date: `${m3}-01` }),
        txn({ amount: 90, type: "income", category: "Dividends", date: `${m3}-02` }),
        txn({ amount: 40, type: "income", category: "Interest", date: `${m3}-03` }),
      ],
      12,
    );
    assert.equal(avg.income, 4130, "it is still income");
    assert.equal(avg.passive, 130, "and still passive income");
    // Interest — which is where cashback is recorded — does land, and counts.
    assert.equal(avg.uncommittedLiquid, 4040);
  });

  test("a transfer is not spending, so it leaves free cash flow alone", () => {
    // Moving money into a brokerage is the thing free cash flow is *for*.
    const avg = monthlyAverages(
      [
        txn({ amount: 5000, type: "income", category: "Salary", date: `${m3}-01` }),
        txn({
          amount: 2000,
          type: "transfer",
          category: "Transfer",
          date: `${m3}-02`,
          destinationAccountId: "a2",
        }),
      ],
      12,
    );
    assert.equal(avg.uncommittedLiquid, 5000);
  });

  test("months with only expenses still count", () => {
    const avg = monthlyAverages(
      [
        txn({ amount: 1000, type: "expense", category: "Groceries", date: `${m1}-05` }),
        txn({ amount: 2000, type: "expense", category: "Groceries", date: `${m2}-05` }),
      ],
      12,
    );
    assert.equal(avg.months, 2);
    assert.equal(avg.expenses, 1500);
  });
});

describe("monthlyAverages · the year before", () => {
  const complete = lastCompleteMonthKey();
  const months = lastMonthKeys(24, complete);
  const at = (month: string, amount: number, type: "income" | "expense", category = "Groceries") =>
    txn({ amount, type, category, date: `${month}-10` });

  test("compares the last twelve months with the twelve before them", () => {
    const transactions = [
      ...months.slice(12).map((m) => at(m, 1000, "income", "Salary")),
      ...months.slice(0, 12).map((m) => at(m, 800, "income", "Salary")),
    ];
    const avg = monthlyAverages(transactions, 12, complete);
    assert.equal(avg.income, 1000);
    assert.equal(avg.previous?.income, 800);
    assert.equal(avg.previous?.months, 12);
  });

  test("the two windows do not overlap by a month", () => {
    // One month of income, in the oldest month of the current window: it
    // belongs to the current average and not to the previous one.
    const avg = monthlyAverages([at(months[12], 1200, "income", "Salary")], 12, complete);
    assert.equal(avg.income, 1200);
    assert.equal(avg.previous, null);
  });

  test("nothing recorded before is no answer, not a fall to zero", () => {
    // A record that starts inside the window would otherwise report every
    // figure as an infinite improvement.
    const avg = monthlyAverages([at(months[20], 500, "expense")], 12, complete);
    assert.equal(avg.previous, null);
  });

  test("the previous window uses the same rules as the current one", () => {
    const transactions = [
      at(months[0], 3000, "income", "Salary"),
      at(months[0], 1000, "expense", "Housing"),
      at(months[0], 200, "income", "Dividends"),
      at(months[0], 400, "expense", "Shopping"),
    ];
    const { previous } = monthlyAverages(transactions, 12, complete);
    assert.equal(previous?.income, 3200, "dividends are income");
    assert.equal(previous?.expenses, 1400);
    assert.equal(previous?.passive, 200);
    // Everything that landed, less everything spent — shopping included, and
    // the dividend left out because it landed in the brokerage.
    assert.equal(previous?.uncommittedLiquid, 3000 - 1000 - 400);
  });

  test("months that did not happen are not averaged into the previous window", () => {
    const transactions = months.slice(0, 3).map((m) => at(m, 900, "income", "Salary"));
    const { previous } = monthlyAverages(transactions, 12, complete);
    assert.equal(previous?.months, 3);
    assert.equal(previous?.income, 900, "not 225");
  });
});

describe("holdingExposure", () => {
  const lot = (over: Partial<Holding>): Holding =>
    ({
      id: "h",
      ticker: "XEQT",
      name: "XEQT",
      assetClass: "US Equity",
      shares: 10,
      avgCost: 30,
      price: 40,
      history: [40],
      dividendsReceived: 0,
      accountId: "acc-tfsa",
      currency: "CAD",
      priceCAD: 40,
      avgCostCAD: 30,
      dividendsReceivedCAD: 0,
      historyCAD: [40],
      flows: [],
      ...over,
    }) as Holding;

  test("pools a ticker across accounts and drops closed positions", () => {
    const slices = holdingExposure([
      lot({ id: "a", shares: 10 }),
      lot({ id: "b", accountId: "acc-rrsp", ticker: "xeqt", shares: 5 }),
      lot({ id: "c", ticker: "CRM", shares: 0 }),
    ]);
    assert.equal(slices.length, 1);
    assert.equal(slices[0].value, 15 * 40);
  });

  test("prefers the fuller of two names for the same ticker", () => {
    const slices = holdingExposure([
      lot({ id: "a", name: "XEQT" }),
      lot({ id: "b", accountId: "acc-rrsp", name: "Global Equity" }),
    ]);
    assert.equal(slices[0].name, "Global Equity");
  });

  test("largest first, whatever class it is in", () => {
    // The class no longer groups the ring: colour is a step along one
    // spectrum, so a small holding does not ride on the back of a large class.
    const slices = holdingExposure([
      lot({ id: "a", ticker: "BTC", assetClass: "Crypto", shares: 1, priceCAD: 900 }),
      lot({ id: "b", ticker: "AAA", shares: 1, priceCAD: 300 }),
      lot({ id: "c", ticker: "BBB", assetClass: "Crypto", shares: 1, priceCAD: 100 }),
      lot({ id: "d", ticker: "CCC", shares: 1, priceCAD: 500 }),
    ]);
    assert.deepEqual(
      slices.map((s) => s.ticker),
      ["BTC", "CCC", "AAA", "BBB"],
    );
  });

  test("ties break on ticker, so the ring never reshuffles between renders", () => {
    const slices = holdingExposure([
      lot({ id: "a", ticker: "ZZZ", shares: 1, priceCAD: 100 }),
      lot({ id: "b", ticker: "AAA", shares: 1, priceCAD: 100 }),
    ]);
    assert.deepEqual(
      slices.map((s) => s.ticker),
      ["AAA", "ZZZ"],
    );
  });
});

describe("sortHoldingRows", () => {
  const lot = (over: Partial<Holding>): Holding =>
    ({
      id: "h",
      ticker: "XEQT",
      name: "iShares Core Equity ETF",
      assetClass: "US Equity",
      shares: 10,
      avgCost: 30,
      price: 40,
      history: [38, 40],
      dividendsReceived: 0,
      accountId: "acc-tfsa",
      currency: "CAD",
      priceCAD: 40,
      avgCostCAD: 30,
      dividendsReceivedCAD: 0,
      historyCAD: [38, 40],
      flows: [],
      ...over,
    }) as Holding;

  const rows = consolidateHoldings([
    lot({ id: "a", ticker: "AAA", name: "Zulu Corp", shares: 1, priceCAD: 500 }),
    lot({ id: "b", ticker: "BBB", name: "Alpha Inc", shares: 10, priceCAD: 10 }),
    lot({ id: "c", ticker: "CCC", name: "Midway Ltd", shares: 5, priceCAD: 40 }),
  ]);

  test("sorts by value in both directions", () => {
    assert.deepEqual(
      sortHoldingRows(rows, "marketValue", "desc").map((r) => r.ticker),
      ["AAA", "CCC", "BBB"],
    );
    assert.deepEqual(
      sortHoldingRows(rows, "marketValue", "asc").map((r) => r.ticker),
      ["BBB", "CCC", "AAA"],
    );
  });

  test("the position column sorts on the name, which is what it now leads with", () => {
    assert.deepEqual(
      sortHoldingRows(rows, "name", "asc").map((r) => r.name),
      ["Alpha Inc", "Midway Ltd", "Zulu Corp"],
    );
  });

  test("sorting by class groups the classes, largest first inside each", () => {
    const mixed = consolidateHoldings([
      lot({ id: "a", ticker: "AAA", assetClass: "US Equity", shares: 1, priceCAD: 100 }),
      lot({ id: "b", ticker: "BBB", assetClass: "Bonds", shares: 1, priceCAD: 50 }),
      lot({ id: "c", ticker: "CCC", assetClass: "US Equity", shares: 1, priceCAD: 900 }),
      lot({ id: "d", ticker: "DDD", assetClass: "Bonds", shares: 1, priceCAD: 500 }),
    ]);
    assert.deepEqual(
      sortHoldingRows(mixed, "assetClass", "asc").map((r) => r.ticker),
      ["DDD", "BBB", "CCC", "AAA"],
    );
  });

  test("and the other way round, still largest first inside each", () => {
    const mixed = consolidateHoldings([
      lot({ id: "a", ticker: "AAA", assetClass: "US Equity", shares: 1, priceCAD: 100 }),
      lot({ id: "b", ticker: "BBB", assetClass: "Bonds", shares: 1, priceCAD: 500 }),
      lot({ id: "c", ticker: "CCC", assetClass: "US Equity", shares: 1, priceCAD: 900 }),
    ]);
    assert.deepEqual(
      sortHoldingRows(mixed, "assetClass", "desc").map((r) => r.ticker),
      ["CCC", "AAA", "BBB"],
    );
  });

  test("sorts by the other numeric columns", () => {
    assert.deepEqual(
      sortHoldingRows(rows, "shares", "desc").map((r) => r.ticker),
      ["BBB", "CCC", "AAA"],
    );
    assert.deepEqual(
      sortHoldingRows(rows, "priceCAD", "desc").map((r) => r.ticker),
      ["AAA", "CCC", "BBB"],
    );
  });

  test("ties break on value, so the order never wobbles between renders", () => {
    const tied = consolidateHoldings([
      lot({ id: "a", ticker: "AAA", shares: 1, priceCAD: 10, dividendsReceivedCAD: 0 }),
      lot({ id: "b", ticker: "BBB", shares: 1, priceCAD: 90, dividendsReceivedCAD: 0 }),
    ]);
    const once = sortHoldingRows(tied, "totalDividends", "desc").map((r) => r.ticker);
    const twice = sortHoldingRows(tied, "totalDividends", "desc").map((r) => r.ticker);
    assert.deepEqual(once, ["BBB", "AAA"], "the larger position leads");
    assert.deepEqual(once, twice);
  });

  test("does not mutate the rows it was given", () => {
    const before = rows.map((r) => r.ticker);
    sortHoldingRows(rows, "name", "asc");
    assert.deepEqual(rows.map((r) => r.ticker), before);
  });
});

describe("closed positions", () => {
  const lot = (over: Partial<Holding>): Holding =>
    ({
      id: "h",
      ticker: "XEQT",
      name: "iShares Core Equity ETF",
      assetClass: "US Equity",
      shares: 10,
      avgCost: 30,
      price: 40,
      history: [38, 40],
      dividendsReceived: 0,
      accountId: "acc-tfsa",
      currency: "CAD",
      priceCAD: 40,
      avgCostCAD: 30,
      dividendsReceivedCAD: 0,
      historyCAD: [38, 40],
      flows: [],
      ...over,
    }) as Holding;

  test("a fully-sold position is marked closed, not dropped", () => {
    // Kept on purpose: the cost basis and dividends are the record of a
    // realized gain, which still matters at tax time.
    const [row] = consolidateHoldings([
      lot({ shares: 0, dividendsReceivedCAD: 120 }),
    ]);
    assert.equal(row.closed, true);
    assert.equal(row.totalDividends, 120, "the dividend record survives");
    assert.equal(row.marketValue, 0);
  });

  test("a position with shares is not closed", () => {
    assert.equal(consolidateHoldings([lot({ shares: 10 })])[0].closed, false);
  });

  test("selling out of one account does not close a position held elsewhere", () => {
    const [row] = consolidateHoldings([
      lot({ id: "a", accountId: "acc-tfsa", shares: 0 }),
      lot({ id: "b", accountId: "acc-rrsp", shares: 5 }),
    ]);
    assert.equal(row.closed, false);
    assert.equal(row.shares, 5);
    assert.deepEqual(row.accountIds, ["acc-rrsp"], "the emptied account stops being tagged");
    assert.equal(row.lots.length, 2, "both lots are still available as detail");
  });

  test("a wholly closed position keeps its account tags for the record", () => {
    const [row] = consolidateHoldings([
      lot({ id: "a", accountId: "acc-tfsa", shares: 0 }),
      lot({ id: "b", accountId: "acc-rrsp", shares: 0 }),
    ]);
    assert.equal(row.closed, true);
    assert.deepEqual(row.accountIds, ["acc-tfsa", "acc-rrsp"]);
  });
});

describe("replayFlows", () => {
  test("a straight buy leaves cost and no realized gain", () => {
    const r = replayFlows([{ date: "2025-01-01", kind: "buy", amount: 300, shares: 10 }]);
    assert.equal(r.shares, 10);
    assert.equal(r.costCAD, 300);
    assert.equal(r.realizedGainCAD, 0, "nothing sold, nothing realized");
  });

  test("a partial sale realizes the gain on the shares that left", () => {
    // Bought 10 at 30. Sold 4 for 200, which had cost 120.
    const r = replayFlows([
      { date: "2025-01-01", kind: "buy", amount: 300, shares: 10 },
      { date: "2025-06-01", kind: "sell", amount: 200, shares: -4 },
    ]);
    assert.equal(r.shares, 6);
    assert.equal(r.realizedGainCAD, 80, "200 proceeds less 120 of cost");
    assert.equal(r.costCAD, 180, "the remaining six still cost 30 each");
  });

  test("a full sale realizes everything and leaves no basis", () => {
    const r = replayFlows([
      { date: "2025-01-01", kind: "buy", amount: 300, shares: 10 },
      { date: "2025-06-01", kind: "sell", amount: 500, shares: -10 },
    ]);
    assert.equal(r.shares, 0);
    assert.equal(r.costCAD, 0);
    assert.equal(r.realizedGainCAD, 200);
  });

  test("a realized loss is negative", () => {
    const r = replayFlows([
      { date: "2025-01-01", kind: "buy", amount: 300, shares: 10 },
      { date: "2025-06-01", kind: "sell", amount: 100, shares: -10 },
    ]);
    assert.equal(r.realizedGainCAD, -200);
  });

  test("buys at different prices are disposed of at the average", () => {
    const r = replayFlows([
      { date: "2025-01-01", kind: "buy", amount: 100, shares: 10 },
      { date: "2025-02-01", kind: "buy", amount: 300, shares: 10 },
      { date: "2025-06-01", kind: "sell", amount: 250, shares: -10 },
    ]);
    // Average cost is 20; ten shares cost 200 and fetched 250.
    assert.equal(r.realizedGainCAD, 50);
    assert.equal(r.costCAD, 200, "the remaining ten keep the same average");
  });

  test("dividends accumulate without touching the basis", () => {
    const r = replayFlows([
      { date: "2025-01-01", kind: "buy", amount: 300, shares: 10 },
      { date: "2025-03-01", kind: "dividend", amount: 12, shares: 0 },
    ]);
    assert.equal(r.dividendsCAD, 12);
    assert.equal(r.costCAD, 300);
    assert.equal(r.realizedGainCAD, 0);
  });

  test("flows out of order are replayed chronologically", () => {
    const r = replayFlows([
      { date: "2025-06-01", kind: "sell", amount: 200, shares: -4 },
      { date: "2025-01-01", kind: "buy", amount: 300, shares: 10 },
    ]);
    assert.equal(r.shares, 6, "the sale cannot be applied before the purchase");
    assert.equal(r.realizedGainCAD, 80);
  });

  test("no flows means nothing, not a crash", () => {
    assert.deepEqual(replayFlows([]), {
      shares: 0,
      costCAD: 0,
      realizedGainCAD: 0,
      dividendsCAD: 0,
    });
  });
});

describe("realized gain and MWRR on a row", () => {
  const withFlows = (over: Partial<Holding>): Holding =>
    ({
      id: "h",
      ticker: "XEQT",
      name: "XEQT",
      assetClass: "US Equity",
      shares: 0,
      avgCost: 0,
      price: 40,
      history: [40],
      dividendsReceived: 0,
      accountId: "acc-tfsa",
      currency: "CAD",
      priceCAD: 40,
      avgCostCAD: 0,
      dividendsReceivedCAD: 0,
      historyCAD: [40],
      flows: [],
      ...over,
    }) as Holding;

  test("a closed position reports what it actually made", () => {
    // Previously this showed a gain of zero: proceeds were discarded, so
    // every closed position looked like it had made nothing.
    const [row] = consolidateHoldings(
      [
        withFlows({
          shares: 0,
          dividendsReceivedCAD: 20,
          flows: [
            { date: "2024-01-01", kind: "buy", amount: 1000, shares: 50 },
            { date: "2024-07-01", kind: "dividend", amount: 20, shares: 0 },
            { date: "2025-01-01", kind: "sell", amount: 1400, shares: -50 },
          ],
        }),
      ],
      "2026-01-01",
    );
    assert.equal(row.gain, 0, "nothing is still held, so nothing is unrealized");
    assert.equal(row.realizedGain, 400, "1400 out against 1000 of cost");
    assert.equal(row.totalReturn, 420, "realized plus dividends");
  });

  test("MWRR reflects the actual holding period, not a fixed window", () => {
    const [row] = consolidateHoldings(
      [
        withFlows({
          shares: 0,
          flows: [
            { date: "2025-01-01", kind: "buy", amount: 100, shares: 10 },
            { date: "2026-01-01", kind: "sell", amount: 200, shares: -10 },
          ],
        }),
      ],
      "2026-01-01",
    );
    assert.ok(
      row.mwrr !== null && Math.abs(row.mwrr - 100) < 0.5,
      `doubling over exactly one year is ~100%, got ${row.mwrr}`,
    );
  });

  test("a position with no trade history has no MWRR rather than zero", () => {
    const [row] = consolidateHoldings([withFlows({ shares: 10, avgCostCAD: 30 })], "2026-01-01");
    assert.equal(row.mwrr, null);
    assert.equal(row.realizedGain, 0);
  });

  test("realized gain pools across accounts", () => {
    const [row] = consolidateHoldings(
      [
        withFlows({
          id: "a",
          accountId: "acc-tfsa",
          flows: [
            { date: "2024-01-01", kind: "buy", amount: 100, shares: 10 },
            { date: "2025-01-01", kind: "sell", amount: 150, shares: -10 },
          ],
        }),
        withFlows({
          id: "b",
          accountId: "acc-rrsp",
          flows: [
            { date: "2024-01-01", kind: "buy", amount: 100, shares: 10 },
            { date: "2025-01-01", kind: "sell", amount: 60, shares: -10 },
          ],
        }),
      ],
      "2026-01-01",
    );
    assert.equal(row.realizedGain, 10, "+50 in one account, -40 in the other");
  });
});

describe("allTimeSeries", () => {
  const lot = (over: Partial<Holding>): Holding =>
    ({
      id: "h",
      ticker: "AAA",
      name: "AAA",
      assetClass: "US Equity",
      shares: 0,
      avgCost: 0,
      price: 0,
      history: [],
      dividendsReceived: 0,
      accountId: "acc",
      currency: "CAD",
      priceCAD: 0,
      avgCostCAD: 0,
      dividendsReceivedCAD: 0,
      historyCAD: [],
      flows: [],
      ...over,
    }) as Holding;

  const MONTHS = ["2024-01", "2024-02", "2024-03", "2024-04"];

  test("the first trade sets where the series can start", () => {
    const holdings = [
      lot({ flows: [{ date: "2023-07-14", kind: "buy", amount: 100, shares: 1 }] }),
      lot({ id: "b", flows: [{ date: "2022-11-02", kind: "buy", amount: 50, shares: 1 }] }),
    ];
    assert.equal(firstFlowMonth(holdings), "2022-11");
    assert.equal(firstFlowMonth([lot({})]), null, "nothing recorded, nothing to plot");
  });

  test("monthsSince spans both ends inclusively", () => {
    assert.deepEqual(monthsSince("2024-01", "2024-04"), MONTHS);
    assert.deepEqual(monthsSince("2024-04", "2024-04"), ["2024-04"]);
  });

  test("values the shares actually held that month, not today's", () => {
    const holdings = [
      lot({
        shares: 10,
        flows: [
          { date: "2024-02-10", kind: "buy", amount: 200, shares: 10 },
        ],
      }),
    ];
    const closes = { AAA: { "2024-01": 15, "2024-02": 20, "2024-03": 25, "2024-04": 30 } };
    const { points } = allTimeSeries(holdings, closes, MONTHS);
    assert.equal(points[0].value, 0, "not yet bought");
    assert.equal(points[1].value, 200);
    assert.equal(points[3].value, 300);
    assert.deepEqual(
      points.map((p) => p.cost),
      [0, 200, 200, 200],
      "cost appears when it was paid and stays put",
    );
  });

  test("a sale removes its share of the basis and stops the valuation", () => {
    const holdings = [
      lot({
        flows: [
          { date: "2024-01-05", kind: "buy", amount: 400, shares: 20 },
          { date: "2024-03-05", kind: "sell", amount: 600, shares: -20 },
        ],
      }),
    ];
    const closes = { AAA: { "2024-01": 20, "2024-02": 25, "2024-03": 30, "2024-04": 35 } };
    const { points } = allTimeSeries(holdings, closes, MONTHS);
    assert.deepEqual(points.map((p) => p.value), [400, 500, 0, 0]);
    assert.deepEqual(points.map((p) => p.cost), [400, 400, 0, 0]);
  });

  test("a dividend changes neither the shares nor the cost", () => {
    const holdings = [
      lot({
        flows: [
          { date: "2024-01-05", kind: "buy", amount: 100, shares: 10 },
          { date: "2024-02-05", kind: "dividend", amount: 9, shares: 0 },
        ],
      }),
    ];
    const closes = { AAA: { "2024-01": 10, "2024-02": 10, "2024-03": 10, "2024-04": 10 } };
    const { points } = allTimeSeries(holdings, closes, MONTHS);
    assert.deepEqual(points.map((p) => p.value), [100, 100, 100, 100]);
    assert.deepEqual(points.map((p) => p.cost), [100, 100, 100, 100]);
  });

  test("a gap in the price series carries the nearest close, not a zero", () => {
    const holdings = [
      lot({ flows: [{ date: "2024-01-05", kind: "buy", amount: 100, shares: 10 }] }),
    ];
    // Only February is known: January carries it back, March and April forward.
    const { points } = allTimeSeries(holdings, { AAA: { "2024-02": 12 } }, MONTHS);
    assert.deepEqual(points.map((p) => p.value), [120, 120, 120, 120]);
  });

  test("a ticker with no prices at all falls back to book cost and says so", () => {
    const holdings = [
      lot({ flows: [{ date: "2024-01-05", kind: "buy", amount: 100, shares: 10 }] }),
    ];
    const { points, unpriced } = allTimeSeries(holdings, {}, MONTHS);
    assert.deepEqual(points.map((p) => p.value), [100, 100, 100, 100]);
    assert.deepEqual(unpriced, ["AAA"]);
  });

  test("a recorded month-end value is used in place of shares times price", () => {
    const holdings = [
      lot({ flows: [{ date: "2024-01-05", kind: "buy", amount: 100, shares: 10 }] }),
    ];
    const closes = { AAA: { "2024-01": 10, "2024-02": 10, "2024-03": 10, "2024-04": 10 } };
    const snapshots = { "2024-02": { AAA: 175 }, "2024-03": { AAA: 250 } };
    const { points } = allTimeSeries(holdings, closes, MONTHS, snapshots);
    assert.deepEqual(
      points.map((p) => p.value),
      [100, 175, 250, 100],
      "recorded months win; the rest fall back to the price",
    );
  });

  test("a position recorded but never traded still counts toward value", () => {
    // Held before the trade log existed: no flows, but it was worth something.
    const { points } = allTimeSeries([], {}, MONTHS, {
      "2024-01": { OLD: 500 },
      "2024-02": { OLD: 450 },
    });
    assert.deepEqual(points.map((p) => p.value), [500, 450, 0, 0]);
    assert.deepEqual(points.map((p) => p.cost), [0, 0, 0, 0], "no trades, no cost");
  });

  test("a recorded ticker is not double counted against its own shares", () => {
    const holdings = [
      lot({ flows: [{ date: "2024-01-05", kind: "buy", amount: 100, shares: 10 }] }),
    ];
    const { points } = allTimeSeries(holdings, { AAA: { "2024-01": 10 } }, MONTHS, {
      "2024-01": { AAA: 130 },
    });
    assert.equal(points[0].value, 130, "the snapshot replaces the price, it does not add to it");
  });

  test("months valued entirely from records are counted", () => {
    const { snapshotMonths } = allTimeSeries([], {}, MONTHS, {
      "2024-01": { OLD: 500 },
      "2024-03": { OLD: 450 },
    });
    assert.equal(snapshotMonths, 2);
  });

  test("the current month falls back to the live price, not to book cost", () => {
    const holdings = [
      lot({
        shares: 10,
        priceCAD: 30,
        flows: [{ date: "2024-01-05", kind: "buy", amount: 100, shares: 10 }],
      }),
    ];
    // No snapshot and no close for any month: only the last one may use the
    // live price, since today's price says nothing about January.
    const { points } = allTimeSeries(holdings, {}, MONTHS, {});
    assert.deepEqual(points.map((p) => p.value), [100, 100, 100, 300]);
  });

  test("the live price comes from an open lot, not a stale closed one", () => {
    const flows = [{ date: "2024-01-05", kind: "buy" as const, amount: 100, shares: 10 }];
    const holdings = [
      // Sold out long ago, still carrying the price it had then.
      lot({ id: "old", shares: 0, priceCAD: 3, flows: [] }),
      lot({ id: "open", accountId: "acc2", shares: 10, priceCAD: 30, flows }),
    ];
    const { points } = allTimeSeries(holdings, {}, MONTHS, {});
    assert.equal(points[3].value, 300, "10 shares at 30, not at the closed lot's 3");
  });

  test("positions are summed across accounts", () => {
    const flows = [{ date: "2024-01-05", kind: "buy" as const, amount: 100, shares: 10 }];
    const { points } = allTimeSeries(
      [lot({ id: "a", flows }), lot({ id: "b", accountId: "acc2", flows })],
      { AAA: { "2024-01": 10, "2024-02": 11, "2024-03": 12, "2024-04": 13 } },
      MONTHS,
    );
    assert.deepEqual(points.map((p) => p.value), [200, 220, 240, 260]);
  });
});

describe("time-weighted return", () => {
  const pt = (key: string, value: number) => ({ key, label: key, value, cost: 0 });

  test("a deposit is not performance", () => {
    // Doubles from 100 to 200, but only because 100 was paid in.
    const points = [pt("2024-01", 100), pt("2024-02", 200)];
    assert.equal(chainedReturns(points, { "2024-02": 100 })[1], 0);
  });

  test("growth with no flows is the plain return", () => {
    const points = [pt("2024-01", 100), pt("2024-02", 110)];
    assert.equal(chainedReturns(points, {})[1], 10);
  });

  test("returns chain across months rather than summing", () => {
    const points = [pt("2024-01", 100), pt("2024-02", 110), pt("2024-03", 121)];
    const out = chainedReturns(points, {});
    assert.equal(out[1], 10);
    assert.equal(out[2], 21, "1.1 × 1.1 − 1, not 10 + 10");
  });

  test("a mid-month deposit counts as half-present", () => {
    // Modified Dietz: gain 10 over capital 100 + 50/2 = 125.
    const points = [pt("2024-01", 100), pt("2024-02", 160)];
    assert.equal(chainedReturns(points, { "2024-02": 50 })[1], 8);
  });

  test("a withdrawal does not read as a loss", () => {
    const points = [pt("2024-01", 200), pt("2024-02", 100)];
    assert.equal(chainedReturns(points, { "2024-02": -100 })[1], 0);
  });

  test("a month that started empty contributes no return", () => {
    const points = [pt("2024-01", 0), pt("2024-02", 500)];
    assert.equal(chainedReturns(points, { "2024-02": 500 })[1], 0);
  });

  test("a cash dividend is credited as return, not ignored", () => {
    // Value flat at 1000 while $50 was paid out: the month earned $50.
    const points = [pt("2024-01", 1000), pt("2024-02", 1000)];
    const out = chainedReturns(points, { "2024-02": -50 })[1];
    assert.ok(out > 4.9 && out < 5.2, `expected about 5%, got ${out}%`);
  });

  test("a reinvested dividend is not new money", () => {
    // Dividend out, purchase back in: they net to zero, and the value it
    // added reads as gain rather than as a contribution.
    const points = [pt("2024-01", 1000), pt("2024-02", 1050)];
    assert.equal(chainedReturns(points, { "2024-02": 0 })[1], 5);
  });

  test("net flows count dividends as money out and net out rotation", () => {
    const holdings = [
      {
        ticker: "A", flows: [
          { date: "2024-01-10", kind: "buy", amount: 100, shares: 1 },
          { date: "2024-01-20", kind: "dividend", amount: 5, shares: 0 },
        ],
      },
      {
        ticker: "B", flows: [
          { date: "2024-01-15", kind: "sell", amount: 40, shares: -1 },
        ],
      },
    ] as unknown as Holding[];
    // 100 in, 40 out, 5 paid out as a dividend.
    assert.deepEqual(netExternalFlows(holdings), { "2024-01": 55 });
  });
});

describe("a trade dated after the valuation date", () => {
  const flows = [
    { date: "2025-01-15", kind: "buy" as const, amount: 10000, shares: 250 },
    { date: "2026-01-20", kind: "buy" as const, amount: 8000, shares: 180 },
  ];
  const holding = {
    id: "h",
    ticker: "XEQT.TO",
    name: "XEQT",
    shares: 430,
    avgCost: 41.86,
    avgCostCAD: 41.86,
    price: 45.92,
    priceCAD: 45.92,
    currency: "CAD",
    accountId: "a1",
    dividendsReceived: 0,
    dividendsReceivedCAD: 0,
    history: [45.92],
    historyCAD: [45.92],
    flows,
  } as unknown as Holding;

  /*
   * The closing value used to be dated the fifteenth of the current month, so
   * anything bought after it left the series ending on money going out and
   * never coming back — which has no rate at all. XEQT was bought on the 17th
   * and showed no return for the rest of the month.
   */
  test("still has a return on the position", () => {
    const [row] = consolidateHoldings([holding], "2026-01-15");
    assert.notEqual(row.mwrr, null, "the value is dated to the trade, not before it");
  });

  test("and on the portfolio holding it", () => {
    assert.notEqual(portfolioMwrr([holding], 19745.6, "2026-01-15"), null);
  });

  test("the figure matches valuing it on the day of that trade", () => {
    const clamped = portfolioMwrr([holding], 19745.6, "2026-01-15");
    assert.equal(clamped, portfolioMwrr([holding], 19745.6, "2026-01-20"));
  });

  test("a later valuation date is still used as given", () => {
    // Only the clamp is new: asking for a date after every flow works as it
    // always did, and gives a different answer, since time has passed.
    const later = portfolioMwrr([holding], 19745.6, "2026-06-30");
    assert.notEqual(later, null);
    assert.notEqual(later, portfolioMwrr([holding], 19745.6, "2026-01-20"));
  });
});

describe("portfolioMwrr", () => {
  const holding = (flows: unknown[]): Holding => ({ ticker: "A", flows } as unknown as Holding);

  test("doubling over a year is about 100%", () => {
    const r = portfolioMwrr(
      [holding([{ date: "2024-01-01", kind: "buy", amount: 1000, shares: 1 }])],
      2000,
      "2025-01-01",
    );
    assert.ok(r !== null && r > 99 && r < 101, `expected ~100%, got ${r}`);
  });

  test("flows from every position are pooled", () => {
    // Two positions, each 1000 in, 2400 back after a year.
    const r = portfolioMwrr(
      [
        holding([{ date: "2024-01-01", kind: "buy", amount: 1000, shares: 1 }]),
        holding([{ date: "2024-01-01", kind: "buy", amount: 1000, shares: 1 }]),
      ],
      2400,
      "2025-01-01",
    );
    assert.ok(r !== null && r > 19 && r < 21, `expected ~20%, got ${r}`);
  });

  test("a closed position keeps its flows and adds no value", () => {
    // Bought for 1000, sold a year later for 1200, nothing held now.
    const r = portfolioMwrr(
      [
        holding([
          { date: "2024-01-01", kind: "buy", amount: 1000, shares: 1 },
          { date: "2025-01-01", kind: "sell", amount: 1200, shares: -1 },
        ]),
      ],
      0,
      "2025-01-01",
    );
    assert.ok(r !== null && r > 19 && r < 21, `expected ~20%, got ${r}`);
  });

  test("dividends count as money received", () => {
    const withDividend = portfolioMwrr(
      [
        holding([
          { date: "2024-01-01", kind: "buy", amount: 1000, shares: 1 },
          { date: "2024-07-01", kind: "dividend", amount: 100, shares: 0 },
        ]),
      ],
      1000,
      "2025-01-01",
    );
    const without = portfolioMwrr(
      [holding([{ date: "2024-01-01", kind: "buy", amount: 1000, shares: 1 }])],
      1000,
      "2025-01-01",
    );
    assert.ok(without !== null && Math.abs(without) < 0.5, "no dividend, no return");
    assert.ok(withDividend !== null && withDividend > 9, `dividend should lift it, got ${withDividend}`);
  });

  test("nothing to solve returns null rather than zero", () => {
    assert.equal(portfolioMwrr([], 1000, "2025-01-01"), null);
    assert.equal(portfolioMwrr([holding([])], 1000, "2025-01-01"), null);
  });

  test("timing is what separates it from a time-weighted return", () => {
    // Same money, same end value, different timing: money-weighted differs.
    const early = portfolioMwrr(
      [holding([
        { date: "2024-01-01", kind: "buy", amount: 1000, shares: 1 },
        { date: "2024-02-01", kind: "buy", amount: 1000, shares: 1 },
      ])],
      2400, "2025-01-01",
    );
    const late = portfolioMwrr(
      [holding([
        { date: "2024-01-01", kind: "buy", amount: 1000, shares: 1 },
        { date: "2024-11-01", kind: "buy", amount: 1000, shares: 1 },
      ])],
      2400, "2025-01-01",
    );
    assert.ok(early !== null && late !== null && late > early,
      `money in later earns over less time, so the same gain is a higher rate (${early} vs ${late})`);
  });
});

describe("annualized", () => {
  test("a year of return is already annual", () => {
    assert.equal(Math.round(annualized(20, 12)!), 20);
  });

  test("two years of 21% is 10% a year, not 10.5%", () => {
    assert.ok(Math.abs(annualized(21, 24)! - 10) < 0.01, "compounding, not division");
  });

  test("a quarter is extrapolated", () => {
    // 1.05^4 - 1 = 21.55%
    assert.ok(Math.abs(annualized(5, 3)! - 21.55) < 0.05);
  });

  test("a total loss has no annual rate to give", () => {
    assert.equal(annualized(-100, 12), null);
    assert.equal(annualized(10, 0), null);
  });
});

describe("portfolioMwrrOver", () => {
  const holding = (flows: unknown[]): Holding => ({ ticker: "A", flows } as unknown as Holding);

  test("the opening value counts as money already at work", () => {
    // Worth 1000 at the start, 1100 a year later, nothing added.
    const r = portfolioMwrrOver([holding([])], "2024-01", 1000, "2025-01", 1100);
    assert.ok(r !== null && r > 9.5 && r < 10.5, `expected ~10%, got ${r}`);
  });

  test("flows outside the window are ignored", () => {
    const flows = [
      { date: "2023-06-01", kind: "buy", amount: 5000, shares: 1 },
      { date: "2026-06-01", kind: "buy", amount: 5000, shares: 1 },
    ];
    const r = portfolioMwrrOver([holding(flows)], "2024-01", 1000, "2025-01", 1100);
    assert.ok(r !== null && r > 9.5 && r < 10.5, `a distant trade must not count, got ${r}`);
  });

  test("a contribution inside the window is counted", () => {
    // 1000 at work, 1000 more added at the halfway point, ending at 2100.
    const r = portfolioMwrrOver(
      [holding([{ date: "2024-07-01", kind: "buy", amount: 1000, shares: 1 }])],
      "2024-01", 1000, "2025-01", 2100,
    );
    assert.ok(r !== null && r > 0 && r < 10, `a late deposit dilutes the rate, got ${r}`);
  });

  test("an empty window has nothing to solve", () => {
    assert.equal(portfolioMwrrOver([holding([])], "2024-01", 0, "2025-01", 0), null);
  });
});

describe("overMonths", () => {
  test("it undoes annualized", () => {
    const round = overMonths(annualized(26.6, 3)!, 3)!;
    assert.ok(Math.abs(round - 26.6) < 0.001, `round trip lost the number: ${round}`);
  });

  test("a quarter of a 10% year is about 2.4%, not 2.5%", () => {
    assert.ok(Math.abs(overMonths(10, 3)! - 2.411) < 0.01, "compounding, not division");
  });

  test("a full year is unchanged", () => {
    assert.ok(Math.abs(overMonths(10, 12)! - 10) < 1e-9);
  });

  test("a rate that wipes out capital has nothing to restate", () => {
    assert.equal(overMonths(-100, 6), null);
    assert.equal(overMonths(10, 0), null);
  });
});

describe("simpleReturn", () => {
  const holding = (flows: unknown[]): Holding => ({ ticker: "A", flows } as unknown as Holding);

  test("sale proceeds are netted off what was bought", () => {
    /*
     * $1,000 went in and $300 came back out, so $700 is at risk — not $1,000.
     * Dividing by the gross figure was the bug: it read a real portfolio as
     * $946,990 invested when $623,345 had been put in, the rest being the same
     * money reinvested.
     */
    const r = simpleReturn(
      [holding([
        { date: "2024-01-01", kind: "buy", amount: 1000, shares: 10 },
        { date: "2024-06-01", kind: "sell", amount: 300, shares: -3 },
      ])],
      900,
    );
    assert.equal(r.contributed, 700);
    assert.equal(r.grossBought, 1000);
    assert.equal(r.grossSold, 300);
    assert.equal(r.held, 900);
    assert.ok(Math.abs(r.pct! - 28.5714) < 0.001, "900 held on 700 in");
  });

  test("money recycled through a sale is not new capital", () => {
    /*
     * Sell one position, buy another with the proceeds. Gross purchases double;
     * nothing further was contributed, and the return must not be quoted over
     * the larger number.
     */
    const recycled = simpleReturn(
      [holding([
        { date: "2024-01-01", kind: "buy", amount: 1000, shares: 10 },
        { date: "2024-06-01", kind: "sell", amount: 1000, shares: -10 },
        { date: "2024-06-02", kind: "buy", amount: 1000, shares: 8 },
      ])],
      1200,
    );
    const straight = simpleReturn(
      [holding([{ date: "2024-01-01", kind: "buy", amount: 1000, shares: 10 }])],
      1200,
    );
    assert.equal(recycled.contributed, 1000);
    assert.equal(recycled.grossBought, 2000);
    assert.equal(recycled.pct, straight.pct, "same money in, same return");
  });

  test("a portfolio that returned more than it was given has no percentage", () => {
    // Nothing left invested to divide by; a negative denominator would flip
    // the sign rather than fail visibly.
    const r = simpleReturn(
      [holding([
        { date: "2024-01-01", kind: "buy", amount: 1000, shares: 10 },
        { date: "2024-06-01", kind: "sell", amount: 1500, shares: -10 },
      ])],
      0,
    );
    assert.equal(r.contributed, 0);
    assert.equal(r.pct, null);
  });

  test("dividends count as money back", () => {
    const r = simpleReturn(
      [holding([
        { date: "2024-01-01", kind: "buy", amount: 1000, shares: 10 },
        { date: "2024-06-01", kind: "dividend", amount: 50, shares: 0 },
      ])],
      1000,
    );
    assert.equal(r.returned, 50);
    assert.equal(r.contributed, 1000, "a dividend is a return, not a withdrawal");
    assert.equal(r.pct, 5);
  });

  test("it is blind to time, which is the point", () => {
    const fast = simpleReturn(
      [holding([{ date: "2024-01-01", kind: "buy", amount: 100, shares: 1 }])], 110);
    const slow = simpleReturn(
      [holding([{ date: "2014-01-01", kind: "buy", amount: 100, shares: 1 }])], 110);
    assert.equal(fast.pct, slow.pct, "ten years and one month read the same");
  });

  test("nothing paid in has no percentage to give", () => {
    assert.equal(simpleReturn([], 500).pct, null);
  });
});

describe("borrowed money is not income", () => {
  const loan = (date: string, amount: number) =>
    txn({ date, amount, type: "income" as const, category: "Loan Proceeds" });
  const pay = (date: string, amount: number) =>
    txn({ date, amount, type: "income" as const, category: "Salary" });

  test("it is left out of the income totals", () => {
    const only = monthTotals([loan(DAY, 20000)], MONTH);
    assert.equal(only.income, 0);
    const both = monthTotals([loan(DAY, 20000), pay(DAY, 5000)], MONTH);
    assert.equal(both.income, 5000);
  });

  test("and out of the monthly averages, so the savings rate is not flattered", () => {
    // One month of data, so the average is that month: the pay and not the
    // drawdown, which would otherwise quadruple it.
    const rows = [loan(DAY, 12000), pay(DAY, 4000)];
    assert.equal(monthlyAverages(rows, 12, MONTH).income, 4000);
  });

  test("and it is not a source on the income page", () => {
    const b = incomeBySource([loan(DAY, 9000), pay(DAY, 3000)], 1, MONTH);
    assert.deepEqual(
      b.sources.map((s) => s.category),
      ["Salary"],
    );
    assert.equal(b.total, 3000);
  });

  test("but spending is still spending", () => {
    // The mirror image is a repayment, which is an expense and stays one.
    const rows = [txn({ amount: 500, type: "expense", category: "Debt Repayment", date: DAY })];
    assert.equal(monthTotals(rows, MONTH).expenses, 500);
  });
});

describe("incomeBySource", () => {
  const pay = (date: string, amount: number, category = "Salary") =>
    txn({ date, amount, type: "income", category });

  test("splits a month by where the money came from", () => {
    const b = incomeBySource(
      [pay("2026-08-31", 4000), pay("2026-08-31", 500, "Interest")],
      1,
      "2026-08",
    );
    assert.deepEqual(
      b.sources.map((s) => [s.category, s.total]),
      [["Salary", 4000], ["Interest", 500]],
    );
    assert.equal(b.total, 4500);
  });

  test("shares are of income, and add up", () => {
    const b = incomeBySource([pay("2026-08-31", 3000), pay("2026-08-31", 1000, "Gifts")], 1, "2026-08");
    assert.equal(Math.round(b.sources[0].share), 75);
    assert.equal(Math.round(b.sources.reduce((n, s) => n + s.share, 0)), 100);
  });

  test("averages over the window, not over the months it arrived in", () => {
    // One bonus in a twelve-month window is $100 a month, not $1,200.
    const b = incomeBySource([pay("2026-08-31", 1200, "Additional Income")], 12, "2026-08");
    assert.equal(b.sources[0].average, 100);
    assert.equal(b.sources[0].months, 1);
  });

  test("the comparison is the window before, not the month before", () => {
    const b = incomeBySource(
      [pay("2026-08-31", 1000), pay("2025-08-31", 800)],
      12,
      "2026-08",
    );
    assert.equal(b.sources[0].previous, 800);
    assert.equal(b.sources[0].change, 0.25);
  });

  test("a source that is new has no change, rather than a rise", () => {
    const b = incomeBySource([pay("2026-08-31", 500, "Dividends")], 12, "2026-08");
    assert.equal(b.sources[0].change, null);
  });

  test("a source that stopped is a fall, not an absence", () => {
    const b = incomeBySource(
      [pay("2026-08-31", 1000), pay("2025-08-31", 700, "Refund")],
      12,
      "2026-08",
    );
    const refund = b.sources.find((s) => s.category === "Refund");
    assert.equal(refund, undefined);
  });

  test("every month of the window gets a row, empty ones included", () => {
    const b = incomeBySource([pay("2026-08-31", 100)], 3, "2026-08");
    assert.deepEqual(b.months.map((m) => m.key), ["2026-06", "2026-07", "2026-08"]);
    assert.equal(b.months[0].Salary, 0);
    assert.equal(b.months[2].Salary, 100);
  });

  test("spending is not income", () => {
    const b = incomeBySource([txn({ amount: 900, type: "expense", date: "2026-08-31" })], 1, "2026-08");
    assert.equal(b.total, 0);
    assert.deepEqual(b.sources, []);
  });

  test("a pension contribution is income you cannot spend", () => {
    const b = incomeBySource([pay("2026-08-31", 400, "RSP / Pension")], 1, "2026-08");
    assert.equal(b.sources[0].spendable, false);
  });
});
