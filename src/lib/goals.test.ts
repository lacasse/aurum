import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  cleanGoals,
  describe as describeGoal,
  dollarsOf,
  measure,
  newlyMet,
  progressOf,
  type Goal,
  type GoalInputs,
} from "./goals";
import type { NetWorthPoint, PortfolioPoint } from "./analytics";
import type { Account, Transaction } from "./types";

/* ALL-FIXTURES-INVENTED */

const point = (key: string, net: number, extra: Partial<NetWorthPoint> = {}) =>
  ({ key, label: key, assets: 0, liabilities: 0, portfolio: 0, pension: 0, net, ...extra }) as NetWorthPoint;

const txn = (
  date: string,
  type: "income" | "expense" | "transfer",
  amount: number,
  category = "Groceries",
  extra: Partial<Transaction> = {},
) => ({ id: `${date}-${amount}-${category}`, date, type, amount, category, payee: "x", ...extra }) as Transaction;

const tfsa = {
  id: "tfsa",
  name: "TFSA",
  institution: "—",
  kind: "investment",
  balance: 0,
  history: [],
  registration: "TFSA",
} as unknown as Account;

const inputs = (over: Partial<GoalInputs> = {}): GoalInputs => ({
  transactions: [],
  accounts: [tfsa],
  netWorth: [],
  portfolio: [],
  flowsByMonth: {},
  limits: {},
  isClosed: () => false,
  today: "2026-06-15",
  ...over,
});

const goal = (over: Partial<Goal>): Goal => ({
  id: "g",
  year: "2026",
  metric: "saved",
  basis: "amount",
  target: 1000,
  by: "2026-12",
  createdAt: "2026-01-05",
  ...over,
});

describe("a level goal is met at any point in the window", () => {
  const netWorth = [
    point("2025-12", 40000),
    point("2026-01", 45000),
    point("2026-03", 51000),
    point("2026-05", 48000),
  ];

  test("touching the target in March meets it, though May fell back", () => {
    const p = progressOf(goal({ metric: "netWorth", target: 50000 }), inputs({ netWorth }));
    assert.equal(p.metNow, true);
    assert.equal(p.status, "met");
    assert.equal(p.measure.value, 48000, "the figure shown is where it stands");
  });

  test("a month before the window does not count", () => {
    const early = [point("2025-11", 60000), ...netWorth];
    const p = progressOf(goal({ metric: "netWorth", target: 55000 }), inputs({ netWorth: early }));
    assert.equal(p.metNow, false);
  });

  test("paced from where the year started, not from nothing", () => {
    // Half the year gone, and half of the way from the opening figure.
    const p = progressOf(
      goal({ metric: "netWorth", target: 60000 }),
      inputs({ netWorth, today: "2026-07-01" }),
    );
    assert.equal(p.status, "behind", "48k is short of 50k, halfway from 40k to 60k");
  });
});

describe("debt counts down", () => {
  test("met when the balance first reaches the target", () => {
    const netWorth = [
      point("2025-12", 0, { liabilities: 9000 }),
      point("2026-02", 0, { liabilities: 5000 }),
      point("2026-04", 0, { liabilities: 4000 }),
    ];
    const p = progressOf(goal({ metric: "debt", target: 4000 }), inputs({ netWorth }));
    assert.equal(p.metNow, true);
  });

  test("the bar is the share of the way down, from where it began", () => {
    const netWorth = [
      point("2025-12", 0, { liabilities: 10000 }),
      point("2026-05", 0, { liabilities: 6000 }),
    ];
    const p = progressOf(goal({ metric: "debt", target: 0 }), inputs({ netWorth }));
    assert.equal(p.fraction, 0.4);
    assert.equal(p.metNow, false);
  });
});

