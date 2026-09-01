import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { INCOME_CATEGORIES } from "./types";
import {
  detectSignConvention,
  detectFormat,
  rowsFromRecords,
  suggestCategory,
} from "./csv";

describe("detectFormat", () => {
  test("knows a card statement by its columns", () => {
    assert.equal(
      detectFormat(["transaction_date", "merchant", "amount", "category"]),
      "simple",
    );
  });

  test("says nothing rather than guessing at unknown columns", () => {
    assert.equal(detectFormat(["effective_date", "activity_type"]), null);
  });
});

describe("suggestCategory", () => {
  /** The app's own names, as shipped. */
  const stock = ["Housing", "Groceries", "Dining", "Transport", "Shopping", "Other"];
  /** The same list after the user renamed one of them. */
  const renamed = [
    "Housing",
    "Groceries",
    "Drinks & Dining",
    "Transport",
    "Shopping",
    "Other",
  ];

  const suggest = (payee: string, csvCategory: string, allowed: readonly string[]) =>
    suggestCategory(payee, csvCategory, "", csvCategory, "expense", {}, allowed);

  test("translates the issuer's vocabulary into the app's", () => {
    assert.equal(suggest("Chipotle Online", "Restaurants", stock).category, "Dining");
    assert.equal(
      suggest("Petro-Canada", "Gas, parking, and tolls", stock).category,
      "Transport",
    );
    assert.equal(suggest("Uniqlo", "Clothing", stock).category, "Shopping");
  });

  test("still finds the category after the user renames it", () => {
    // Renaming "Dining" to "Drinks & Dining" used to switch off every rule
    // that named it, and a statement full of restaurants arrived as Other.
    const s = suggest("Chipotle Online", "Restaurants", renamed);
    assert.equal(s.category, "Drinks & Dining");
    assert.equal(s.confident, true);
  });

  test("keyword rules survive a rename too", () => {
    // No category column at all: the merchant name is all there is to go on,
    // and the rule that recognises it names a category the user has renamed.
    const s = suggestCategory("Starbucks #123", "", "", undefined, "expense", {}, renamed);
    assert.equal(s.category, "Drinks & Dining");
  });

  test("knows the shops on a Canadian statement", () => {
    const canadian = [...stock, "Household", "Dog"];
    const by = (payee: string) =>
      suggestCategory(payee, "", "", undefined, "expense", {}, canadian).category;
    assert.equal(by("Food Basics 663"), "Groceries");
    assert.equal(by("Marsha's Yig 7971"), "Groceries");
    assert.equal(by("Tim Hortons #482"), "Dining");
    assert.equal(by("Petro-Canada 10565"), "Transport");
    assert.equal(by("Canadian Tire #422"), "Household");
    assert.equal(by("Pet Valu #2316"), "Dog");
  });

  test("what the user taught beats what the file says", () => {
    const s = suggestCategory(
      "Mossy Earth",
      "Other personal",
      "",
      "Other personal",
      "expense",
      { "mossy earth": "Donations" },
      [...stock, "Donations"],
    );
    assert.equal(s.category, "Donations");
    assert.equal(s.confident, true);
  });

  test("a merchant nothing recognises is Other, and says it is unsure", () => {
    const s = suggestCategory(
      "Sq *Golden Egg Studio",
      "",
      "",
      undefined,
      "expense",
      {},
      stock,
    );
    assert.equal(s.category, "Other");
    assert.equal(s.confident, false, "an unsure guess is flagged for review");
  });
});


describe("detectSignConvention", () => {
  test("a labelled debit fixes the file at negative-is-out", () => {
    const c = detectSignConvention([
      { amount: -40, stated: "expense" },
      { amount: -12, stated: "expense" },
      { amount: 900, stated: null },
    ]);
    assert.equal(c.outflow, "negative");
    assert.equal(c.basis, "type-column");
  });

  test("a card statement's labelled charges fix it the other way", () => {
    const c = detectSignConvention([
      { amount: 40, stated: "expense" },
      { amount: 12, stated: "expense" },
      { amount: -300, stated: null },
    ]);
    assert.equal(c.outflow, "positive");
    assert.equal(c.basis, "type-column");
  });

  test("a labelled credit is evidence about the sign it does not carry", () => {
    const c = detectSignConvention([
      { amount: -55, stated: "income" },
      { amount: -60, stated: "income" },
    ]);
    assert.equal(c.outflow, "positive");
    assert.equal(c.basis, "type-column");
  });

  test("one labelled row is not enough to invert a file", () => {
    const c = detectSignConvention([
      { amount: -19, stated: "income" },
      { amount: -40, stated: null },
      { amount: -12, stated: null },
      { amount: 2000, stated: null },
    ]);
    assert.equal(c.basis, "majority");
    assert.equal(c.outflow, "negative");
  });

  test("labels that contradict each other settle nothing", () => {
    const c = detectSignConvention([
      { amount: -40, stated: "expense" },
      { amount: 40, stated: "expense" },
      { amount: -12, stated: null },
      { amount: -9, stated: null },
    ]);
    assert.equal(c.basis, "majority");
  });

  test("without labels, the sign most rows carry is the spending one", () => {
    const c = detectSignConvention([
      { amount: 40, stated: null },
      { amount: 12, stated: null },
      { amount: 9, stated: null },
      { amount: -500, stated: null },
    ]);
    assert.equal(c.outflow, "positive");
    assert.equal(c.basis, "majority");
    assert.equal(c.agreed, 3);
    assert.equal(c.disagreed, 1);
  });

  test("a file of one sign is read as a statement of spending", () => {
    const c = detectSignConvention([
      { amount: 40, stated: null },
      { amount: 12, stated: null },
    ]);
    assert.equal(c.outflow, "positive");
    assert.equal(c.basis, "unsigned");
  });

  test("an all-negative file is read the same way", () => {
    const c = detectSignConvention([
      { amount: -40, stated: null },
      { amount: -12, stated: null },
    ]);
    assert.equal(c.outflow, "negative");
    assert.equal(c.basis, "unsigned");
  });
});

