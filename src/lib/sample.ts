import {
  Account,
  Budget,
  CashFlow,
  EXPENSE_CATEGORIES,
  FinanceData,
  Holding,
  RecurringRule,
  Transaction,
  TRANSFER_CATEGORY,
} from "./types";
import { lastMonthKeys } from "./format";
import { replayFlows } from "./flows";

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
        /*
         * A little uninvested US cash, so the accounts page has a balance that
         * is two currencies at once rather than one — which is the case the
         * combined figure exists for.
         */
        balanceUSD: 1240.55,
      },
    ]
  ).map((a) => ({
    ...a,
    institution: "Questrade",
    kind: "investment" as const,
    balance: 0,
    history: months.map((month) => ({ month, value: 0 })),
  }));

  /*
   * A defined benefit pension, which is neither cash nor a portfolio.
   *
   * It gets its own band on the net-worth composition chart and is left out of
   * everything that means "money you could use", so a sample without one never
   * shows either behaviour — and the accounts page's pension card, with the
   * annual figure and the years behind it, has nothing to draw.
   */
  const pensionValues = walk(rng, n, 46000, 88000, 900);
  const pensionAccount: Account = {
    id: "acc-pension",
    name: "Ironwood Pension Plan",
    institution: "Ironwood Retirement Services",
    kind: "pension",
    registration: "Pension",
    balance: pensionValues[n - 1],
    history: months.map((month, i) => ({ month, value: pensionValues[i] })),
    pensionAnnual: 14800,
    pensionService: 9.5,
  };

  // ---------- holdings ----------
  interface Seed {
    ticker: string;
    name: string;
    assetClass: Holding["assetClass"];
    shares: number;
    /** Unused: every cost base is replayed from the trades built below. */
    avgCost: number;
    price: number;
    drift: number; // total growth factor over window
    vol: number;
    dividends: number; // total cash dividends received over the window
  }
  const FX = 1.37; // sample USD/CAD rate
  /*
   * Invented securities, not real ones — and a deliberately ordinary shape.
   *
   * The sample is a fiction from end to end and reads nobody's records, but a
   * demo that happens to *look* like the real portfolio is nearly as bad as
   * one that copies it: a screenshot is then hard to tell from a statement.
   * So the names are made up and the composition is chosen to be the textbook
   * one rather than anyone's in particular — an index fund at the centre, a
   * bond fund beside it, a handful of single names, and crypto as a rounding
   * error rather than the largest thing owned.
   */
  const seeds: (Seed & { currency: "CAD" | "USD" })[] = [
    { ticker: "MTMX", name: "Meridian Total Market Index", assetClass: "US Equity", shares: 148, avgCost: 0, price: 292.15, drift: 1.22, vol: 0.045, dividends: 402.10, currency: "USD" },
    { ticker: "NGIX", name: "Northgate International Index", assetClass: "Intl Equity", shares: 210, avgCost: 0, price: 66.84, drift: 1.16, vol: 0.055, dividends: 288.40, currency: "USD" },
    { ticker: "KCBF", name: "Kestrel Core Bond Fund", assetClass: "Bonds", shares: 165, avgCost: 0, price: 72.92, drift: 1.01, vol: 0.018, dividends: 431.75, currency: "USD" },
    { ticker: "HLCN", name: "Halcyon Systems", assetClass: "US Equity", shares: 24, avgCost: 0, price: 231.44, drift: 1.34, vol: 0.075, dividends: 61.20, currency: "USD" },
    { ticker: "VNTR", name: "Vantara Software", assetClass: "US Equity", shares: 11, avgCost: 0, price: 418.92, drift: 1.41, vol: 0.07, dividends: 39.60, currency: "USD" },
    { ticker: "ORBS", name: "Orbital Semiconductor", assetClass: "US Equity", shares: 14, avgCost: 0, price: 174.22, drift: 1.62, vol: 0.12, dividends: 8.40, currency: "USD" },
    { ticker: "RVBD", name: "Riverbend Retail Group", assetClass: "US Equity", shares: 16, avgCost: 0, price: 186.53, drift: 1.28, vol: 0.085, dividends: 0, currency: "USD" },
    { ticker: "LMNH", name: "Lumen Media Holdings", assetClass: "US Equity", shares: 13, avgCost: 0, price: 191.34, drift: 1.19, vol: 0.08, dividends: 0, currency: "USD" },
    { ticker: "ARDM", name: "Ardent Motors", assetClass: "US Equity", shares: 9, avgCost: 0, price: 232.11, drift: 0.94, vol: 0.13, dividends: 0, currency: "USD" },
    /*
     * A deliberately small position. Crypto is the whole story in some real
     * portfolios; making it the whole story here too would mean the demo and
     * the real thing had the same silhouette, which is what this is avoiding.
     */
    { ticker: "NMBT", name: "Nimbus Token", assetClass: "Crypto", shares: 0.06, avgCost: 0, price: 91400, drift: 1.55, vol: 0.16, dividends: 0, currency: "USD" },
  ];

  /*
   * A position that was closed: bought, held, and sold in full partway through
   * the window.
   *
   * Without one the investments page has no realized gain to report, "Positions
   * you closed" is an empty column, the tax page has no disposal to list and
   * the closed-positions toggle on the holdings table hides nothing. It is
   * non-registered on purpose — a sale inside a shelter is not reportable, so
   * a sheltered one would leave the tax page just as empty.
   */
  const CLOSED: Seed & { currency: "CAD" | "USD" } = {
    ticker: "FRGX",
    name: "Frontier Growth Fund",
    assetClass: "US Equity",
    shares: 0,
    avgCost: 0,
    price: 52.4,
    /*
     * Bought high and sold low. A closed position that broke even says
     * nothing, and a loss is the more useful one to draw: it is what puts a
     * figure in the middle column of "where the money stands", gives the tax
     * page a disposal worth reporting, and shows the realized and unrealized
     * halves of a return disagreeing — which is the whole reason that card
     * splits them.
     */
    drift: 0.72,
    vol: 0.11,
    dividends: 0,
    currency: "USD",
  };

  /** Positions trimmed but not closed, so a gain can be realized and open at once. */
  const TRIMMED = new Set(["ORBS", "HLCN"]);

  /**
   * The trades that built a position, in CAD.
   *
   * Flows are the record every return figure is worked out from — realized
   * gain, money-weighted return, the cost line under the portfolio chart, and
   * now the trade rows on the transactions page. A sample with none of them
   * leaves all of that blank, which is why these are generated rather than
   * left empty, and why the position's own numbers are read back off them
   * instead of being stated twice.
   */
  const buildFlows = (
    s: Seed & { currency: "CAD" | "USD" },
    /** The security's own monthly price series, in its listing currency. */
    prices: number[],
    monthsBack: number,
    closeAt: number | null,
  ): CashFlow[] => {
    const flows: CashFlow[] = [];
    const fx = s.currency === "USD" ? FX : 1;
    const start = Math.max(0, n - monthsBack);
    /* Three or four buys, so the cost base is an average of several prices. */
    const buyCount = randInt(rng, 3, 4);
    const trim = TRIMMED.has(s.ticker);
    /*
     * A trimmed position was bought larger than it is now, so the extra shares
     * are bought and then sold — which leaves the share count where the seed
     * says while putting a realized gain on a position that is still open.
     */
    const extra = trim ? round2(s.shares * 0.3) : 0;
    const target = (s.shares > 0 ? s.shares : rand(rng, 40, 120)) + extra;
    let bought = 0;
    for (let b = 0; b < buyCount; b++) {
      const at = Math.min(n - 2, start + b * Math.floor((n - start) / buyCount));
      const qty =
        b === buyCount - 1
          ? round2(target - bought)
          : round2((target / buyCount) * rand(rng, 0.8, 1.2));
      if (qty <= 0) continue;
      bought = round2(bought + qty);
      /*
       * Priced from the security's own history, not from a line drawn between
       * its first and last price. Those were two independent series: a buy
       * could be booked at 337 in a month the chart drew at 386, so the cost
       * base belonged to a price the security never had — and for a volatile
       * position it put cost above value for most of the window, which is a
       * portfolio nobody would recognise.
       */
      const px = prices[at];
      flows.push({
        date: iso(months[at], randInt(rng, 3, 26)),
        kind: "buy",
        amount: round2(qty * px * fx),
        shares: qty,
      });
    }
    /* Quarterly distributions for the positions that actually pay them. */
    if (s.dividends > 0) {
      const each = round2((s.dividends * fx) / 6);
      for (let q = 0; q < 6; q++) {
        const at = Math.min(n - 2, start + 2 + q * 3);
        flows.push({
          date: iso(months[at], randInt(rng, 4, 18)),
          kind: "dividend",
          amount: each,
          shares: 0,
        });
      }
    }
    if (trim) {
      const at = n - randInt(rng, 3, 7);
      flows.push({
        date: iso(months[at], randInt(rng, 5, 24)),
        kind: "sell",
        amount: round2(extra * prices[at] * fx),
        shares: -extra,
      });
    }
    if (closeAt !== null) {
      flows.push({
        date: iso(months[closeAt], randInt(rng, 5, 24)),
        kind: "sell",
        amount: round2(bought * prices[closeAt] * fx),
        shares: -bought,
      });
    }
    return flows.sort((a, b) => a.date.localeCompare(b.date));
  };

  const holdings: Holding[] = [...seeds, CLOSED].map((s, idx) => {
    const closed = s === CLOSED;
    /* The price series comes first: the trades below are priced from it. */
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
    const flows = buildFlows(
      s,
      norm,
      closed ? 14 : randInt(rng, 12, 18),
      closed ? n - 4 : null,
    );
    /*
     * The position read back off its own trades, which is what makes the two
     * agree: the holdings table, the exposure ring and the trade rows on the
     * transactions page are then three views of one record rather than three
     * numbers that happen to be near each other.
     */
    const replayed = replayFlows(flows);
    const isUSD = s.currency === "USD";
    /*
     * The replay works in the currency the flows are stated in, which is CAD.
     * For a US listing that is the CAD cost base; the listing-currency figure
     * beside it is the same number back through the rate.
     */
    const avgCostCAD = replayed.avgCost;
    const dividendsCAD = replayed.dividends;
    return {
      id: `hold-${idx + 1}`,
      ticker: s.ticker,
      name: s.name,
      assetClass: s.assetClass,
      shares: replayed.shares,
      avgCost: isUSD ? round2(avgCostCAD / FX) : avgCostCAD,
      price: s.price,
      history: norm,
      dividendsReceived: isUSD ? round2(dividendsCAD / FX) : dividendsCAD,
      accountId: closed
        ? "acc-nonreg"
        : idx % 3 === 0
          ? "acc-tfsa"
          : idx % 3 === 1
            ? "acc-rrsp"
            : "acc-nonreg",
      currency: s.currency,
      priceCAD: isUSD ? round2(s.price * FX) : s.price,
      avgCostCAD,
      dividendsReceivedCAD: dividendsCAD,
      historyCAD: isUSD ? norm.map((v) => round2(v * FX)) : norm,
      flows,
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

  /** Money moving between two accounts you own, which is neither side of a total. */
  const move = (
    month: string,
    day: number,
    amount: number,
    from: string,
    to: string,
    payee: string,
  ) => {
    tid += 1;
    transactions.push({
      id: `txn-${String(tid).padStart(4, "0")}`,
      date: iso(month, day),
      type: "transfer",
      amount: round2(amount),
      category: TRANSFER_CATEGORY,
      sourceAccountId: from,
      destinationAccountId: to,
      payee,
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

    /*
     * The rest of what income can be.
     *
     * Salary, freelance and interest alone leave the income page a two-colour
     * chart and the "every source" table three rows long, and none of the
     * behaviour worth showing appears: a pension contribution that never
     * reaches an account you can spend from, a refund that is not earnings, or
     * borrowed money — which arrives like income and is not, and is the case
     * the page most needs to demonstrate.
     */
    add(m, 15, "income", 640, "RSP / Pension", "acc-pension", "Employer contribution");
    if (chance(rng, 0.25)) {
      add(m, randInt(rng, 1, dim), "income", rand(rng, 45, 260), "Refund", "acc-credit", pick(rng, ["Amazon", "Delta Air Lines", "Uniqlo"]), "Returned");
    }
    if (chance(rng, 0.16)) {
      add(m, randInt(rng, 1, dim), "income", rand(rng, 100, 500), "Gifts", "acc-checking", pick(rng, ["Mum", "Grandparents"]));
    }
    if (chance(rng, 0.14)) {
      add(m, randInt(rng, 1, dim), "income", rand(rng, 180, 900), "Additional Income", "acc-checking", pick(rng, ["Marketplace sale", "Referral bonus", "Rebate"]));
    }

    /*
     * Paying down the auto loan. Excluded from every spending total on the
     * expenses page — it is money crossing the balance sheet rather than money
     * spent — which is a rule nothing in the sample exercised before.
     */
    add(m, 2, "expense", 412.18, "Debt Repayment", "acc-checking", "Toyota Financial", "Auto loan");

    /* Two of your own accounts, so the transfer filter has something to find. */
    move(m, 16, 900, "acc-checking", "acc-savings", "To savings");
    if (chance(rng, 0.4)) {
      move(m, randInt(rng, 18, 26), rand(rng, 300, 1200), "acc-checking", "acc-nonreg", "To brokerage");
    }
  }

  /*
   * One month in the middle carries a loan advance: a large sum arriving that
   * is not earnings, which is exactly what the income page excludes and the
   * guide explains.
   */
  if (n > 8) {
    add(months[Math.floor(n / 2)], 9, "income", 14000, "Loan Proceeds", "acc-checking", "Toyota Financial", "Car loan advance");
  }

  transactions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const budgets: Budget[] = SAMPLE_BUDGETS.map((b) => ({ ...b }));

  /*
   * Standing rules, so the recurring card is not an empty invitation. Dated
   * from the start of the window with the next occurrence ahead of the record,
   * so nothing posts itself the moment the sample is loaded.
   */
  const firstDay = `${months[0]}-01`;
  const nextMonth = (key: string) => {
    const [y, mo] = key.split("-").map(Number);
    return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  };
  const after = nextMonth(months[n - 1]);
  const recurring: RecurringRule[] = [
    {
      id: "rec-demo-rent",
      type: "expense",
      amount: 2150,
      category: "Housing",
      sourceAccountId: "acc-checking",
      payee: "Skyline Property Mgmt",
      frequency: "monthly",
      startDate: firstDay,
      nextDate: `${after}-01`,
      active: true,
    },
    {
      id: "rec-demo-salary",
      type: "income",
      amount: 3850,
      category: "Salary",
      destinationAccountId: "acc-checking",
      payee: "Northwind Labs",
      frequency: "biweekly",
      startDate: firstDay,
      nextDate: `${after}-01`,
      active: true,
    },
    {
      id: "rec-demo-savings",
      type: "transfer",
      amount: 900,
      category: TRANSFER_CATEGORY,
      sourceAccountId: "acc-checking",
      destinationAccountId: "acc-savings",
      payee: "To savings",
      frequency: "monthly",
      startDate: firstDay,
      nextDate: `${after}-16`,
      active: true,
    },
    {
      id: "rec-demo-loan",
      type: "expense",
      amount: 412.18,
      category: "Debt Repayment",
      sourceAccountId: "acc-checking",
      payee: "Toyota Financial",
      note: "Auto loan",
      frequency: "monthly",
      startDate: firstDay,
      nextDate: `${after}-02`,
      active: true,
    },
  ];

  return {
    accounts: [...accounts, ...investmentAccounts, pensionAccount],
    transactions,
    holdings,
    budgets,
    categories: [...EXPENSE_CATEGORIES],
    recurring,
  };
}

/** One month-end record of what a position was worth. */
export interface SampleSnapshot {
  month: string;
  holdingId: string;
  ticker: string;
  price: number;
  avgCost: number;
  shares: number;
  value: number;
  valueCAD: number;
}

/**
 * Month-end valuations for the sample portfolio.
 *
 * Without these every chart of the portfolio over time is a straight line at
 * book cost: the app values a past month from the record the user kept, and
 * falls back to cost when there is none — so a demo with no snapshots shows no
 * growth, no gap between value and cost, and no time-weighted return, however
 * good the price history on the holdings is.
 *
 * Built from the same flows the positions are, so what a month says the
 * portfolio was worth is the share count actually held that month at that
 * month's price. Months a position was not held in are left out rather than
 * recorded as zero, which is the difference between "held nothing" and
 * "nobody wrote it down".
 */
export function generateSampleSnapshots(
  holdings: Holding[],
  fx = 1.37,
): SampleSnapshot[] {
  const months = lastMonthKeys(18);
  const out: SampleSnapshot[] = [];
  for (const h of holdings) {
    // The month in progress is not a month-end, so the record stops before it.
    months.slice(0, -1).forEach((month, i) => {
      const upto = (h.flows ?? []).filter((f) => f.date.slice(0, 7) <= month);
      if (upto.length === 0) return;
      const { shares, avgCost } = replayFlows(upto);
      if (shares <= 0) return;
      const price = h.history[i] ?? h.price;
      const priceCAD = h.historyCAD[i] ?? h.priceCAD;
      const isUSD = h.currency === "USD";
      out.push({
        month,
        holdingId: h.id,
        ticker: h.ticker,
        price,
        avgCost: isUSD ? round2(avgCost / fx) : avgCost,
        shares,
        value: round2(shares * price),
        valueCAD: round2(shares * priceCAD),
      });
    });
  }
  return out;
}