describe("a sum goal counts only its own months", () => {
  const transactions = [
    txn("2025-12-20", "income", 5000, "Salary"),
    txn("2026-01-31", "income", 4000, "Salary"),
    txn("2026-02-10", "expense", 1500),
    txn("2026-02-28", "income", 60, "Interest"),
    txn("2026-07-31", "income", 4000, "Salary"),
  ];

  test("saving is income less spending, inside the window", () => {
    const m = measure(goal({ metric: "saved" }), inputs({ transactions }));
    assert.equal(m.value, 2560);
  });

  test("a goal due in March stops counting at March", () => {
    const m = measure(
      goal({ metric: "saved", by: "2026-03" }),
      inputs({ transactions, today: "2026-09-01" }),
    );
    assert.equal(m.value, 2560, "July's salary is after the goal was due");
  });

  test("passive income is the passive categories only", () => {
    const m = measure(goal({ metric: "passive" }), inputs({ transactions }));
    assert.equal(m.value, 60);
  });

  test("a contribution is a transfer into the plan, by the room gauges' rule", () => {
    const withTransfer = [
      ...transactions,
      txn("2026-03-01", "transfer", 2500, "Transfer", { destinationAccountId: "tfsa" }),
    ];
    const p = progressOf(
      goal({ metric: "contribution", plan: "TFSA", target: 2500 }),
      inputs({ transactions: withTransfer }),
    );
    assert.equal(p.measure.value, 2500);
    assert.equal(p.metNow, true);
  });

  test("money invested sums the months of flows inside the window", () => {
    const m = measure(
      goal({ metric: "invested" }),
      inputs({ flowsByMonth: { "2025-12": 900, "2026-02": 300, "2026-05": -100 } }),
    );
    assert.equal(m.value, 200);
  });
});

describe("a whole-window goal waits for its last month to close", () => {
  const transactions = [
    txn("2026-01-31", "income", 3000, "Salary"),
    txn("2026-01-15", "expense", 800),
    txn("2026-01-20", "expense", 200, "Dining"),
  ];

  test("spending under the cap is not met while the window runs", () => {
    const p = progressOf(
      goal({ metric: "spending", target: 5000, by: "2026-03" }),
      inputs({ transactions, today: "2026-02-10" }),
    );
    assert.equal(p.metNow, false);
    assert.equal(p.status, "on-track");
  });

  test("over, but not closed, is awaiting rather than met", () => {
    const p = progressOf(
      goal({ metric: "spending", target: 5000, by: "2026-03" }),
      inputs({ transactions, today: "2026-04-02" }),
    );
    assert.equal(p.metNow, false);
    assert.equal(p.status, "awaiting");
  });

  test("closed and under the cap is met", () => {
    const p = progressOf(
      goal({ metric: "spending", target: 5000, by: "2026-03" }),
      inputs({ transactions, today: "2026-04-02", isClosed: (m) => m === "2026-03" }),
    );
    assert.equal(p.metNow, true);
  });

  test("going over the cap loses it the day it happens", () => {
    const p = progressOf(
      goal({ metric: "spending", target: 900 }),
      inputs({ transactions }),
    );
    assert.equal(p.status, "missed");
  });

  test("one category is held to its own cap", () => {
    const m = measure(goal({ metric: "spending", category: "Dining" }), inputs({ transactions }));
    assert.equal(m.value, 200);
  });

  test("a savings rate is judged over the window once it closes", () => {
    const p = progressOf(
      goal({ metric: "saved", basis: "percent", target: 60, by: "2026-01" }),
      inputs({ transactions, today: "2026-02-05", isClosed: () => true }),
    );
    assert.equal(p.measure.value, 66.7);
    assert.equal(p.metNow, true);
  });
});