describe("reading a file's signs end to end", () => {
  const parse = (records: Record<string, string>[]) =>
    rowsFromRecords("f.csv", "simple", records, new Set(), {});

  const row = (
    date: string,
    merchant: string,
    amount: string,
    type = "",
  ): Record<string, string> => ({
    transaction_date: date,
    merchant,
    amount,
    transaction_type: type,
  });

  test("a chequing export: negative is spending", () => {
    const { rows, signs } = parse([
      row("2026-01-03", "Loblaws", "-84.20"),
      row("2026-01-05", "Tim Hortons", "-4.15"),
      row("2026-01-15", "Employer Payroll", "3200.00"),
    ]);
    assert.equal(signs?.outflow, "negative");
    assert.deepEqual(
      rows.map((r) => r.type),
      ["expense", "expense", "income"],
    );
    assert.ok(rows.every((r) => r.amount > 0));
  });

  test("a card export with the same merchants signed the other way", () => {
    const { rows, signs } = parse([
      row("2026-01-03", "Loblaws", "84.20"),
      row("2026-01-05", "Tim Hortons", "4.15"),
      row("2026-01-20", "Returned item", "-30.00"),
    ]);
    assert.equal(signs?.outflow, "positive");
    assert.deepEqual(
      rows.map((r) => r.type),
      ["expense", "expense", "income"],
    );
  });

  test("the file's own labels beat its signs", () => {
    // A statement of positive charges with one row explicitly called a credit.
    const { rows } = parse([
      row("2026-01-03", "Loblaws", "84.20", "debit"),
      row("2026-01-05", "Tim Hortons", "4.15", "debit"),
      row("2026-01-20", "Refund", "30.00", "credit"),
    ]);
    assert.deepEqual(
      rows.map((r) => r.type),
      ["expense", "expense", "income"],
    );
    assert.ok(rows.every((r) => r.explicitType));
  });

  test("an unlabelled row follows the convention the labelled ones set", () => {
    const { rows } = parse([
      row("2026-01-03", "Loblaws", "84.20", "debit"),
      row("2026-01-05", "Esso", "60.00", "debit"),
      row("2026-01-09", "Netflix", "18.00"),
    ]);
    assert.equal(rows[2].type, "expense");
    assert.equal(rows[2].explicitType, false);
  });

  test("amounts stay positive whichever way the file signed them", () => {
    const a = parse([row("2026-01-03", "Esso", "-60.00"), row("2026-01-04", "Esso", "-20.00")]);
    const b = parse([row("2026-01-03", "Esso", "60.00"), row("2026-01-04", "Esso", "20.00")]);
    assert.deepEqual(
      a.rows.map((r) => r.amount),
      b.rows.map((r) => r.amount),
    );
    assert.deepEqual(
      a.rows.map((r) => r.type),
      b.rows.map((r) => r.type),
    );
  });

  test("an empty file has no convention to report", () => {
    assert.equal(parse([]).signs, null);
  });
});


