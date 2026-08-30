import Papa from "papaparse";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, TxnType } from "./types";

export type CsvFormat = "amex" | "simple";

export interface ImportedRow {
  id: string;
  date: string; // ISO YYYY-MM-DD
  payee: string;
  amount: number; // always positive
  type: TxnType;
  note?: string;
  sourceFile: string;
  csvCategory?: string;
  category: string; // current selection (suggestion, possibly edited)
  suggestedCategory: string; // original auto-suggestion
  confident: boolean; // suggestion came from a strong match
  include: boolean;
  dup: boolean; // matches an existing transaction or a row in this import
}

export interface ParseResult {
  fileName: string;
  format: CsvFormat | null;
  rows: ImportedRow[];
  skippedPayments: number;
  skippedInvalid: number;
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

export function detectFormat(fields: string[] | undefined): CsvFormat | null {
  if (!fields || fields.length === 0) return null;
  const set = new Set(
    fields.map((f) => f.replace(/^\uFEFF/, "").trim().toLowerCase()),
  );
  if (
    set.has("merchant name") &&
    (set.has("activity type") || set.has("reference number"))
  ) {
    return "amex";
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
  ["Salary", ["payroll", "direct dep", "salary", "paycheck", "gusto", "adp ", "workday"]],
  ["Dividends", ["dividend"]],
  ["Interest", ["interest"]],
  ["Refund", ["refund", "reimburs", "cash back", "statement credit", "returned item", "return "]],
  ["Gifts", ["gift"]],
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
  // The user-managed category list (Budgets page) wins when provided.
  const allowed: readonly string[] =
    userCategories ?? (type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES);
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
  const baseRules =
    userCategories || type === "expense" ? EXPENSE_RULES : INCOME_RULES;
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
/* Row extraction                                                      */
/* ------------------------------------------------------------------ */

const BAD_STATUS = /declin|fail|void|cancel|revers|error/;

export function rowsFromRecords(
  fileName: string,
  format: CsvFormat,
  records: Record<string, string>[],
  existingKeys: Set<string>,
  merchantRules: Record<string, string>,
  userCategories?: readonly string[],
): { rows: ImportedRow[]; skippedPayments: number; skippedInvalid: number } {
  const rows: ImportedRow[] = [];
  let skippedPayments = 0;
  let skippedInvalid = 0;
  const seen = new Set<string>(existingKeys);
  const pick = (r: Record<string, string>, ...names: string[]): string => {
    for (const n of names) {
      const v = r[n];
      if (v != null && String(v).trim() !== "") return String(v).trim();
    }
    return "";
  };

  for (const r of records) {
    let dateStr = "";
    let payee = "";
    let amountStr = "";
    let typeStr = "";
    let desc = "";
    let note: string | undefined;
    let csvCategory: string | undefined;

    if (format === "amex") {
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

    let type: TxnType;
    if (format === "amex") {
      if (["charge", "fee", "adjustment"].includes(typeStr)) type = "expense";
      else if (["credit", "return", "refund"].includes(typeStr)) type = "income";
      else type = signed < 0 ? "expense" : "income";
    } else {
      if (["debit", "sale", "purchase", "charge", "withdrawal", "fee"].includes(typeStr))
        type = "expense";
      else if (["credit", "refund", "return", "deposit"].includes(typeStr))
        type = "income";
      else type = signed < 0 ? "expense" : "income";
    }

    const key = `${date}|${Math.abs(signed).toFixed(2)}|${payee.toLowerCase()}`;
    const dup = seen.has(key);
    seen.add(key);

    const suggestion = suggestCategory(
      payee,
      desc,
      note ?? "",
      csvCategory,
      type,
      merchantRules,
      userCategories,
    );
    rows.push({
      id: rowId(),
      date,
      payee,
      amount: Math.abs(Math.round(signed * 100) / 100),
      type,
      note,
      sourceFile: fileName,
      csvCategory,
      category: suggestion.category,
      suggestedCategory: suggestion.category,
      confident: suggestion.confident,
      include: !dup,
      dup,
    });
  }

  return { rows, skippedPayments, skippedInvalid };
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
      error: "Unrecognized columns — expected an Amex-style export or transaction_date/merchant/amount format.",
    };
  }
  const { rows, skippedPayments, skippedInvalid } = rowsFromRecords(
    fileName,
    format,
    records,
    existingKeys,
    merchantRules,
    userCategories,
  );
  return { fileName, format, rows, skippedPayments, skippedInvalid };
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
          error: "Could not read file.",
        }),
    });
  });
}

export function txnKey(date: string, amount: number, payee: string): string {
  return `${date}|${amount.toFixed(2)}|${payee.trim().toLowerCase()}`;
}