describe("charitable giving", () => {
  const transactions = [
    txn("2026-01-31", "income", 4000, "Salary"),
    txn("2026-02-28", "income", 4000, "Salary"),
    txn("2026-02-10", "expense", 300, "Donations"),
    txn("2026-02-12", "expense", 900, "Groceries"),
    txn("2025-12-24", "expense", 500, "Donations"),
  ];

  test("an amount is what was given inside the window", () => {
    const m = measure(goal({ metric: "donations", basis: "amount" }), inputs({ transactions }));
    assert.equal(m.value, 300);
  });

  test("an amount goal is met the moment the total reaches it", () => {
    const p = progressOf(
      goal({ metric: "donations", basis: "amount", target: 300 }),
      inputs({ transactions }),
    );
    assert.equal(p.metNow, true);
  });

  test("a share is of the window's income", () => {
    const m = measure(goal({ metric: "donations", basis: "percent" }), inputs({ transactions }));
    assert.equal(m.value, 3.8, "300 of 8000");
  });

  test("a share is judged over the whole window, not the months so far", () => {
    const early = progressOf(
      goal({ metric: "donations", basis: "percent", target: 3 }),
      inputs({ transactions }),
    );
    assert.equal(early.metNow, false, "ahead in June is not yet a year's giving");
    assert.equal(early.status, "on-track");

    const closed = progressOf(
      goal({ metric: "donations", basis: "percent", target: 3, by: "2026-02" }),
      inputs({ transactions, today: "2026-03-10", isClosed: () => true }),
    );
    assert.equal(closed.metNow, true);
  });

  test("it reads as a sentence either way", () => {
    const fmt = (n: number) => `${n} dollars`;
    assert.equal(
      describeGoal(goal({ metric: "donations", basis: "amount", target: 1200 }), fmt),
      "Give 1200 dollars to charity in 2026",
    );
    assert.equal(
      describeGoal(goal({ metric: "donations", basis: "percent", target: 5 }), fmt),
      "Give 5% of income to charity in 2026",
    );
  });

  test("a stored share over a hundred percent is dropped", () => {
    const kept = cleanGoals([
      goal({ id: "ok", metric: "donations", basis: "percent", target: 10 }),
      goal({ id: "bad", metric: "donations", basis: "percent", target: 140 }),
      goal({ id: "amount", metric: "donations", basis: "amount", target: 140 }),
    ]);
    assert.deepEqual(kept.map((g) => g.id), ["ok", "amount"]);
  });
});

describe("every goal as a percentage", () => {
  test("net worth growth is measured from the December before", () => {
    const netWorth = [point("2025-12", 100000), point("2026-03", 112000), point("2026-05", 108000)];
    const p = progressOf(
      goal({ metric: "netWorth", basis: "percent", target: 10 }),
      inputs({ netWorth }),
    );
    assert.equal(p.measure.value, 8);
    assert.equal(p.metNow, true, "12% in March met it, though May gave some back");
  });

  test("growth from nothing is no growth at all", () => {
    const netWorth = [point("2025-12", -5000), point("2026-03", 2000)];
    const m = measure(goal({ metric: "netWorth", basis: "percent" }), inputs({ netWorth }));
    assert.equal(m.value, null);
  });

  test("a portfolio's return has the money added taken out, as the Year page chains it", () => {
    const port = (key: string, value: number) => ({ key, label: key, value, cost: 0 }) as PortfolioPoint;
    const portfolio = [port("2025-12", 10000), port("2026-01", 16000)];
    // Five thousand of the six-thousand rise was a deposit; the market made the rest.
    const m = measure(
      goal({ metric: "portfolio", basis: "percent" }),
      inputs({ portfolio, flowsByMonth: { "2026-01": 5000 } }),
    );
    assert.equal(m.value, 8);
  });

  test("cash is a share of net worth at each month end", () => {
    const account = {
      id: "chq",
      name: "Chequing",
      institution: "—",
      kind: "checking",
      balance: 12000,
      history: [{ month: "2026-02", value: 12000 }],
    } as unknown as Account;
    const m = measure(
      goal({ metric: "cash", basis: "percent" }),
      inputs({ accounts: [account], netWorth: [point("2026-02", 60000)] }),
    );
    assert.equal(m.value, 20);
  });

  test("a cash goal can leave what the cards owe out", () => {
    const chequing = {
      id: "chq",
      name: "Chequing",
      institution: "—",
      kind: "checking",
      balance: 5000,
      history: [{ month: "2026-02", value: 5000 }],
    } as unknown as Account;
    const card = {
      id: "card",
      name: "Card",
      institution: "—",
      kind: "credit",
      balance: 1000,
      history: [{ month: "2026-02", value: 1000 }],
    } as unknown as Account;
    const given = inputs({ accounts: [chequing, card], netWorth: [point("2026-02", 60000)] });
    assert.equal(measure(goal({ metric: "cash" }), given).value, 4000);
    assert.equal(measure(goal({ metric: "cash", ignoreCards: true }), given).value, 5000);
  });

  test("only a cash goal keeps the choice about cards", () => {
    const [cash, saved] = cleanGoals([
      { ...goal({ metric: "cash" }), id: "a", ignoreCards: true },
      { ...goal({ metric: "saved" }), id: "b", ignoreCards: true },
    ]);
    assert.equal(cash.ignoreCards, true);
    assert.equal(saved.ignoreCards, undefined);
  });

  test("debt paid down is the share of what was owed in December", () => {
    const netWorth = [
      point("2025-12", 0, { liabilities: 20000 }),
      point("2026-04", 0, { liabilities: 15000 }),
    ];
    const p = progressOf(goal({ metric: "debt", basis: "percent", target: 25 }), inputs({ netWorth }));
    assert.equal(p.measure.value, 25);
    assert.equal(p.metNow, true);
  });

  const income = [
    txn("2026-01-31", "income", 5000, "Salary"),
    txn("2026-01-10", "expense", 1000, "Dining"),
    txn("2026-01-11", "expense", 1500, "Housing"),
    txn("2026-01-20", "income", 125, "Interest"),
  ];

  test("money invested is a share of income", () => {
    const m = measure(
      goal({ metric: "invested", basis: "percent" }),
      inputs({ transactions: [txn("2026-01-31", "income", 4000, "Salary")], flowsByMonth: { "2026-01": 600 } }),
    );
    assert.equal(m.value, 15);
  });

  test("passive income is the share of spending it covers", () => {
    const m = measure(goal({ metric: "passive", basis: "percent" }), inputs({ transactions: income }));
    assert.equal(m.value, 5, "125 of 2500 spent");
  });

  test("spending as a share of income is judged once the window closes", () => {
    const g = goal({ metric: "spending", basis: "percent", category: "Dining", target: 25, by: "2026-01" });
    const running = progressOf(g, inputs({ transactions: income, today: "2026-01-20" }));
    assert.equal(running.measure.value, 19.5);
    assert.equal(running.metNow, false);
    assert.equal(running.status, "on-track");
    const closed = progressOf(g, inputs({ transactions: income, today: "2026-02-03", isClosed: () => true }));
    assert.equal(closed.metNow, true);
  });

  test("a share over the cap mid-year is behind, not lost — later income can bring it back", () => {
    const p = progressOf(
      goal({ metric: "spending", basis: "percent", target: 30 }),
      inputs({ transactions: income }),
    );
    assert.equal(p.status, "behind");
  });
});