describe("income categories", () => {
  /** What the Budgets page manages: expense categories, and only those. */
  const userExpenseCategories = [
    "Housing",
    "Groceries",
    "Drinks & Dining",
    "Transport",
    "Dog",
    "Other",
  ];

  const forIncome = (payee: string, csvCategory?: string) =>
    suggestCategory(payee, "", "", csvCategory, "income", {}, userExpenseCategories)
      .category;

  test("payroll is salary, not the expense list's fallback", () => {
    assert.equal(forIncome("EMPLOYER PAYROLL DEP"), "Salary");
  });

  test("the user's expense categories are never offered to an income row", () => {
    // "Dog" would be reachable through the expense rules; it must not be.
    assert.equal(forIncome("PETSMART REFUND"), "Refund");
  });

  test("interest and dividends land where the dashboard expects them", () => {
    assert.equal(forIncome("Interest paid"), "Interest");
    assert.equal(forIncome("XEQT Dividend"), "Dividends");
  });

  test("a pension contribution is not spendable income, and is named so", () => {
    assert.equal(forIncome("Pension contribution"), "RSP / Pension");
  });

  test("borrowing is named as borrowing", () => {
    assert.equal(forIncome("Loan advance"), "Loan Proceeds");
  });

  test("an income row with nothing to go on falls back inside the income list", () => {
    const c = forIncome("ZZZ 4471");
    assert.ok(INCOME_CATEGORIES.includes(c as (typeof INCOME_CATEGORIES)[number]));
  });

  test("expense rows still use the user's own categories", () => {
    assert.equal(
      suggestCategory("Loblaws", "", "", undefined, "expense", {}, userExpenseCategories)
        .category,
      "Groceries",
    );
  });

  test("a taught merchant rule still wins for income", () => {
    assert.equal(
      suggestCategory(
        "Acme Corp",
        "",
        "",
        undefined,
        "income",
        { "acme corp": "Freelance" },
        userExpenseCategories,
      ).category,
      "Freelance",
    );
  });
});

describe("debit and credit columns", () => {
  test("recognised by the pair, whatever the bank calls them", () => {
    assert.equal(
      detectFormat(["Date", "Description", "Debit", "Credit", "Balance"]),
      "debit-credit",
    );
    assert.equal(
      detectFormat(["Posting Date", "Details", "Withdrawal", "Deposit"]),
      "debit-credit",
    );
    assert.equal(
      detectFormat(["Transaction Date", "Narrative", "Money Out", "Money In"]),
      "debit-credit",
    );
  });

  test("one column of the pair is not the pair", () => {
    assert.equal(detectFormat(["Date", "Description", "Debit", "Balance"]), null);
  });

  test("named columns beat a signed amount column in the same file", () => {
    assert.equal(
      detectFormat(["transaction_date", "merchant", "amount", "debit", "credit"]),
      "debit-credit",
    );
  });

  const parse = (records: Record<string, string>[]) =>
    rowsFromRecords("bank.csv", "debit-credit", records, new Set(), {});

  const row = (
    date: string,
    description: string,
    debit = "",
    credit = "",
  ): Record<string, string> => ({ Date: date, Description: description, Debit: debit, Credit: credit });

  test("the column a figure sits in is the direction", () => {
    const { rows } = parse([
      row("2026-01-03", "LOBLAWS", "84.20"),
      row("2026-01-15", "EMPLOYER PAYROLL", "", "3200.00"),
    ]);
    assert.deepEqual(
      rows.map((r) => r.type),
      ["expense", "income"],
    );
    assert.deepEqual(
      rows.map((r) => r.amount),
      [84.2, 3200],
    );
    assert.ok(rows.every((r) => r.explicitType));
  });

  test("a bank that signs its debit column changes nothing", () => {
    const { rows } = parse([
      row("2026-01-03", "LOBLAWS", "-84.20"),
      row("2026-01-15", "EMPLOYER PAYROLL", "", "3200.00"),
    ]);
    assert.deepEqual(
      rows.map((r) => r.type),
      ["expense", "income"],
    );
    assert.equal(rows[0].amount, 84.2);
  });

  test("nothing is inferred from signs when the columns say it outright", () => {
    const { signs } = parse([row("2026-01-03", "LOBLAWS", "84.20")]);
    assert.equal(signs?.basis, "columns");
  });

  test("a row with neither column filled is not a transaction", () => {
    const { rows, skippedInvalid } = parse([
      row("2026-01-01", "Opening balance"),
      row("2026-01-03", "LOBLAWS", "84.20"),
    ]);
    assert.equal(rows.length, 1);
    assert.equal(skippedInvalid, 1);
  });

  test("both columns filled is netted rather than double counted", () => {
    const { rows } = parse([row("2026-01-03", "Correction", "100.00", "30.00")]);
    assert.equal(rows[0].amount, 70);
    assert.equal(rows[0].type, "expense");
  });

  test("headers are matched whatever their casing", () => {
    const { rows } = parse([
      {
        " DATE ": "2026-02-01",
        "description": "ESSO",
        "WITHDRAWAL AMOUNT": "60.00",
        "deposit amount": "",
      },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].type, "expense");
    assert.equal(rows[0].amount, 60);
  });

  test("a deposit is categorised out of the income list", () => {
    const { rows } = parse([row("2026-01-15", "EMPLOYER PAYROLL", "", "3200.00")]);
    assert.equal(rows[0].category, "Salary");
  });

  test("a row with no description still imports", () => {
    const { rows } = parse([row("2026-01-03", "", "12.00")]);
    assert.equal(rows[0].payee, "Unknown merchant");
  });
});
