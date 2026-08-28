import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  accountSchema,
  budgetSchema,
  formatIssues,
  holdingSchema,
  loginSchema,
  deleteDemoSchema,
  merchantRuleSchema,
  snapshotSchema,
  transactionSchema,
} from "./schemas";

/** Parse, asserting success, and return the parsed value. */
function ok<T>(result: { success: true; data: T } | { success: false; error: unknown }): T {
  assert.equal(result.success, true, `expected parse to succeed: ${JSON.stringify(result)}`);
  return (result as { success: true; data: T }).data;
}

describe("transactionSchema", () => {
  const valid = {
    id: "t1",
    date: "2026-08-01",
    type: "expense",
    amount: 12.34,
    category: "Groceries",
    accountId: "a1",
    payee: "  Market  ",
  };

  test("accepts a well-formed transaction and trims the payee", () => {
    const t = ok(transactionSchema.safeParse(valid));
    assert.equal(t.payee, "Market");
    assert.equal(t.amount, 12.34);
    assert.equal(t.note, undefined);
  });

  test("coerces numeric strings, as the old hand-rolled parser did", () => {
    assert.equal(ok(transactionSchema.safeParse({ ...valid, amount: "12.34" })).amount, 12.34);
  });

  test("rounds the amount to whole cents", () => {
    assert.equal(ok(transactionSchema.safeParse({ ...valid, amount: 1.005 })).amount, 1.01);
  });

  test("rejects a non-positive or non-finite amount", () => {
    for (const amount of [0, -1, "abc", null, undefined, Infinity]) {
      assert.equal(
        transactionSchema.safeParse({ ...valid, amount }).success,
        false,
        `amount ${String(amount)} should be rejected`,
      );
    }
  });

  test("rejects a malformed date and an unknown type", () => {
    assert.equal(transactionSchema.safeParse({ ...valid, date: "01/08/2026" }).success, false);
    assert.equal(transactionSchema.safeParse({ ...valid, date: "2026-8-1" }).success, false);
    assert.equal(transactionSchema.safeParse({ ...valid, type: "transfer" }).success, false);
  });

  test("rejects a missing or blank id", () => {
    assert.equal(transactionSchema.safeParse({ ...valid, id: "" }).success, false);
    const noId: Partial<typeof valid> = { ...valid };
    delete noId.id;
    assert.equal(transactionSchema.safeParse(noId).success, false);
  });

  test("defaults category and accountId rather than failing", () => {
    const t = ok(transactionSchema.safeParse({ ...valid, category: undefined, accountId: null }));
    assert.equal(t.category, "Other");
    assert.equal(t.accountId, "");
  });

  test("keeps a non-blank note and drops a blank or non-string one", () => {
    assert.equal(ok(transactionSchema.safeParse({ ...valid, note: "  hi  " })).note, "hi");
    assert.equal(ok(transactionSchema.safeParse({ ...valid, note: "   " })).note, undefined);
    assert.equal(ok(transactionSchema.safeParse({ ...valid, note: 42 })).note, undefined);
  });

  test("strips unknown keys instead of persisting them", () => {
    const t = ok(transactionSchema.safeParse({ ...valid, sneaky: "value" }));
    assert.equal("sneaky" in t, false);
  });
});

describe("accountSchema", () => {
  const valid = { id: "a1", name: "Chequing", kind: "checking", balance: 100 };

  test("accepts a well-formed account", () => {
    const a = ok(accountSchema.safeParse(valid));
    assert.equal(a.name, "Chequing");
    assert.equal(a.institution, "—");
    assert.equal(a.kind, "checking");
    assert.deepEqual(a.history, []);
  });

  test("requires a non-blank name", () => {
    assert.equal(accountSchema.safeParse({ ...valid, name: "   " }).success, false);
    assert.equal(accountSchema.safeParse({ ...valid, name: 42 }).success, false);
  });

  test("rejects an unknown account kind (previously cast unchecked)", () => {
    assert.equal(accountSchema.safeParse({ ...valid, kind: "crypto-wallet" }).success, false);
    assert.equal(ok(accountSchema.safeParse({ ...valid, kind: undefined })).kind, "checking");
  });

  test("falls back to a zero balance rather than rejecting", () => {
    assert.equal(ok(accountSchema.safeParse({ ...valid, balance: "nope" })).balance, 0);
    assert.equal(ok(accountSchema.safeParse({ ...valid, balance: undefined })).balance, 0);
  });

  test("rounds the balance to whole cents", () => {
    assert.equal(ok(accountSchema.safeParse({ ...valid, balance: 1.005 })).balance, 1.01);
  });

  test("validates history entries and discards a malformed history", () => {
    const good = ok(
      accountSchema.safeParse({ ...valid, history: [{ month: "2026-08", value: 10 }] }),
    );
    assert.deepEqual(good.history, [{ month: "2026-08", value: 10 }]);
    assert.deepEqual(ok(accountSchema.safeParse({ ...valid, history: "nope" })).history, []);
    assert.deepEqual(
      ok(accountSchema.safeParse({ ...valid, history: [{ month: "August", value: 10 }] })).history,
      [],
    );
  });
});