describe("a percentage goal in dollars", () => {
  test("a goal set in dollars has no second reading", () => {
    const g = goal({ metric: "saved", basis: "amount" });
    const m = measure(g, inputs({ transactions: [txn("2026-01-31", "income", 4000, "Salary")] }));
    assert.equal(dollarsOf(g, m), null);
  });

  test("a share of income: what was saved, and the target at the income so far", () => {
    const g = goal({ metric: "saved", basis: "percent", target: 20 });
    const transactions = [
      txn("2026-01-31", "income", 5000, "Salary"),
      txn("2026-01-10", "expense", 4000),
    ];
    const d = dollarsOf(g, measure(g, inputs({ transactions })));
    assert.deepEqual(
      d && { amount: d.amount, target: d.target, base: d.base, noun: d.noun },
      { amount: 1000, target: 1000, base: 5000, noun: "income so far" },
    );
  });

  test("growth is on top of last December, not a part of it", () => {
    const g = goal({ metric: "netWorth", basis: "percent", target: 10 });
    const netWorth = [point("2025-12", 50000), point("2026-04", 53000)];
    const d = dollarsOf(g, measure(g, inputs({ netWorth })));
    assert.equal(d?.amount, 53000, "net worth as it stands");
    assert.equal(d?.target, 55000, "last December's, grown by ten percent");
    assert.equal(d?.lead, "from");
  });

  test("debt paid down is the dollars paid, against a share of what was owed", () => {
    const g = goal({ metric: "debt", basis: "percent", target: 50 });
    const netWorth = [
      point("2025-12", 0, { liabilities: 8000 }),
      point("2026-03", 0, { liabilities: 6000 }),
    ];
    const d = dollarsOf(g, measure(g, inputs({ netWorth })));
    assert.equal(d?.amount, 2000);
    assert.equal(d?.target, 4000);
  });

  test("a share of room is the contributions against the room", () => {
    const g = goal({ metric: "contribution", plan: "TFSA", basis: "percent", target: 100 });
    const d = dollarsOf(
      g,
      measure(
        g,
        inputs({
          transactions: [txn("2026-02-01", "transfer", 1500, "Transfer", { destinationAccountId: "tfsa" })],
          limits: { "2026": { TFSA: 6000 } },
        }),
      ),
    );
    assert.equal(d?.amount, 1500);
    assert.equal(d?.target, 6000);
  });

  test("a return in dollars is the market's part, and says it is approximate", () => {
    const port = (key: string, value: number) => ({ key, label: key, value, cost: 0 }) as PortfolioPoint;
    const g = goal({ metric: "portfolio", basis: "percent", target: 10 });
    const d = dollarsOf(
      g,
      measure(
        g,
        inputs({ portfolio: [port("2025-12", 10000), port("2026-01", 16000)], flowsByMonth: { "2026-01": 5000 } }),
      ),
    );
    assert.equal(d?.amount, 1000, "six thousand of rise, five of it deposited");
    assert.equal(d?.target, 1000);
    assert.equal(d?.approx, true);
  });
});

