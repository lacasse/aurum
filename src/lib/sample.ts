import {
  Account,
  Budget,
  EXPENSE_CATEGORIES,
  FinanceData,
  Holding,
  Transaction,
} from "./types";
import { lastMonthKeys } from "./format";

/*
 * Every row this generator creates carries an id with one of these prefixes,
 * while rows the user creates are assigned a UUID (`uid()` in store.ts). That
 * difference is what lets "Delete demo data" remove the sample rows and only
 * the sample rows — see `deleteDemoData()` in src/db/repo.ts.
 *
 * Matching on the prefix rather than on a regenerated list of ids matters:
 * the generator's output is keyed to the trailing 18 months, so an id list
 * regenerated later would no longer name every row that was actually seeded.
 */
export const DEMO_ACCOUNT_ID_PREFIX = "acc-";
export const DEMO_HOLDING_ID_PREFIX = "hold-";
export const DEMO_TRANSACTION_ID_PREFIX = "txn-";
export const DEMO_RECURRING_ID_PREFIX = "rec-demo-";

/** Budgets are keyed by category name, so the demo rows are named outright. */
export const SAMPLE_BUDGETS: Budget[] = [
  { category: "Housing", limit: 2200 },
  { category: "Groceries", limit: 650 },
  { category: "Dining", limit: 380 },
  { category: "Transport", limit: 220 },
  { category: "Utilities", limit: 330 },
  { category: "Subscriptions", limit: 130 },
  { category: "Entertainment", limit: 200 },
  { category: "Shopping", limit: 280 },
  { category: "Health", limit: 130 },
  { category: "Travel", limit: 350 },
  { category: "Insurance", limit: 150 },
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = ReturnType<typeof mulberry32>;

const rand = (rng: Rng, min: number, max: number) =>
  min + rng() * (max - min);
const randInt = (rng: Rng, min: number, max: number) =>
  Math.floor(rand(rng, min, max + 1));
const pick = <T>(rng: Rng, arr: readonly T[]): T => arr[randInt(rng, 0, arr.length - 1)];
const chance = (rng: Rng, p: number) => rng() < p;
const round2 = (n: number) => Math.round(n * 100) / 100;

const daysInMonth = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m, 0).getDate();
};

const iso = (key: string, day: number) =>
  `${key}-${String(Math.min(day, daysInMonth(key))).padStart(2, "0")}`;

/** Linear interpolation between two values across `n` points with noise, ending exactly at `end`. */
function walk(
  rng: Rng,
  n: number,
  start: number,
  end: number,
  noise: number,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const base = start + (end - start) * t;
    const wobble =
      i === n - 1 ? 0 : (rng() - 0.5) * 2 * noise * Math.sin(Math.PI * t * 0.9 + 0.3);
    out.push(round2(base + wobble));
  }
  return out;
}

