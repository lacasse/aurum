import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { INCOME_CATEGORIES } from "./types";
import {
  CARD_PAYMENT_PAYEE,
  cashRowSides,
  detectSignConvention,
  chooseCategory,
  chooseDebt,
  detectFormat,
  nameFromHistory,
  reconcileCardPayments,
  rowsFromRecords,
  suggestCategory,
  type ImportedRow,
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
    const s = suggestCategory("Starbucks #200", "", "", undefined, "expense", {}, renamed);
    assert.equal(s.category, "Drinks & Dining");
  });

  /*
   * The chain names are the product's own matching vocabulary and have to be
   * real. The branch numbers are round and invented on purpose: which outlet
   * someone shops at, on which day, is a fact about them, and these were
   * originally retyped off a statement.
   */
  test("knows the shops on a Canadian statement", () => {
    const canadian = [...stock, "Household", "Dog"];
    const by = (payee: string) =>
      suggestCategory(payee, "", "", undefined, "expense", {}, canadian).category;
    assert.equal(by("Food Basics 1100"), "Groceries");
    assert.equal(by("Yig 1000"), "Groceries");
    assert.equal(by("Tim Hortons #400"), "Dining");
    assert.equal(by("Petro-Canada 2000"), "Transport");
    assert.equal(by("Canadian Tire #300"), "Household");
    assert.equal(by("Pet Valu #500"), "Dog");
  });

  test("what the user taught beats what the file says", () => {
    const s = suggestCategory(
      "Rewild Fund",
      "Other personal",
      "",
      "Other personal",
      "expense",
      { "rewild fund": "Donations" },
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

/*
 * A statement line saying only "pension", on money arriving, is far more
 * likely to be the plan paying than the plan being paid — and the two must not
 * share a category, because the contribution category is what estimates the
 * plan's value.
 */
describe("paying into a pension against being paid by one", () => {
  const forIncome = (payee: string) =>
    suggestCategory(payee, "", "", undefined, "income", {}, [
      "Salary",
      "Other",
      "RSP / Pension",
      "Pension Income",
    ]).category;

  test("a contribution is filed as one", () => {
    assert.equal(forIncome("Pension contribution"), "RSP / Pension");
    assert.equal(forIncome("Employer match"), "RSP / Pension");
    assert.equal(forIncome("Employer contribution"), "RSP / Pension");
  });

  test("a payment from the plan is filed as income", () => {
    assert.equal(forIncome("Pension payment"), "Pension Income");
    assert.equal(forIncome("Annuity deposit"), "Pension Income");
  });

  /*
   * "employer" alone used to be a salary word, so an employer match — which is
   * a pension contribution — was filed as pay. Salary is recognised by plenty
   * of less ambiguous words.
   */
  test("an employer match is a contribution, not wages", () => {
    assert.equal(forIncome("Payroll deposit"), "Salary");
    assert.equal(forIncome("Net pay"), "Salary");
    assert.notEqual(forIncome("Employer match"), "Salary");
  });

  test("a bare mention on arriving money reads as the plan paying", () => {
    assert.equal(forIncome("Pension"), "Pension Income");
  });
});

/* ALL-FIXTURES-INVENTED */
describe("card payments", () => {
  const read = (format: "simple" | "amex", records: Record<string, string>[]) =>
    rowsFromRecords("card.csv", format, records, new Set(), {}).rows;

  test("a payment line becomes a transfer, not something dropped", () => {
    const rows = read("simple", [
      { transaction_date: "2026-09-08", transaction_type: "Payment", merchant: "", amount: "300.00" },
      { transaction_date: "2026-09-09", transaction_type: "Purchase", merchant: "Corner Cafe", amount: "-12.00" },
    ]);
    assert.deepEqual(
      rows.map((r) => [r.payee, r.type, r.amount]),
      [[CARD_PAYMENT_PAYEE, "transfer", 300], ["Corner Cafe", "expense", 12]],
    );
  });

  test("a statement that lists the payment among purchases is read by its name", () => {
    const rows = read("amex", [
      { Date: "2026-09-08", "Activity Type": "TRANS", "Merchant Name": "AUTO PAYMENT-THANK-YOU", Amount: "-$80.00" },
      { Date: "2026-09-10", "Activity Type": "TRANS", "Merchant Name": "FUEL STOP 12", Amount: "$40.00" },
    ]);
    assert.equal(rows[0].type, "transfer");
    assert.equal(rows[1].type, "expense", "the payment does not decide which way the purchases go");
  });

  const row = (over: Partial<ImportedRow>): ImportedRow => ({
    id: "r", date: "2026-09-08", payee: CARD_PAYMENT_PAYEE, amount: 300, type: "transfer",
    sourceFile: "card.csv", category: "Transfer", suggestedCategory: "Transfer",
    confident: true, include: true, dup: false, explicitType: true, ...over,
  });
  const accounts = [
    { id: "chq", kind: "checking" as const },
    { id: "card", kind: "credit" as const },
  ];
  const everyday = (r: ImportedRow) => r.accountHint === "chequing";

  test("the bank's line for the same payment is not saved as spending too", () => {
    const out = reconcileCardPayments(
      [
        row({ id: "pay" }),
        row({ id: "pad", type: "expense", payee: "Pre-authorized Debit", date: "2026-09-09", sourceFile: "bank.csv", accountHint: "chequing" }),
        row({ id: "other", type: "expense", payee: "Corner Cafe", amount: 12, sourceFile: "bank.csv", accountHint: "chequing" }),
      ],
      [],
      accounts,
      everyday,
    );
    const by = Object.fromEntries(out.map((r) => [r.id, r]));
    assert.equal(by.pay.include, true);
    assert.equal(by.pad.include, false);
    assert.equal(by.pad.paysCard, true, "labelled as the payment's other side");
    assert.equal(by.pad.dup, false, "not as a duplicate, which it is not");
    assert.equal(by.other.include, true);
  });

  test("a purchase on another card of the same amount is left alone", () => {
    const out = reconcileCardPayments(
      [row({ id: "pay" }), row({ id: "buy", type: "expense", payee: "Big Store", sourceFile: "card2.csv" })],
      [],
      accounts,
      everyday,
    );
    assert.equal(out.find((r) => r.id === "buy")?.include, true);
  });

  test("a payment already stored as a transfer to a card is not added again", () => {
    const out = reconcileCardPayments(
      [row({ id: "pay" })],
      [{ type: "transfer", date: "2026-09-10", amount: 300, destinationAccountId: "card" }],
      accounts,
      everyday,
    );
    assert.equal(out[0].dup, true);
    assert.equal(out[0].include, false);
  });

  test("a transfer somewhere else is not mistaken for it", () => {
    const out = reconcileCardPayments(
      [row({ id: "pay" })],
      [{ type: "transfer", date: "2026-09-08", amount: 300, destinationAccountId: "chq" }],
      accounts,
      everyday,
    );
    assert.equal(out[0].include, true);
  });

  test("it is saved out of the everyday account and onto the card", () => {
    assert.deepEqual(cashRowSides(row({}), "card", "chq"), {
      sourceAccountId: "chq",
      destinationAccountId: "card",
    });
  });

  test("a repayment still lands on its debt", () => {
    assert.deepEqual(
      cashRowSides(row({ type: "expense", debtAccountId: "loan" }), "chq", "chq"),
      { sourceAccountId: "chq", destinationAccountId: "loan" },
    );
  });
});

/* ALL-FIXTURES-INVENTED */
describe("rows of one file", () => {
  test("two identical lines in one file are two purchases, not a duplicate", () => {
    const rows = rowsFromRecords("card.csv", "simple", [
      { transaction_date: "2026-09-06", transaction_type: "Purchase", merchant: "Corner Cafe", amount: "-2.50" },
      { transaction_date: "2026-09-06", transaction_type: "Purchase", merchant: "Corner Cafe", amount: "-2.50" },
    ], new Set(), {}).rows;
    assert.deepEqual(rows.map((r) => r.include), [true, true]);
  });

  test("a key stored once accounts for one row, not every row that shares it", () => {
    const rows = rowsFromRecords("card.csv", "simple", [
      { transaction_date: "2026-09-06", transaction_type: "Purchase", merchant: "Corner Cafe", amount: "-2.50" },
      { transaction_date: "2026-09-06", transaction_type: "Purchase", merchant: "Corner Cafe", amount: "-2.50" },
      { transaction_date: "2026-09-06", transaction_type: "Purchase", merchant: "Corner Cafe", amount: "-2.50" },
    ], new Map([["2026-09-06|2.50|corner cafe", 1]]), {}).rows;
    assert.deepEqual(rows.map((r) => r.dup), [true, false, false]);
  });

  test("but a line already stored is still flagged", () => {
    const rows = rowsFromRecords("card.csv", "simple", [
      { transaction_date: "2026-09-06", transaction_type: "Purchase", merchant: "Corner Cafe", amount: "-2.50" },
    ], new Set(["2026-09-06|2.50|corner cafe"]), {}).rows;
    assert.equal(rows[0].dup, true);
  });
});

describe("naming a pre-authorized debit", () => {
  const accounts = [{ id: "chq", kind: "checking" as const }, { id: "card", kind: "credit" as const }];
  const debit = (over: Partial<ImportedRow> = {}): ImportedRow => ({
    id: "d", date: "2026-09-30", payee: "Pre-authorized Debit", note: "Pre-authorized Debit",
    amount: 40, type: "expense", sourceFile: "bank.csv", category: "Other",
    suggestedCategory: "Other", confident: false, include: true, dup: false, explicitType: true, ...over,
  });
  const paid = (over: Partial<Parameters<typeof nameFromHistory>[1][number]> = {}) => ({
    type: "expense" as const, date: "2026-08-31", amount: 40, payee: "Loan Servicer",
    category: "Debt Repayment", sourceAccountId: "chq", granularity: "individual" as const, ...over,
  });

  test("takes the name and category last given to a debit of that amount", () => {
    const [r] = nameFromHistory([debit()], [paid()], accounts);
    assert.deepEqual([r.payee, r.category, r.confident], ["Loan Servicer", "Debt Repayment", true]);
  });

  test("the most recent name wins", () => {
    const [r] = nameFromHistory(
      [debit()],
      [paid({ payee: "Old Name", date: "2026-07-31" }), paid({ payee: "New Name", date: "2026-08-31" })],
      accounts,
    );
    assert.equal(r.payee, "New Name");
  });

  test("nothing is guessed without a named payment of the same amount", () => {
    const [r] = nameFromHistory([debit()], [paid({ amount: 41 })], accounts);
    assert.equal(r.payee, "Pre-authorized Debit");
  });

  test("a month's total or another debit's bank wording is not a name", () => {
    const [r] = nameFromHistory(
      [debit()],
      [paid({ granularity: "monthly", payee: "Utilities" }), paid({ payee: "Pre-authorized Debit" })],
      accounts,
    );
    assert.equal(r.payee, "Pre-authorized Debit");
  });

  test("spending off a card is not a debit's name", () => {
    const [r] = nameFromHistory([debit()], [paid({ sourceAccountId: "card" })], accounts);
    assert.equal(r.payee, "Pre-authorized Debit");
  });

  test("once named, a debit already stored under that name is not added again", () => {
    const [r] = nameFromHistory([debit()], [paid({ date: "2026-09-30" })], accounts);
    assert.equal(r.dup, true);
    assert.equal(r.include, false);
  });
});

/* ALL-FIXTURES-INVENTED */
describe("a debit filed as a repayment", () => {
  const names: Record<string, string> = { loan: "Car Loan", card: "Store Card" };
  const debtName = (id: string) => names[id];
  const debit = { note: "Pre-authorized Debit", payee: "Pre-authorized Debit", debtAccountId: undefined as string | undefined };

  test("is named for the debt it paid, with nothing to type", () => {
    assert.deepEqual(chooseDebt(debit, "loan", debtName), { debtAccountId: "loan", payee: "Car Loan" });
  });

  test("changing the debt changes the name it was given", () => {
    const first = { ...debit, ...chooseDebt(debit, "loan", debtName) };
    assert.equal(chooseDebt(first, "card", debtName).payee, "Store Card");
  });

  test("a name typed or learned is left alone", () => {
    assert.deepEqual(chooseDebt({ ...debit, payee: "Credit Union" }, "loan", debtName), { debtAccountId: "loan" });
  });

  test("a bought thing filed under the category keeps its merchant", () => {
    assert.deepEqual(chooseDebt({ note: undefined, payee: "Corner Cafe" }, "loan", debtName), { debtAccountId: "loan" });
  });

  test("moving off the category drops the debt and the name it lent", () => {
    const named = { ...debit, payee: "Car Loan", debtAccountId: "loan", category: "Debt Repayment" };
    assert.deepEqual(chooseCategory(named, "Utilities", debtName), {
      category: "Utilities",
      debtAccountId: undefined,
      payee: "Pre-authorized Debit",
    });
  });

  test("a learned repayment arrives with its debt", () => {
    const [r] = nameFromHistory(
      [{ id: "d", date: "2026-09-30", payee: "Pre-authorized Debit", note: "Pre-authorized Debit", amount: 40,
        type: "expense", sourceFile: "bank.csv", category: "Other", suggestedCategory: "Other",
        confident: false, include: true, dup: false, explicitType: true }],
      [{ type: "expense", date: "2026-08-31", amount: 40, payee: "Car Loan", category: "Debt Repayment",
        sourceAccountId: "chq", destinationAccountId: "loan", granularity: "individual" }],
      [{ id: "chq", kind: "checking" }],
    );
    assert.equal(r.debtAccountId, "loan");
  });
});