describe("contributions to every plan, or one", () => {
  const rrsp = { ...tfsa, id: "rrsp", name: "RRSP", registration: "RRSP" } as unknown as Account;
  const transactions = [
    txn("2026-02-01", "transfer", 3000, "Transfer", { destinationAccountId: "tfsa" }),
    txn("2026-03-01", "transfer", 2000, "Transfer", { destinationAccountId: "rrsp" }),
  ];

  test("no plan named is every plan", () => {
    const m = measure(
      goal({ metric: "contribution" }),
      inputs({ accounts: [tfsa, rrsp], transactions }),
    );
    assert.equal(m.value, 5000);
  });

  test("a share of room counts only the plans whose room was entered", () => {
    const m = measure(
      goal({ metric: "contribution", basis: "percent" }),
      inputs({ accounts: [tfsa, rrsp], transactions, limits: { "2026": { TFSA: 6000 } } }),
    );
    assert.equal(m.value, 50, "3000 of the TFSA's 6000; the RRSP has no room to measure against");
  });

  test("without any room there is nothing to take a share of", () => {
    const p = progressOf(
      goal({ metric: "contribution", basis: "percent", target: 100 }),
      inputs({ accounts: [tfsa], transactions }),
    );
    assert.equal(p.status, "no-data");
  });

  test("it reads as a sentence either way", () => {
    const fmt = (n: number) => `${n} dollars`;
    assert.equal(
      describeGoal(goal({ metric: "contribution", target: 7000 }), fmt),
      "Contribute 7000 dollars to registered plans in 2026",
    );
    assert.equal(
      describeGoal(goal({ metric: "contribution", plan: "TFSA", basis: "percent", target: 100 }), fmt),
      "Use 100% of the TFSA's room in 2026",
    );
  });
});

describe("met once, met for good", () => {
  test("a goal already stamped is met whatever the figure does after", () => {
    const p = progressOf(
      goal({ metric: "netWorth", target: 50000, metOn: "2026-03-31" }),
      inputs({ netWorth: [point("2026-05", 10000)] }),
    );
    assert.equal(p.status, "met");
    assert.equal(p.fraction, 1);
  });

  test("only goals never celebrated are newly met", () => {
    const netWorth = [point("2026-02", 70000)];
    const goals = [
      goal({ id: "a", metric: "netWorth", target: 50000 }),
      goal({ id: "b", metric: "netWorth", target: 50000, metOn: "2026-02-28" }),
      goal({ id: "c", metric: "netWorth", target: 90000 }),
    ];
    assert.deepEqual(newlyMet(goals, inputs({ netWorth })).map((g) => g.id), ["a"]);
  });

  test("a goal for a year not yet begun is upcoming", () => {
    const p = progressOf(goal({ year: "2027", by: "2027-12" }), inputs());
    assert.equal(p.status, "upcoming");
  });

  test("a sum goal past its month without reaching the target is missed", () => {
    const p = progressOf(goal({ by: "2026-03", target: 9000 }), inputs({ today: "2026-05-01" }));
    assert.equal(p.status, "missed");
  });
});