export function generateSampleData(): FinanceData {
  const rng = mulberry32(1337);
  const months = lastMonthKeys(18);
  const n = months.length;

  const mkHistory = (
    prefix: string,
    start: number,
    end: number,
    noise: number,
  ) => {
    const values = walk(rng, n, start, end, noise);
    return months.map((month, i) => ({
      id: `${prefix}-h${i}`,
      month,
      value: values[i],
    }));
  };

  const accounts = [
    {
      id: "acc-checking",
      name: "Everyday Checking",
      institution: "Chase",
      kind: "checking" as const,
    },
    {
      id: "acc-savings",
      name: "High-Yield Savings",
      institution: "Ally Bank",
      kind: "savings" as const,
    },
    {
      id: "acc-cash",
      name: "Wallet",
      institution: "—",
      kind: "cash" as const,
    },
    {
      id: "acc-property",
      name: "Condo",
      institution: "Zillow estimate",
      kind: "property" as const,
    },
    {
      id: "acc-credit",
      name: "Gold Card",
      institution: "Amex",
      kind: "credit" as const,
    },
    {
      id: "acc-auto",
      name: "Auto Loan",
      institution: "Toyota Financial",
      kind: "loan" as const,
    },
  ].map((a, idx) => {
    const cfg = [
      { start: 6100, end: 8460, noise: 700 },
      { start: 17200, end: 24800, noise: 250 },
      { start: 300, end: 340, noise: 90 },
      { start: 398000, end: 425000, noise: 2200 },
      { start: 2640, end: 2350, noise: 420 },
      { start: 13600, end: 9840, noise: 60 },
    ][idx];
    const history = mkHistory(a.id, cfg.start, cfg.end, cfg.noise).map((p) => ({
      month: p.month,
      value: p.value,
    }));
    return { ...a, balance: history[history.length - 1].value, history };
  });

  /*
   * The accounts the sample holdings sit in. Their balance is uninvested cash
   * only — the securities are valued from the holdings themselves — so they
   * start at zero and add nothing to net worth on their own.
   */
  const investmentAccounts: Account[] = (
    [
      { id: "acc-tfsa", name: "TFSA", registration: "TFSA" as const },
      { id: "acc-rrsp", name: "RRSP", registration: "RRSP" as const },
      {
        id: "acc-nonreg",
        name: "Non-registered",
        registration: "non-registered" as const,
      },
    ]
  ).map((a) => ({
    ...a,
    institution: "Questrade",
    kind: "investment" as const,
    balance: 0,
    history: months.map((month) => ({ month, value: 0 })),
  }));

  // ---------- holdings ----------
  interface Seed {
    ticker: string;
    name: string;
    assetClass: Holding["assetClass"];
    sector: string;
    shares: number;
    avgCost: number;
    price: number;
    drift: number; // total growth factor over window
    vol: number;
    dividends: number; // total cash dividends received over the window
  }
  const FX = 1.37; // sample USD/CAD rate
  const seeds: (Seed & { currency: "CAD" | "USD" })[] = [
    { ticker: "VTI", name: "Vanguard Total Stock Market ETF", assetClass: "US Equity", sector: "Broad Market", shares: 62, avgCost: 228.4, price: 292.15, drift: 1.28, vol: 0.05, dividends: 184.42, currency: "USD" },
    { ticker: "VXUS", name: "Vanguard Total International Stock ETF", assetClass: "Intl Equity", sector: "International", shares: 48, avgCost: 52.1, price: 66.84, drift: 1.24, vol: 0.06, dividends: 94.56, currency: "USD" },
    { ticker: "BND", name: "Vanguard Total Bond Market ETF", assetClass: "Bonds", sector: "Bonds", shares: 90, avgCost: 74.3, price: 72.92, drift: 0.99, vol: 0.02, dividends: 243.90, currency: "USD" },
    { ticker: "AAPL", name: "Apple Inc.", assetClass: "US Equity", sector: "Technology", shares: 40, avgCost: 148.2, price: 231.44, drift: 1.52, vol: 0.08, dividends: 37.60, currency: "USD" },
    { ticker: "MSFT", name: "Microsoft Corp.", assetClass: "US Equity", sector: "Technology", shares: 25, avgCost: 262.5, price: 418.92, drift: 1.55, vol: 0.07, dividends: 47.50, currency: "USD" },
    { ticker: "NVDA", name: "NVIDIA Corp.", assetClass: "US Equity", sector: "Semiconductors", shares: 30, avgCost: 68.4, price: 174.22, drift: 2.3, vol: 0.14, dividends: 4.50, currency: "USD" },
    { ticker: "AMZN", name: "Amazon.com Inc.", assetClass: "US Equity", sector: "Consumer Disc.", shares: 22, avgCost: 118.9, price: 186.53, drift: 1.5, vol: 0.09, dividends: 0, currency: "USD" },
    { ticker: "GOOGL", name: "Alphabet Inc.", assetClass: "US Equity", sector: "Comm. Services", shares: 18, avgCost: 121.7, price: 191.34, drift: 1.47, vol: 0.08, dividends: 0, currency: "USD" },
    { ticker: "TSLA", name: "Tesla Inc.", assetClass: "US Equity", sector: "Automotive", shares: 12, avgCost: 244.8, price: 232.11, drift: 1.02, vol: 0.16, dividends: 0, currency: "USD" },
    { ticker: "BTC", name: "Bitcoin", assetClass: "Crypto", sector: "Crypto", shares: 0.35, avgCost: 38250, price: 91400, drift: 2.1, vol: 0.18, dividends: 0, currency: "USD" },
  ];

  const holdings: Holding[] = seeds.map((s, idx) => {
    const history: number[] = [];
    let p = s.price / s.drift;
    for (let i = 0; i < n; i++) {
      history.push(p);
      const stepDrift = Math.pow(s.drift, 1 / (n - 1));
      p = p * stepDrift * (1 + (rng() - 0.5) * 2 * s.vol);
    }
    // rescale so the series ends exactly at the current price
    const scale = s.price / history[n - 1];
    const norm = history.map((v, i) =>
      i === n - 1 ? s.price : round2(v * scale),
    );
    const isUSD = s.currency === "USD";
    return {
      id: `hold-${idx + 1}`,
      ticker: s.ticker,
      name: s.name,
      assetClass: s.assetClass,
      sector: s.sector,
      shares: s.shares,
      avgCost: s.avgCost,
      price: s.price,
      history: norm,
      dividendsReceived: s.dividends,
      accountId:
        idx % 3 === 0 ? "acc-tfsa" : idx % 3 === 1 ? "acc-rrsp" : "acc-nonreg",
      currency: s.currency,
      priceCAD: isUSD ? round2(s.price * FX) : s.price,
      avgCostCAD: isUSD ? round2(s.avgCost * FX) : s.avgCost,
      dividendsReceivedCAD: isUSD ? round2(s.dividends * FX) : s.dividends,
      historyCAD: isUSD ? norm.map((v) => round2(v * FX)) : norm,
    };
  });

  // ---------- transactions ----------
  const transactions: Transaction[] = [];
  let tid = 0;
  const add = (
    month: string,
    day: number,
    type: Transaction["type"],
    amount: number,
    category: string,
    accountId: string,
    payee: string,
    note?: string,
  ) => {
    tid += 1;
    transactions.push({
      id: `txn-${String(tid).padStart(4, "0")}`,
      date: iso(month, day),
      type,
      amount: round2(amount),
      category,
      // The sample only generates money entering or leaving the outside
      // world, so exactly one side is one of the sample accounts.
      sourceAccountId: type === "income" ? undefined : accountId,
      destinationAccountId: type === "income" ? accountId : undefined,
      payee,
      note,
    });
  };

  const GROCERS = ["Whole Foods", "Trader Joe’s", "Safeway", "Costco"];
  const DINERS = [
    "Sushi Nakamura",
    "Blue Bottle",
    "Taqueria El Sol",
    "Ramen Ichi",
    "Pizzeria Delfina",
    "Sweetgreen",
    "Bagel Co.",
    "Curry House",
  ];
  const TRANSPORT = ["Shell", "Uber", "Metro Card", "Parking Garage"];
  const FUN = ["Cinemark", "Steam", "Concert Hall", "Museum of Art", "Bowling Alley"];

  for (let mi = 0; mi < n; mi++) {
    const m = months[mi];
    const dim = daysInMonth(m);

    add(m, 1, "expense", 2150, "Housing", "acc-checking", "Skyline Property Mgmt");
    add(m, 15, "income", 3850, "Salary", "acc-checking", "Northwind Labs");
    add(m, dim, "income", 3850, "Salary", "acc-checking", "Northwind Labs");
    add(m, 3, "expense", 45, "Subscriptions", "acc-credit", "Iron Temple Gym");
    add(m, 5, "expense", 79.99, "Utilities", "acc-credit", "Fiberline Internet");
    add(m, 8, "expense", 56.5, "Utilities", "acc-credit", "Cellular Plus");
    add(m, 12, "expense", 142, "Insurance", "acc-checking", "SafeDrive Insurance");
    add(m, 14, "expense", 12.99, "Subscriptions", "acc-credit", "Spotify");
    add(m, 20, "expense", 17.99, "Subscriptions", "acc-credit", "Netflix");
    add(m, 22, "expense", 2.99, "Subscriptions", "acc-credit", "iCloud Storage");
    add(m, randInt(rng, 15, 22), "expense", rand(rng, 85, 215), "Utilities", "acc-checking", "City Power & Water");

    const groceryRuns = randInt(rng, 3, 4);
    for (let g = 0; g < groceryRuns; g++) {
      add(m, randInt(rng, 1, dim), "expense", rand(rng, 82, 189), "Groceries", chance(rng, 0.7) ? "acc-credit" : "acc-checking", pick(rng, GROCERS));
    }

    const diningCount = randInt(rng, 5, 9);
    for (let d = 0; d < diningCount; d++) {
      add(m, randInt(rng, 1, dim), "expense", rand(rng, 13, 76), "Dining", "acc-credit", pick(rng, DINERS));
    }

    const transportCount = randInt(rng, 2, 4);
    for (let t = 0; t < transportCount; t++) {
      add(m, randInt(rng, 1, dim), "expense", rand(rng, 30, 88), "Transport", "acc-credit", pick(rng, TRANSPORT));
    }

    const funCount = randInt(rng, 0, 3);
    for (let f = 0; f < funCount; f++) {
      add(m, randInt(rng, 1, dim), "expense", rand(rng, 16, 96), "Entertainment", "acc-credit", pick(rng, FUN));
    }

    const shopCount = randInt(rng, 1, 3);
    for (let s = 0; s < shopCount; s++) {
      add(m, randInt(rng, 1, dim), "expense", rand(rng, 24, 245), "Shopping", "acc-credit", pick(rng, ["Amazon", "Uniqlo", "IKEA", "Nike Store"]));
    }

    if (chance(rng, 0.35)) {
      add(m, randInt(rng, 1, dim), "expense", rand(rng, 18, 138), "Health", "acc-credit", pick(rng, ["CVS Pharmacy", "Bright Smile Dental", "CityMD"]));
    }
    if (chance(rng, 0.22)) {
      add(m, randInt(rng, 1, dim), "expense", rand(rng, 380, 1450), "Travel", "acc-credit", pick(rng, ["Delta Air Lines", "Airbnb", "Marriott Hotels"]), "Trip");
    }
    if (chance(rng, 0.08)) {
      add(m, randInt(rng, 1, dim), "expense", rand(rng, 3, 38), "Fees", "acc-checking", pick(rng, ["ATM Fee", "Foreign Txn Fee", "Late Fee"]));
    }
    if (chance(rng, 0.45)) {
      add(m, randInt(rng, 1, dim), "income", rand(rng, 320, 1240), "Freelance", "acc-checking", pick(rng, ["Upwork Client", "Design Retainer", "Consulting LLC"]));
    }
    if (m.endsWith("-03") || m.endsWith("-06") || m.endsWith("-09") || m.endsWith("-12")) {
      add(m, randInt(rng, 5, 12), "income", rand(rng, 62, 188), "Dividends", "acc-savings", "Vanguard Brokerage");
    }
    add(m, 28, "income", rand(rng, 118, 176), "Interest", "acc-savings", "Ally Bank");
    if (chance(rng, 0.5)) {
      add(m, randInt(rng, 1, dim), "expense", rand(rng, 60, 400), "Other", "acc-cash", "ATM Withdrawal");
    }
  }

  transactions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const budgets: Budget[] = SAMPLE_BUDGETS.map((b) => ({ ...b }));

  return {
    accounts: [...accounts, ...investmentAccounts],
    transactions,
    holdings,
    budgets,
    categories: [...EXPENSE_CATEGORIES],
    recurring: [],
  };
}
