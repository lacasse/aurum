import Papa from "papaparse";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, TxnType } from "./types";

export type CsvFormat = "amex" | "simple" | "debit-credit";

export interface ImportedRow {
  id: string;
  date: string; // ISO YYYY-MM-DD
  payee: string;
  amount: number; // always positive
  type: TxnType;
  note?: string;
  sourceFile: string;
  /**
   * The account this row belongs to, when the file said so.
   *
   * A card statement is one account from top to bottom, so the account is
   * chosen per file. An activity export is not: most of it is the chequing
   * account, but the withholding tax on a US dividend belongs to the RRSP that
   * received it. That row carries its registration here and the per-file choice
   * does not apply to it.
   */
  accountHint?: string;
  csvCategory?: string;
  category: string; // current selection (suggestion, possibly edited)
  suggestedCategory: string; // original auto-suggestion
  confident: boolean; // suggestion came from a strong match
  include: boolean;
  dup: boolean; // matches an existing transaction or a row in this import
  /**
   * True when the direction came from the file's own words — a "Debit" or a
   * "Charge" column — rather than from the sign convention worked out for the
   * file as a whole.
   */
  explicitType: boolean;
}

export interface ParseResult {
  fileName: string;
  format: CsvFormat | null;
  rows: ImportedRow[];
  skippedPayments: number;
  skippedInvalid: number;
  /** How the file's signs were read. Null when nothing needed reading. */
  signs: SignConvention | null;
  error?: string;
}

let seq = 0;
function rowId(): string {
  seq += 1;
  return `imp-${Date.now().toString(36)}-${seq}-${Math.random().toString(36).slice(2, 6)}`;
}

/* ------------------------------------------------------------------ */
/* Format detection                                                    */
/* ------------------------------------------------------------------ */

/**
 * Column names, as the banks actually write them.
 *
 * Every export names the same four things differently — a date is "Date",
 * "Transaction Date", "Posting Date" or "Date Posted" depending on who wrote
 * the exporter — so the names are matched against a list rather than assumed.
 */
const DATE_COLUMNS = [
  "date",
  "transaction date",
  "transaction_date",
  "posted date",
  "post date",
  "posting date",
  "date posted",
  "effective date",
];

const DESC_COLUMNS = [
  "description",
  "description 1",
  "merchant",
  "payee",
  "name",
  "details",
  "transaction description",
  "narrative",
  "memo",
];

/** Columns that hold money leaving the account. */
const DEBIT_COLUMNS = [
  "debit",
  "debits",
  "debit amount",
  "amount debit",
  "withdrawal",
  "withdrawals",
  "withdrawal amount",
  "money out",
  "paid out",
  "funds out",
];

/** …and the ones that hold money arriving. */
const CREDIT_COLUMNS = [
  "credit",
  "credits",
  "credit amount",
  "amount credit",
  "deposit",
  "deposits",
  "deposit amount",
  "money in",
  "paid in",
  "funds in",
];

function normalizeHeaders(fields: string[] | undefined): Set<string> {
  return new Set(
    (fields ?? []).map((f) => f.replace(/^\uFEFF/, "").trim().toLowerCase()),
  );
}

const hasAny = (set: Set<string>, names: string[]) => names.some((n) => set.has(n));

export function detectFormat(fields: string[] | undefined): CsvFormat | null {
  if (!fields || fields.length === 0) return null;
  const set = normalizeHeaders(fields);
  if (
    set.has("merchant name") &&
    (set.has("activity type") || set.has("reference number"))
  ) {
    return "amex";
  }
  /*
   * Checked before the single-amount format, because a file that has both a
   * signed amount column and a debit/credit pair has told us the direction
   * outright — and a column that names the direction beats any amount of
   * inference from signs.
   */
  if (
    hasAny(set, DEBIT_COLUMNS) &&
    hasAny(set, CREDIT_COLUMNS) &&
    hasAny(set, DATE_COLUMNS)
  ) {
    return "debit-credit";
  }
  if (set.has("transaction_date") && set.has("merchant")) return "simple";
  return null;
}

/* ------------------------------------------------------------------ */
/* Primitive parsers                                                   */
/* ------------------------------------------------------------------ */

