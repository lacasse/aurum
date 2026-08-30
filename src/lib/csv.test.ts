import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { detectFormat, suggestCategory } from "./csv";

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
