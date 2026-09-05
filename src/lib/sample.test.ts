import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { generateSampleData, generateSampleSnapshots } from "./sample";
import { allTrades, replayFlows } from "./flows";
import { isIncome } from "./analytics";
import { todayISO } from "./format";

/*
 * The sample exists to show the app working, so what these check is coverage:
 * that every page has something to draw. A generator that quietly stops
 * producing trades, or drops the pension account, leaves whole features
 * looking broken to anyone seeing them for the first time — and nothing else
 * would catch it, because the app is perfectly correct about having nothing to
 * show.
 */
const data = generateSampleData();

describe("sample accounts", () => {
  test("covers every kind the app draws differently", () => {
    const kinds = new Set(data.accounts.map((a) => a.kind));
    for (const kind of ["checking", "savings", "investment", "credit", "loan", "property", "pension"]) {
      assert.ok(kinds.has(kind as never), `no ${kind} account`);
    }
  });

  test("the pension carries the figures its card reads", () => {
    const p = data.accounts.find((a) => a.kind === "pension");
    assert.ok(p);
    assert.ok((p.pensionAnnual ?? 0) > 0);
    assert.ok((p.pensionService ?? 0) > 0);
  });

  test("something holds US cash, so a combined balance has two sides", () => {
    assert.ok(data.accounts.some((a) => (a.balanceUSD ?? 0) > 0));
  });
});

describe("sample holdings", () => {
  test("every position carries the trades it was built from", () => {
    for (const h of data.holdings) {
      assert.ok(h.flows.length > 0, `${h.ticker} has no trade history`);
    }
  });

  test("the position agrees with its own trades", () => {
    for (const h of data.holdings) {
      const replayed = replayFlows(h.flows);
      assert.equal(replayed.shares, h.shares, `${h.ticker} share count`);
      assert.equal(replayed.avgCost, h.avgCostCAD, `${h.ticker} cost base`);
    }
  });

  test("no trade is dated in the future", () => {
    const today = todayISO();
    for (const t of allTrades(data.holdings)) {
      assert.ok(t.date <= today, `${t.ticker} ${t.kind} dated ${t.date}`);
    }
  });

  test("buys, sells and dividends are all represented", () => {
    const kinds = new Set(allTrades(data.holdings).map((t) => t.kind));
    assert.deepEqual([...kinds].sort(), ["buy", "dividend", "sell"]);
  });

  test("one position is closed and one open position has a realized gain", () => {
    const closed = data.holdings.filter((h) => h.shares === 0);
    assert.equal(closed.length, 1);
    const trimmed = data.holdings.filter(
      (h) => h.shares > 0 && h.flows.some((f) => f.kind === "sell"),
    );
    assert.ok(trimmed.length > 0, "nothing was sold out of a position still held");
  });

  test("every asset class the app knows about is held", () => {
    const classes = new Set(data.holdings.map((h) => h.assetClass));
    for (const c of ["US Equity", "Intl Equity", "Bonds", "Crypto"]) {
      assert.ok(classes.has(c as never), `no ${c} position`);
    }
  });
});

describe("sample snapshots", () => {
  const snaps = generateSampleSnapshots(data.holdings);

  test("the portfolio has a recorded value in most months", () => {
    assert.ok(new Set(snaps.map((s) => s.month)).size >= 12);
  });

  test("a snapshot never records a position nobody held", () => {
    for (const s of snaps) assert.ok(s.shares > 0);
  });

  test("value follows from shares and the price of the month", () => {
    for (const s of snaps) {
      assert.ok(Math.abs(s.value - s.shares * s.price) < 0.02, s.ticker);
    }
  });
});

describe("sample transactions", () => {
  test("income is more than a salary", () => {
    const cats = new Set(
      data.transactions.filter((t) => t.type === "income").map((t) => t.category),
    );
    for (const c of ["Salary", "RSP / Pension", "Refund", "Loan Proceeds"]) {
      assert.ok(cats.has(c), `no ${c} income`);
    }
  });

  test("borrowed money is recorded, and is not counted as income", () => {
    const loan = data.transactions.filter((t) => t.category === "Loan Proceeds");
    assert.ok(loan.length > 0);
    for (const t of loan) assert.equal(isIncome(t), false);
  });

  test("debt repayment and transfers are both present", () => {
    assert.ok(data.transactions.some((t) => t.category === "Debt Repayment"));
    assert.ok(data.transactions.some((t) => t.type === "transfer"));
  });

  test("every transfer names both of its ends", () => {
    for (const t of data.transactions.filter((t) => t.type === "transfer")) {
      assert.ok(t.sourceAccountId && t.destinationAccountId, t.payee);
    }
  });

  test("every transaction names an account that exists", () => {
    const ids = new Set(data.accounts.map((a) => a.id));
    for (const t of data.transactions) {
      for (const id of [t.sourceAccountId, t.destinationAccountId]) {
        if (id) assert.ok(ids.has(id), `${t.payee} names ${id}`);
      }
    }
  });
});

describe("sample recurring rules", () => {
  test("the recurring card has rules to show", () => {
    assert.ok(data.recurring.length > 0);
  });

  test("nothing posts itself the moment the sample loads", () => {
    const today = todayISO();
    for (const r of data.recurring) {
      assert.ok(r.nextDate > today, `${r.payee} is already due`);
    }
  });
});