export function parseAmount(raw: string | undefined): number | null {
  if (raw == null) return null;
  let t = String(raw)
    .trim()
    .replace(/^\$/, "")
    .replace(/,/g, "")
    .replace(/\s/g, "");
  if (!t) return null;
  let neg = false;
  if (/^\((.*)\)$/.test(t)) {
    neg = true;
    t = t.slice(1, -1);
  }
  if (t.endsWith("-")) {
    neg = true;
    t = t.slice(0, -1);
  }
  if (t.startsWith("-")) {
    neg = true;
    t = t.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const v = Number.parseFloat(t);
  return Number.isFinite(v) ? (neg ? -v : v) : null;
}

const MONTH_IDX: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseFlexibleDate(raw: string | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    return iso(y, +m[1], +m[2]);
  }
  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (m) return iso(+m[3], +m[1], +m[2]);
  m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mo = MONTH_IDX[m[1].slice(0, 3).toLowerCase()];
    if (mo) return iso(+m[3], mo, +m[2]);
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Categorization                                                      */
/* ------------------------------------------------------------------ */

/** Ordered keyword rules — first match wins, so specific rules come first. */
const EXPENSE_RULES: [string, string[]][] = [
  ["Housing", ["rent", "mortgage", "landlord", "hoa", "property mgmt", "property management", "apartments", "leasing office"]],
  ["Insurance", ["insurance", "geico", "progressive", "allstate", "state farm", "lemonade", "esurance"]],
  ["Utilities", ["electric", "power co", "water bill", "sewer", "utility", "utilities", "internet", "comcast", "xfinity", "spectrum", "verizon", "at&t", "t-mobile", "tmobile", "fiber", "broadband", "cable tv", "con edison", "coned", "pg&e", "national grid", "waste management", "recycling"]],
  ["Subscriptions", ["netflix", "spotify", "hulu", "disney+", "disney plus", "hbo", "max.com", "peacock", "paramount+", "apple.com/bill", "icloud", "prime video", "youtube premium", "audible", "dropbox", "adobe", "notion", "figma", "1password", "patreon", "substack", "subscription", "apple one", "nytimes", "wsj.com", "anthropic", "openai", "claude", "onlyfans", "crave", "freedom mobile", "rogers", "bell canada", "telus", "koodo", "fido"]],
  ["Health", ["pharmacy", "cvs", "walgreens", "rite aid", "dentist", "dental", "doctor", "clinic", "hospital", "medical", "optometry", "vision", "lenscrafters", "gym", "fitness", "equinox", "planet fitness", "yoga", "pilates", "peloton", "therapy", "therapist", "labcorp", "quest diagnostics", "urgent care"]],
  ["Groceries", ["whole foods", "trader joe", "safeway", "costco", "kroger", "aldi", "wegmans", "publix", "sprouts", "heb ", "grocery", "supermarket", "fresh market", "food lion", "stop & shop", "giant eagle", "winco", "meijer", "grocery store", "supermarkets", "loblaw", "no frills", "food basics", "sobeys", "farm boy", "independent grocer", "yig", "giant tiger", "fortinos", "provigo", "maxi ", "iga ", "walmart supercenter", "real canadian"]],
  ["Dining", ["restaurant", "cafe", "coffee", "starbucks", "dunkin", "peet", "chipotle", "sweetgreen", "pizzeria", "pizza", "sushi", "ramen", "grill", "diner", "mcdonald", "burger", "shake shack", "five guys", "taco", "doordash", "uber eats", "ubereats", "grubhub", "seamless", "postmates", "bakery", "bistro", "deli", "poke", "curry", "noodle", "steakhouse", "wendy", "panera", "chick-fil-a", "kfc", "jersey mike", "delis", "quick food", "eating place", "food & drink", "tim horton", "a&w", "harvey", "swiss chalet", "st-hubert", "boston pizza", "osmow", "shawarma", "banh mi", "chatime", "happy goat", "second cup", "lcbo", "beer store", "saq ", "brewery", "winery", "vineyard", "pub "]],
  ["Transport", ["shell", "chevron", "exxon", "mobil ", "gas station", "fuel", "uber ", "lyft", "taxi", "metro", "transit", "parking", "toll", "zipcar", "car wash", "jiffy lube", "autozone", "pep boys", "valvoline", "service station", "petroleum", "petro-canada", "petro canada", "esso", "husky", "ultramar", "circle k", "presto", "oc transpo", "compass account", "translink", "via rail", "easypark", "impark", "indigo park", "green p"]],
  ["Travel", ["delta air", "united air", "american air", "southwest", "jetblue", "alaska air", "spirit air", "frontier", "airbnb", "vrbo", "hotel", "marriott", "hilton", "hyatt", "holiday inn", "best western", "expedia", "booking.com", "priceline", "kayak", "airline", "airways", "flight", "airport", "cruise", "motel", "inn & suites"]],
  ["Entertainment", ["steam", "playstation", "xbox", "nintendo", "epic games", "battle.net", "cinema", "amc ", "regal", "movie", "theater", "concert", "ticketmaster", "live nation", "livenation", "stubhub", "seatgeek", "museum", "bowling", "arcade", "golf", "ski ", "eventbrite", "bandcamp"]],
  ["Shopping", ["amazon", "amzn", "target", "walmart", "best buy", "bestbuy", "ikea", "wayfair", "etsy", "ebay", "nordstrom", "macy", "kohl", "uniqlo", "h&m", "zara", "gap", "old navy", "banana republic", "nike", "adidas", "sephora", "ulta", "home depot", "lowes", "lowe's", "ace hardware", "apple store", "dell", "lenovo", "newegg", "b&h photo", "bhphoto", "shopify", "aliexpress", "temu", "shein", "marshalls", "tj maxx", "homegoods", "department store", "clothing", "apparel", "retail stores"]],
  ["Household", ["canadian tire", "home hardware", "rona ", "ritchie feed", "dollarama", "home depot", "cleaning", "hardware"]],
  ["Dog", ["pet valu", "petsmart", "petco", "pet food", "veterinar", "vet clinic", "grooming"]],
  ["Fees", ["atm fee", "service fee", "late fee", "interest charge", "foreign transaction", "annual fee", "overdraft", "maintenance fee", "wire fee", "convenience fee", "processing fee"]],
];

const INCOME_RULES: [string, string[]][] = [
  ["Salary", ["payroll", "direct dep", "salary", "paycheck", "pay cheque", "paycheque", "wages", "gusto", "adp ", "workday", "employer", "net pay", "pay - ", "dep pay"]],
  ["Freelance", ["freelance", "consulting", "invoice", "contract pay", "upwork", "fiverr", "stripe payout", "self-employ"]],
  ["Dividends", ["dividend", "distribution"]],
  ["Interest", ["interest", "int paid", "int credit"]],
  ["RSP / Pension", ["pension", "rrsp contribution", "rsp contribution", "employer match", "superannuation"]],
  ["Loan Proceeds", ["loan advance", "loan proceeds", "line of credit advance", "mortgage advance", "loan disburs"]],
  ["Refund", ["refund", "reimburs", "cash back", "statement credit", "returned item", "return ", "rebate"]],
  ["Gifts", ["gift", "e-transfer from", "etransfer from"]],
];

/**
 * What card issuers call things, and what this app calls them.
 *
 * Every issuer ships its own taxonomy, and the names rarely line up: a card
 * statement's "Restaurants" is this app's "Dining", and its "Gas, parking, and
 * tolls" is "Transport". Without the translation every row falls through to
 * keyword guessing, which gets the obvious ones and files the rest under Other.
 */
const ISSUER_CATEGORIES: Record<string, string> = {
  restaurants: "Dining",
  "bars and nightlife": "Dining",
  "other food and drink": "Dining",
  "fast food": "Dining",
  coffee: "Dining",
  "other shopping": "Shopping",
  clothing: "Shopping",
  electronics: "Shopping",
  "home and auto": "Household",
  "house items": "Household",
  "gas, parking, and tolls": "Transport",
  "public transit": "Transport",
  "taxis and rideshares": "Transport",
  "other transportation": "Transport",
  "car payment": "Transport",
  "auto insurance": "Insurance",
  "home insurance": "Insurance",
  "life insurance": "Insurance",
  "internet and phone": "Utilities",
  "utilities and bills": "Utilities",
  medical: "Health",
  "other health": "Health",
  pharmacy: "Health",
  beauty: "Health",
  fitness: "Health",
  pets: "Dog",
  hotels: "Travel",
  flights: "Travel",
  "kids' activities": "Entertainment",
  entertainment: "Entertainment",
  "movies and music": "Entertainment",
  subscriptions: "Subscriptions",
  groceries: "Groceries",
  rent: "Housing",
  mortgage: "Housing",
  charity: "Donations",
  donations: "Donations",
  education: "Education",
  "bank fees": "Fees",
  services: "Other",
  miscellaneous: "Other",
  "other personal": "Other",
  uncategorized: "Other",
};

export interface Suggestion {
  category: string;
  confident: boolean;
}

export function suggestCategory(
  payee: string,
  desc: string,
  note: string,
  csvCategory: string | undefined,
  type: TxnType,
  merchantRules: Record<string, string>,
  userCategories?: readonly string[],
): Suggestion {
  /*
   * The user-managed list (Budgets page) is a list of *expense* categories —
   * there is no user-managed income list, and `categoriesFor` in types.ts says
   * the same. Offering it for an income row meant every deposit was matched
   * against Housing, Groceries and Dining, matched nothing, and arrived as
   * Other: a month of payroll, interest and dividends imported as
   * uncategorised, which then had to be fixed by hand one row at a time.
   */
  const allowed: readonly string[] =
    type === "income" ? INCOME_CATEGORIES : userCategories ?? EXPENSE_CATEGORIES;
  const fallback = allowed.includes("Other") ? "Other" : allowed[0] ?? "Other";

  // 1. Rules the user taught us on previous imports
  const rule = merchantRules[payee.trim().toLowerCase()];
  if (rule && allowed.includes(rule)) return { category: rule, confident: true };

  // 2. The CSV's own category column, matched against the allowed categories
  const csv = (csvCategory ?? "").trim().toLowerCase();
  if (csv) {
    if (allowed.some((c) => c.toLowerCase() === csv)) {
      return { category: titleCase(csv), confident: true };
    }
    const mapped = resolveCategory(ISSUER_CATEGORIES[csv], allowed);
    if (mapped) return { category: mapped, confident: true };
    for (const cat of allowed) {
      if (csv.includes(cat.toLowerCase())) return { category: cat, confident: true };
    }
  }

  // 3. Keyword heuristics over merchant + description + notes
  const text = `${payee} ${desc} ${note}`.toLowerCase();
  // Income has its own vocabulary. "Payroll" is not a merchant, and the
  // expense rules have nothing to say about it.
  const baseRules = type === "income" ? INCOME_RULES : EXPENSE_RULES;
  for (const [name, keywords] of baseRules) {
    const category = resolveCategory(name, allowed);
    if (category && keywords.some((k) => text.includes(k))) {
      return { category, confident: true };
    }
  }

  return { category: fallback, confident: false };
}

/**
 * The user's name for a category this code knows by another name.
 *
 * Categories are the user's to rename, and renaming one used to switch off
 * every rule that mentioned it: a list saying "Dining" matched nothing once
 * the category had become "Drinks & Dining", so every restaurant on the
 * statement arrived as Other. Matching is therefore by containment in either
 * direction rather than by equality.
 */
function resolveCategory(
  name: string | undefined,
  allowed: readonly string[],
): string | null {
  if (!name) return null;
  const wanted = name.toLowerCase();
  const exact = allowed.find((c) => c.toLowerCase() === wanted);
  if (exact) return exact;
  const near = allowed.find((c) => {
    const other = c.toLowerCase();
    return other.includes(wanted) || wanted.includes(other);
  });
  return near ?? null;
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/* ------------------------------------------------------------------ */
/* Which sign means money out                                          */
/* ------------------------------------------------------------------ */

/**
 * There is no convention. Half the world writes a purchase as -42.00 and half
 * writes it as 42.00, and the same bank will do it differently on the card
 * export and the chequing export.
 *
 * A chequing statement is written from the account's point of view: money
 * leaving is negative. A card statement is written from the balance's point of
 * view: a purchase *increases* what you owe, so it is positive, and the
 * payment that clears it is the negative one. Reading either with the other's
 * rule inverts the whole file — every expense becomes income and the month
 * reports several thousand dollars that never arrived.
 *
 * So it is not assumed. It is worked out from the file, once, before any row
 * is given a direction.
 */
export type SignBasis = "columns" | "type-column" | "majority" | "unsigned";

export interface SignConvention {
  /** Which sign the file uses for money going out. */
  outflow: "negative" | "positive";
  /** What settled it, which is what the UI tells the reader. */
  basis: SignBasis;
  /** Rows that supported it, against rows that did not. */
  agreed: number;
  disagreed: number;
}

export interface SignSample {
  amount: number;
  /** The direction the file stated in words, when it stated one. */
  stated: TxnType | null;
}

/**
 * Decide, for one file, which sign means an expense.
 *
 * In order of authority:
 *
 * 1. **The file's own words.** A row labelled "Debit" or "Charge" is not a
 *    guess, so the sign those rows carry is the file's convention, and the
 *    rest of the file is read by it. This is exact whenever a type column
 *    exists, which is most of the time.
 * 2. **The majority.** Failing that: a statement is mostly spending. Forty
 *    charges and one payment, or forty debits and one deposit — either way the
 *    sign that appears most often is the one that means money out.
 * 3. **Neither.** A file with every amount the same sign says nothing at all
 *    through its signs, and is read as a statement of spending.
 */
export function detectSignConvention(samples: SignSample[]): SignConvention {
  let outNeg = 0;
  let outPos = 0;
  for (const s of samples) {
    if (s.stated === null || s.amount === 0) continue;
    // An outflow labelled in words says its sign means "money out"; an
    // inflow says the same about the sign it does not carry.
    const negativeMeansOut =
      s.stated === "expense" ? s.amount < 0 : s.amount > 0;
    if (negativeMeansOut) outNeg++;
    else outPos++;
  }
  /*
   * Two agreeing rows is the threshold. One row is an anecdote — a single
   * refund at the top of a card statement would otherwise invert everything
   * under it — and a file whose labelled rows contradict each other has not
   * told us anything, so it falls through to counting.
   */
  if (outNeg + outPos >= 2 && outNeg !== outPos) {
    const negative = outNeg > outPos;
    return {
      outflow: negative ? "negative" : "positive",
      basis: "type-column",
      agreed: negative ? outNeg : outPos,
      disagreed: negative ? outPos : outNeg,
    };
  }

  let neg = 0;
  let pos = 0;
  for (const s of samples) {
    if (s.amount < 0) neg++;
    else if (s.amount > 0) pos++;
  }
  if (neg === 0 || pos === 0) {
    // Nothing to read: one sign throughout. Treat the file as spending, which
    // is what a statement of one sign almost always is.
    return {
      outflow: neg > 0 ? "negative" : "positive",
      basis: "unsigned",
      agreed: neg + pos,
      disagreed: 0,
    };
  }
  const negative = neg >= pos;
  return {
    outflow: negative ? "negative" : "positive",
    basis: "majority",
    agreed: negative ? neg : pos,
    disagreed: negative ? pos : neg,
  };
}

/** How the reader is told what was decided. */
export function describeSigns(c: SignConvention): string {
  const side = c.outflow === "negative" ? "Negative" : "Positive";
  if (c.basis === "columns") {
    return "Direction taken from the file's separate debit and credit columns.";
  }
  if (c.basis === "unsigned") {
    return `Every amount has the same sign, so the file was read as spending.`;
  }
  const how =
    c.basis === "type-column"
      ? "matching the file's own debit and credit labels"
      : "since most rows on a statement are spending";
  return `${side} amounts read as money out, ${how}.`;
}

/* ------------------------------------------------------------------ */
/* Row extraction                                                      */
/* ------------------------------------------------------------------ */

const BAD_STATUS = /declin|fail|void|cancel|revers|error/;

/** The direction a row's own words claim, or null when it does not say. */
function statedType(format: CsvFormat, typeStr: string): TxnType | null {
  if (format === "amex") {
    if (["charge", "fee"].includes(typeStr)) return "expense";
    if (["credit", "return", "refund"].includes(typeStr)) return "income";
    // "Adjustment" goes either way, so it says nothing and is left to the sign.
    return null;
  }
  if (["debit", "sale", "purchase", "charge", "withdrawal", "fee"].includes(typeStr)) {
    return "expense";
  }
  if (["credit", "refund", "return", "deposit"].includes(typeStr)) return "income";
  return null;
}

/**
 * A record's values by lower-cased column name.
 *
 * The Amex and simple formats know their exact headers; a bank export does
 * not — the same bank ships "Withdrawal" one year and "withdrawal amount" the
 * next — so those columns are matched without regard to case or padding.
 */
function normalizeRecord(r: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(r)) {
    out[k.replace(/^\uFEFF/, "").trim().toLowerCase()] = v;
  }
  return out;
}

function pickFrom(r: Record<string, string>, names: string[]): string {
  for (const n of names) {
    const v = r[n];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

interface RawRow {
  date: string;
  payee: string;
  signed: number;
  stated: TxnType | null;
  desc: string;
  note?: string;
  csvCategory?: string;
}

export function rowsFromRecords(
  fileName: string,
  format: CsvFormat,
  records: Record<string, string>[],
  existingKeys: Set<string>,
  merchantRules: Record<string, string>,
  userCategories?: readonly string[],
): {
  rows: ImportedRow[];
  skippedPayments: number;
  skippedInvalid: number;
  signs: SignConvention | null;
} {
  let skippedPayments = 0;
  let skippedInvalid = 0;
  const pick = (r: Record<string, string>, ...names: string[]): string => {
    for (const n of names) {
      const v = r[n];
      if (v != null && String(v).trim() !== "") return String(v).trim();
    }
    return "";
  };

  /*
   * Read every row first, then decide what the signs mean, then hand out
   * directions. The direction of a row is a fact about the file, not about
   * the row, so it cannot be settled while still reading the file.
   */
  const raw: RawRow[] = [];

  for (const r of records) {
    let dateStr = "";
    let payee = "";
    let amountStr = "";
    let typeStr = "";
    let desc = "";
    let note: string | undefined;
    let csvCategory: string | undefined;

    if (format === "debit-credit") {
      const n = normalizeRecord(r);
      dateStr = pickFrom(n, DATE_COLUMNS);
      payee = pickFrom(n, DESC_COLUMNS) || "Unknown merchant";
      const debit = parseAmount(pickFrom(n, DEBIT_COLUMNS)) ?? 0;
      const credit = parseAmount(pickFrom(n, CREDIT_COLUMNS)) ?? 0;
      /*
       * The column is the answer, so its own sign is not consulted: a file
       * that writes withdrawals as -84.20 under "Debit" means the same thing
       * as one that writes 84.20, and the magnitude is all that is wanted.
       * Both filled at once is netted, which is the only sane reading of a row
       * that claims to be a withdrawal and a deposit together.
       */
      const net = Math.abs(debit) - Math.abs(credit);
      amountStr = String(net);
      typeStr = net > 0 ? "debit" : net < 0 ? "credit" : "";
      desc = pickFrom(n, ["category", "transaction type", "type"]);
      csvCategory = pickFrom(n, ["category"]) || undefined;
      note = pickFrom(n, ["notes", "memo", "description 2"]) || undefined;
    } else if (format === "amex") {
      dateStr = pick(r, "Date", "Posted Date");
      payee = pick(r, "Merchant Name", "Merchant Category Description") || "Unknown merchant";
      amountStr = pick(r, "Amount");
      typeStr = pick(r, "Activity Type").toLowerCase();
      desc = pick(r, "Merchant Category Description");
      const city = pick(r, "Merchant City");
      const state = pick(r, "Merchant State or Province");
      note = [city, state].filter(Boolean).join(", ") || undefined;
    } else {
      dateStr = pick(r, "transaction_date", "date", "posted date");
      payee = pick(r, "merchant", "description", "name") || "Unknown merchant";
      amountStr = pick(r, "amount");
      typeStr = pick(r, "transaction_type", "type").toLowerCase();
      desc = pick(r, "category");
      csvCategory = pick(r, "category") || undefined;
      note = pick(r, "notes") || undefined;
    }

    const status = pick(r, "Activity Status", "status").toLowerCase();
    if (status && BAD_STATUS.test(status)) {
      skippedInvalid += 1;
      continue;
    }
    if (typeStr === "payment" || typeStr === "payment/credit") {
      skippedPayments += 1; // paying the card bill isn't spending
      continue;
    }

    const date = parseFlexibleDate(dateStr);
    const signed = parseAmount(amountStr);
    if (!date || signed == null || signed === 0) {
      skippedInvalid += 1;
      continue;
    }

    raw.push({
      date,
      payee,
      signed,
      stated: statedType(format, typeStr),
      desc,
      note,
      csvCategory,
    });
  }

  const signs =
    raw.length === 0
      ? null
      : format === "debit-credit"
        ? {
            outflow: "positive" as const,
            basis: "columns" as const,
            agreed: raw.length,
            disagreed: 0,
          }
        : detectSignConvention(
            raw.map((r) => ({ amount: r.signed, stated: r.stated })),
          );
  const outflowIsNegative = signs?.outflow !== "positive";

  const rows: ImportedRow[] = [];
  const seen = new Set<string>(existingKeys);

  for (const r of raw) {
    // Words beat signs: a row the file called a credit is a credit, whatever
    // the rest of the file signs its amounts.
    const type: TxnType =
      r.stated ?? (r.signed < 0 === outflowIsNegative ? "expense" : "income");

    const key = `${r.date}|${Math.abs(r.signed).toFixed(2)}|${r.payee.toLowerCase()}`;
    const dup = seen.has(key);
    seen.add(key);

    const suggestion = suggestCategory(
      r.payee,
      r.desc,
      r.note ?? "",
      r.csvCategory,
      type,
      merchantRules,
      userCategories,
    );
    rows.push({
      id: rowId(),
      date: r.date,
      payee: r.payee,
      amount: Math.abs(Math.round(r.signed * 100) / 100),
      type,
      note: r.note,
      sourceFile: fileName,
      csvCategory: r.csvCategory,
      category: suggestion.category,
      suggestedCategory: suggestion.category,
      confident: suggestion.confident,
      include: !dup,
      dup,
      explicitType: r.stated !== null,
    });
  }

  return { rows, skippedPayments, skippedInvalid, signs };
}

/* ------------------------------------------------------------------ */
/* File-level parsing                                                  */
/* ------------------------------------------------------------------ */

export function parseCsvRecords(
  fileName: string,
  fields: string[] | undefined,
  records: Record<string, string>[],
  existingKeys: Set<string>,
  merchantRules: Record<string, string>,
  userCategories?: readonly string[],
): ParseResult {
  const format = detectFormat(fields);
  if (!format) {
    return {
      fileName,
      format: null,
      rows: [],
      skippedPayments: 0,
      skippedInvalid: 0,
      signs: null,
      error: "Unrecognized columns — expected an Amex-style export or transaction_date/merchant/amount format.",
    };
  }
  const { rows, skippedPayments, skippedInvalid, signs } = rowsFromRecords(
    fileName,
    format,
    records,
    existingKeys,
    merchantRules,
    userCategories,
  );
  return { fileName, format, rows, skippedPayments, skippedInvalid, signs };
}

export function parseCsvFile(
  file: File,
  existingKeys: Set<string>,
  merchantRules: Record<string, string>,
  userCategories?: readonly string[],
): Promise<ParseResult> {
  return new Promise((resolve) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.replace(/^\uFEFF/, "").trim(),
      complete: (res) =>
        resolve(
          parseCsvRecords(
            file.name,
            res.meta.fields,
            res.data,
            existingKeys,
            merchantRules,
            userCategories,
          ),
        ),
      error: () =>
        resolve({
          fileName: file.name,
          format: null,
          rows: [],
          skippedPayments: 0,
          skippedInvalid: 0,
          signs: null,
          error: "Could not read file.",
        }),
    });
  });
}

export function txnKey(date: string, amount: number, payee: string): string {
  return `${date}|${amount.toFixed(2)}|${payee.trim().toLowerCase()}`;
}