describe("holdingSchema", () => {
  const valid = {
    id: "h1",
    ticker: "  vfv  ",
    shares: 10,
    avgCost: 100,
    price: 120,
    currency: "USD",
  };

  test("uppercases the ticker and applies cross-field defaults", () => {
    const h = ok(holdingSchema.safeParse(valid));
    assert.equal(h.ticker, "VFV");
    assert.equal(h.name, "vfv", "name falls back to the ticker");
    assert.equal(h.assetClass, "US Equity");
    assert.equal(h.sector, "US Equity", "sector falls back to the asset class");
    assert.equal(h.accountType, "non-registered");
    assert.equal(h.priceCAD, 120, "CAD price falls back to the listing price");
    assert.equal(h.avgCostCAD, 100);
    assert.equal(h.dividendsReceived, 0);
    assert.deepEqual(h.historyCAD, h.history);
  });

  test("rejects non-positive shares, cost and price", () => {
    for (const field of ["shares", "avgCost", "price"] as const) {
      assert.equal(
        holdingSchema.safeParse({ ...valid, [field]: 0 }).success,
        false,
        `${field} = 0 should be rejected`,
      );
      assert.equal(holdingSchema.safeParse({ ...valid, [field]: -1 }).success, false);
    }
  });

  test("rejects unknown enum values (previously cast unchecked)", () => {
    assert.equal(holdingSchema.safeParse({ ...valid, currency: "EUR" }).success, false);
    assert.equal(holdingSchema.safeParse({ ...valid, assetClass: "Commodities" }).success, false);
    assert.equal(holdingSchema.safeParse({ ...valid, accountType: "RESP" }).success, false);
  });

  test("clamps negative dividends to zero", () => {
    assert.equal(ok(holdingSchema.safeParse({ ...valid, dividendsReceived: -5 })).dividendsReceived, 0);
  });

  test("preserves an explicit CAD history", () => {
    const h = ok(holdingSchema.safeParse({ ...valid, history: [1, 2], historyCAD: [3, 4] }));
    assert.deepEqual(h.history, [1, 2]);
    assert.deepEqual(h.historyCAD, [3, 4]);
  });
});

describe("snapshotSchema", () => {
  const valid = {
    month: "2026-08",
    holdingId: "h1",
    ticker: "vfv",
    price: 120,
    avgCost: 100,
    shares: 10,
    value: 1200,
  };

  test("accepts a valid snapshot and defaults valueCAD", () => {
    const s = ok(snapshotSchema.safeParse(valid));
    assert.equal(s.ticker, "VFV");
    assert.equal(s.valueCAD, 1200);
  });

  test("rejects a malformed month", () => {
    assert.equal(snapshotSchema.safeParse({ ...valid, month: "2026-08-01" }).success, false);
    assert.equal(snapshotSchema.safeParse({ ...valid, month: "Aug 2026" }).success, false);
  });

  test("allows a zero or negative value but not a non-finite one", () => {
    assert.equal(ok(snapshotSchema.safeParse({ ...valid, value: 0 })).value, 0);
    assert.equal(snapshotSchema.safeParse({ ...valid, value: "abc" }).success, false);
  });
});

describe("smaller route bodies", () => {
  test("budgetSchema requires a positive limit", () => {
    assert.equal(ok(budgetSchema.safeParse({ category: " Food ", limit: "50.5" })).limit, 50.5);
    assert.equal(ok(budgetSchema.safeParse({ category: " Food ", limit: 50 })).category, "Food");
    assert.equal(budgetSchema.safeParse({ category: "Food", limit: 0 }).success, false);
    assert.equal(budgetSchema.safeParse({ category: "", limit: 10 }).success, false);
  });

  test("merchantRuleSchema lowercases the merchant", () => {
    const r = ok(merchantRuleSchema.safeParse({ merchant: "  AMZN Mktp  ", category: " Shopping " }));
    assert.equal(r.merchant, "amzn mktp");
    assert.equal(r.category, "Shopping");
  });

  test("deleteDemoSchema demands the exact confirmation phrase", () => {
    assert.equal(deleteDemoSchema.safeParse({ confirm: "DELETE" }).success, true);
    assert.equal(deleteDemoSchema.safeParse({ confirm: "delete" }).success, false);
    assert.equal(deleteDemoSchema.safeParse({}).success, false);
  });

  test("loginSchema requires both fields to be non-blank", () => {
    assert.equal(loginSchema.safeParse({ username: "a", password: "b" }).success, true);
    assert.equal(loginSchema.safeParse({ username: "  ", password: "b" }).success, false);
    assert.equal(loginSchema.safeParse({ username: "a" }).success, false);
  });
});

describe("formatIssues", () => {
  test("renders field paths and reasons on one line", () => {
    const result = transactionSchema.safeParse({ id: "", date: "nope", type: "x", amount: -1 });
    assert.equal(result.success, false);
    const message = formatIssues(result.error!);
    assert.match(message, /date/);
    assert.match(message, /amount/);
    assert.equal(message.includes("\n"), false);
  });
});