describe("a goal of your own", () => {
  const custom = (over: Partial<Goal> = {}) =>
    goal({ metric: "custom", title: "Write a will", target: 0, ...over });

  test("nothing measures it, so the record can never meet it", () => {
    const p = progressOf(custom(), inputs());
    assert.equal(p.metNow, false);
    assert.equal(p.status, "open");
    assert.deepEqual(newlyMet([custom()], inputs()), []);
  });

  test("checked off is met, for good", () => {
    assert.equal(progressOf(custom({ metOn: "2026-05-02" }), inputs()).status, "met");
  });

  test("a month passed without the tick is missed, and can still be ticked", () => {
    assert.equal(progressOf(custom({ by: "2026-03" }), inputs()).status, "missed");
    assert.equal(progressOf(custom({ by: "2026-03", metOn: "2026-06-01" }), inputs()).status, "met");
  });

  test("it reads as its own words", () => {
    assert.equal(describeGoal(custom({ by: "2026-06" }), String), "Write a will by the end of June");
  });

  test("stored without words, there is nothing to check off", () => {
    const kept = cleanGoals([custom({ id: "ok" }), custom({ id: "blank", title: "  " })]);
    assert.deepEqual(kept.map((g) => g.id), ["ok"]);
  });
});

describe("goals read back from storage", () => {
  test("malformed goals are dropped rather than trusted", () => {
    const clean = cleanGoals([
      goal({ id: "ok" }),
      { ...goal({ id: "bad-metric" }), metric: "vibes" },
      { ...goal({ id: "bad-target" }), target: "lots" },
      { ...goal({ id: "bad-year" }), year: "26" },
      null,
    ]);
    assert.deepEqual(clean.map((g) => g.id), ["ok"]);
  });

  test("a due month outside the goal's year falls back to December", () => {
    const [g] = cleanGoals([{ ...goal({}), by: "2031-04" }]);
    assert.equal(g.by, "2026-12");
  });

  test("goals stored before every goal had a basis read as their equivalent", () => {
    const [rate, giving] = cleanGoals([
      { id: "r", year: "2026", metric: "savingsRate", target: 20, by: "2026-12" },
      { id: "g", year: "2026", metric: "donations", basis: "income", target: 5, by: "2026-12" },
    ]);
    assert.equal(rate.metric, "saved");
    assert.equal(rate.basis, "percent");
    assert.equal(giving.basis, "percent");
  });

  test("a growth target may pass a hundred percent; a share may not", () => {
    const kept = cleanGoals([
      goal({ id: "growth", metric: "netWorth", basis: "percent", target: 150 }),
      goal({ id: "share", metric: "saved", basis: "percent", target: 150 }),
    ]);
    assert.deepEqual(kept.map((g) => g.id), ["growth"]);
  });

  test("not an array is no goals", () => {
    assert.deepEqual(cleanGoals({ goals: 3 }), []);
  });
});

describe("a goal reads as a sentence", () => {
  const fmt = (n: number) => `${n} dollars`;

  test("a year-long goal names the year", () => {
    assert.equal(describeGoal(goal({ metric: "saved", target: 500 }), fmt), "Save 500 dollars in 2026");
  });

  test("the year can be left to the page that already shows it", () => {
    assert.equal(describeGoal(goal({ metric: "saved", target: 500 }), fmt, { year: false }), "Save 500 dollars");
    assert.equal(
      describeGoal(goal({ metric: "saved", target: 500, by: "2026-06" }), fmt, { year: false }),
      "Save 500 dollars by the end of June",
      "a month other than December is still said",
    );
  });

  test("a contribution names the plan and the month it is due", () => {
    assert.equal(
      describeGoal(goal({ metric: "contribution", plan: "FHSA", target: 800, by: "2026-06" }), fmt),
      "Contribute 800 dollars to the FHSA by the end of June",
    );
  });

  test("a cap over part of the year runs through its month", () => {
    assert.equal(
      describeGoal(goal({ metric: "spending", category: "Dining", target: 300, by: "2026-04" }), fmt),
      "Keep Dining spending under 300 dollars through April",
    );
  });
});
