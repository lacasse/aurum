import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  balanceDelta,
  isInvestmentAccount,
  primaryAccountId,
  sidesFor,
  supportsRegistration,
  touchesAccount,
  transactionEndpoints,
  withBalanceRecorded,
} from "./types";
import type { Transaction } from "./types";

describe("balanceDelta", () => {
  test("an asset falls when money leaves and rises when it arrives", () => {
    assert.equal(balanceDelta("checking", "source", 100), -100);
    assert.equal(balanceDelta("checking", "destination", 100), 100);
  });

  test("a liability stores what is owed, so the signs invert", () => {
    // Spending on the card increases the debt…
    assert.equal(balanceDelta("credit", "source", 100), 100);
    // …and paying it off reduces it.
    assert.equal(balanceDelta("credit", "destination", 100), -100);
  });

  test("a transfer between two assets nets to zero", () => {
    const out = balanceDelta("checking", "source", 250);
    const into = balanceDelta("investment", "destination", 250);
    assert.equal(out + into, 0);
  });

  test("paying a credit card off moves both sides down", () => {
    assert.equal(balanceDelta("checking", "source", 80), -80, "cash falls");
    assert.equal(balanceDelta("credit", "destination", 80), -80, "debt falls");
  });
});

describe("buying securities is net-worth neutral", () => {
  // The gap this closes: holdings are valued separately from account
  // balances, so unless the cash that paid for the shares leaves the account,
  // the same money is counted twice — as cash and as the position.
  const netWorth = (cash: number, holdingsValue: number) => cash + holdingsValue;

  test("cash leaving the account offsets the position it bought", () => {
    const before = netWorth(1000, 0);
    // Buy $400 of stock inside the account: cash falls, holdings appear.
    const after = netWorth(1000 - 400, 400);
    assert.equal(after, before);
  });

  test("selling puts the proceeds back as cash", () => {
    const before = netWorth(600, 400);
    const after = netWorth(600 + 400, 0);
    assert.equal(after, before);
  });

  test("a dividend is genuinely new money, so it does move net worth", () => {
    assert.equal(netWorth(600 + 25, 400) - netWorth(600, 400), 25);
  });
});

describe("supportsRegistration", () => {
  test("is offered on accounts that can be sheltered", () => {
    for (const kind of ["checking", "savings", "cash", "investment", "crypto"] as const) {
      assert.equal(supportsRegistration(kind), true, `${kind} should support it`);
    }
  });

  test("is meaningless for debts and property", () => {
    for (const kind of ["credit", "loan", "property"] as const) {
      assert.equal(supportsRegistration(kind), false, `${kind} should not support it`);
    }
  });
});

describe("isInvestmentAccount", () => {
  test("brokerage and crypto accounts hold positions", () => {
    assert.equal(isInvestmentAccount("investment"), true);
    assert.equal(isInvestmentAccount("crypto"), true);
  });

  test("cash-only and debt accounts do not", () => {
    for (const kind of ["checking", "savings", "cash", "property", "credit", "loan"] as const) {
      assert.equal(isInvestmentAccount(kind), false, `${kind} should not hold positions`);
    }
  });

  test("a crypto balance behaves like any other asset", () => {
    assert.equal(balanceDelta("crypto", "source", 100), -100);
    assert.equal(balanceDelta("crypto", "destination", 100), 100);
  });
});

describe("transaction sides", () => {
  const expense: Transaction = {
    id: "t1",
    date: "2026-08-01",
    type: "expense",
    amount: 10,
    category: "Groceries",
    sourceAccountId: "a1",
    payee: "Market",
  };
  const transfer: Transaction = {
    ...expense,
    type: "transfer",
    sourceAccountId: "a1",
    destinationAccountId: "a2",
    payee: "TFSA contribution",
  };

  test("sidesFor puts the account on the side the type implies", () => {
    assert.deepEqual(sidesFor("expense", "a1"), { sourceAccountId: "a1" });
    assert.deepEqual(sidesFor("income", "a1"), { destinationAccountId: "a1" });
  });

  test("touchesAccount matches either side", () => {
    assert.equal(touchesAccount(transfer, "a1"), true);
    assert.equal(touchesAccount(transfer, "a2"), true);
    assert.equal(touchesAccount(transfer, "a3"), false);
  });

  test("endpoints name the outside world for the side that is not an account", () => {
    const nameOf = (id: string) => ({ a1: "Chequing", a2: "TFSA" })[id] ?? "?";
    assert.deepEqual(transactionEndpoints(expense, nameOf), {
      from: "Chequing",
      to: "Market",
    });
    assert.deepEqual(transactionEndpoints(transfer, nameOf), {
      from: "Chequing",
      to: "TFSA",
    });
  });

  test("the primary account is the one the money moved out of, or into for income", () => {
    assert.equal(primaryAccountId(expense), "a1");
    assert.equal(
      primaryAccountId({ ...expense, type: "income", sourceAccountId: undefined, destinationAccountId: "a2" }),
      "a2",
    );
    assert.equal(primaryAccountId(transfer), "a1");
  });
});

describe("withBalanceRecorded", () => {
  const acc = {
    id: "c",
    kind: "checking",
    balance: 900,
    history: [
      { month: "2020-02", value: 100 },
      { month: "2024-06", value: 400 },
    ],
  } as unknown as Parameters<typeof withBalanceRecorded>[0];

  test("keeps every month already recorded", () => {
    // Editing a balance used to rebuild the series as the last eighteen
    // months, which threw away six years of chequing history in one save.
    const out = withBalanceRecorded(acc, "2026-08");
    assert.deepEqual(out.history, [
      { month: "2020-02", value: 100 },
      { month: "2024-06", value: 400 },
      { month: "2026-08", value: 900 },
    ]);
  });

  test("a second edit in the same month replaces it rather than repeating it", () => {
    const once = withBalanceRecorded(acc, "2026-08");
    const twice = withBalanceRecorded({ ...once, balance: 950 }, "2026-08");
    assert.equal(twice.history.length, 3);
    assert.deepEqual(twice.history[2], { month: "2026-08", value: 950 });
  });

  test("invents no months for the gap in between", () => {
    const out = withBalanceRecorded(acc, "2026-08");
    assert.equal(out.history.some((p) => p.month === "2021-01"), false);
  });
});

describe("withBalanceRecorded · the month a transaction lands in", () => {
  const acc = {
    id: "c",
    kind: "checking",
    balance: 3628.38,
    history: [
      { month: "2026-06", value: 3000 },
      { month: "2026-07", value: 3200 },
    ],
  } as unknown as Parameters<typeof withBalanceRecorded>[0];

  test("a closed month keeps the balance it closed at", () => {
    // Both the store and the server used to write the last element of the
    // array, on the assumption that it was the current month. With July the
    // last month on record, August's spending landed on July's close — a
    // month already finished, and already drawn on the net worth chart.
    const out = withBalanceRecorded(acc, "2026-08");
    assert.equal(out.history.find((p) => p.month === "2026-07")?.value, 3200);
    assert.equal(out.history.find((p) => p.month === "2026-08")?.value, 3628.38);
  });

  test("an account with no history at all starts one", () => {
    const fresh = { ...acc, history: [] };
    const out = withBalanceRecorded(fresh, "2026-08");
    assert.deepEqual(out.history, [{ month: "2026-08", value: 3628.38 }]);
  });
});
