import { currentMonthKey } from "./format";

export type TxnType = "income" | "expense" | "transfer";

export type AccountKind =
  | "checking"
  | "savings"
  | "cash"
  | "investment"
  | "crypto"
  | "pension"
  | "property"
  | "credit"
  | "loan";

/**
 * Tax treatment of an account. Deliberately separate from `AccountKind`: the
 * two are orthogonal, since a TFSA may be a cash savings account or a
 * portfolio of ETFs. Folding them into one list would force the cross product
 * ("TFSA savings", "TFSA investment", …).
 */
export type Registration =
  | "TFSA"
  | "RRSP"
  | "FHSA"
  | "Pension"
  | "non-registered";

export interface MonthlyPoint {
  month: string; // YYYY-MM
  value: number;
  /**
   * True when nobody entered this figure — the app worked it out.
   *
   * Only a defined benefit pension has one so far: its value cannot be
   * derived, so a month the user skips is filled with the contributions made
   * since the last real figure. Marked rather than silently mixed in, because
   * a guess and a statement from the plan are not the same kind of number,
   * and the next real figure replaces it.
   */
  estimated?: boolean;
}

export interface Account {
  id: string;
  name: string;
  institution: string;
  kind: AccountKind;
  balance: number; // assets >= 0, liabilities stored as positive amount owed
  /**
   * US-dollar cash, for accounts that hold it. Kept separate from `balance`
   * rather than converted on the way in: the rate on the day it settles is not
   * the rate today, and a USD listing is paid for out of this side.
   */
  balanceUSD?: number;
  history: MonthlyPoint[];
  /** Tax treatment. Undefined for kinds where it does not apply. */
  registration?: Registration;
  /**
   * What a defined benefit plan's statement says, for the pension you keep
   * rather than the lump sum you could leave with: the annual pension earned
   * so far, and the years of service that earned it. Both optional, both
   * entered by hand, both meaningless on any other kind of account.
   */
  pensionAnnual?: number;
  pensionService?: number;
}

/**
 * An account with its current balance recorded against a month.
 *
 * Editing a balance is a statement about now, so it writes one month and
 * leaves the rest of the record alone. The version this replaced rebuilt the
 * series as the last eighteen months, backfilling anything missing with the
 * earliest value on record — so a single edit threw away the six years the
 * chequing account carries and invented five months that never happened.
 */
export function withBalanceRecorded(
  acc: Account,
  month = currentMonthKey(),
): Account {
  const history = acc.history.filter((p) => p.month !== month);
  history.push({ month, value: acc.balance });
  history.sort((a, b) => a.month.localeCompare(b.month));
  return { ...acc, history };
}

/**
 * Money always moves from somewhere to somewhere. One side is an account you
 * own; the other is either another of your accounts (a transfer) or the
 * outside world, named by `payee`.
 *
 *   expense  — sourceAccountId set, destination outside (payee)
 *   income   — destinationAccountId set, source outside (payee)
 *   transfer — both set; nothing enters or leaves your net worth
 */
export interface Transaction {
  id: string;
  date: string; // YYYY-MM-DD
  type: TxnType;
  amount: number; // always positive
  category: string;
  /** Account the money left, when it left one of yours. */
  sourceAccountId?: string;
  /** Account the money arrived in, when it arrived in one of yours. */
  destinationAccountId?: string;
  /** The outside party, for income and expenses. */
  payee: string;
  note?: string;
  /** Set when this row was generated from a recurring rule. */
  recurringId?: string;
}

export type AssetClass = "US Equity" | "Intl Equity" | "Bonds" | "Crypto";

export type Currency = "CAD" | "USD";

/**
 * One dated movement of money in or out of a position, in CAD.
 *
 * `shares` is the quantity the flow moved: positive on a buy, negative on a
 * sale, zero for a dividend. `amount` is always the cash that changed hands,
 * unsigned — the kind carries the direction.
 */
export interface CashFlow {
  date: string; // YYYY-MM-DD
  kind: "buy" | "sell" | "dividend";
  amount: number; // CAD, unsigned
  shares: number;
  /**
   * Units that arrived as a staking reward whose value on the day is not yet
   * known.
   *
   * A reward is two things at once: income equal to what the tokens were worth
   * when they landed, and an acquisition of those tokens at that same value.
   * The second half is what keeps the cost base right — the amount is taxed
   * once as income, and because it is also the cost, it is not taxed again as
   * a gain on the way out.
   *
   * Recording the units at nothing drops the income and turns the whole future
   * disposal into a gain. So a reward with no price yet is written as the
   * acquisition alone, flagged here, and listed for the figure to be filled in
   * rather than left to look like a free lunch.
   */
  awaitingPrice?: boolean;
}

export interface Holding {
  id: string;
  ticker: string;
  name: string;
  assetClass: AssetClass;
  shares: number;
  avgCost: number; // in listing currency
  price: number; // current price in listing currency
  history: number[]; // monthly prices in listing currency, last entry === price
  dividendsReceived: number; // total dividends in listing currency
  /** The investment account this position is held in. */
  accountId: string;
  currency: Currency;
  /** Price converted to CAD. Same as price when currency is CAD. */
  priceCAD: number;
  /** Average cost converted to CAD. Same as avgCost when currency is CAD. */
  avgCostCAD: number;
  /** Dividends converted to CAD. Same as dividendsReceived when currency is CAD. */
  dividendsReceivedCAD: number;
  /** Monthly prices converted to CAD. Same as history when currency is CAD. */
  historyCAD: number[];
  /**
   * Every buy, sell and dividend, in CAD, with its date. Empty for positions
   * entered by hand, which have no trade history to replay — realized gain and
   * MWRR are then unknown rather than zero.
   */
  flows: CashFlow[];
}

export const REGISTRATIONS: Registration[] = [
  "non-registered",
  "TFSA",
  "RRSP",
  "FHSA",
  "Pension",
];

export const REGISTRATION_LABELS: Record<Registration, string> = {
  "non-registered": "Non-registered",
  TFSA: "TFSA",
  RRSP: "RRSP",
  FHSA: "FHSA",
  Pension: "Pension",
};

export const CURRENCIES: Currency[] = ["CAD", "USD"];

export interface Budget {
  category: string;
  limit: number;
}

export type RecurrenceFrequency =
  | "weekly"
  | "biweekly"
  | "monthly"
  | "quarterly"
  | "yearly";

export const RECURRENCE_FREQUENCIES: RecurrenceFrequency[] = [
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "yearly",
];

export const RECURRENCE_LABELS: Record<RecurrenceFrequency, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

/**
 * A template that posts transactions on a schedule. The rule owns `nextDate`,
 * which is advanced past every occurrence it posts, so catching up after the
 * app has not been opened for a while is just a loop.
 */
export interface RecurringRule {
  id: string;
  type: TxnType;
  amount: number;
  category: string;
  sourceAccountId?: string;
  destinationAccountId?: string;
  payee: string;
  note?: string;
  frequency: RecurrenceFrequency;
  /** First occurrence. */
  startDate: string; // YYYY-MM-DD
  /** Last date the rule may post on, if the user set one. */
  endDate?: string; // YYYY-MM-DD
  /** Next occurrence still to be posted. */
  nextDate: string; // YYYY-MM-DD
  active: boolean;
}

export interface FinanceData {
  accounts: Account[];
  transactions: Transaction[];
  holdings: Holding[];
  budgets: Budget[];
  /** User-managed expense categories (managed on the Budgets page). */
  categories: string[];
  recurring: RecurringRule[];
}

export const ACCOUNT_KINDS: AccountKind[] = [
  "checking",
  "savings",
  "cash",
  "investment",
  "crypto",
  "pension",
  "property",
  "credit",
  "loan",
];

export const LIABILITY_KINDS: AccountKind[] = ["credit", "loan"];

export const ACCOUNT_KIND_LABELS: Record<AccountKind, string> = {
  checking: "Checking",
  savings: "Savings",
  cash: "Cash",
  investment: "Investment",
  crypto: "Crypto",
  pension: "Pension",
  property: "Property",
  credit: "Credit Card",
  loan: "Loan",
};

/**
 * Kinds that hold positions rather than only cash, and so can be a holding's
 * account. A crypto wallet or exchange account works the same way as a
 * brokerage: its balance is the uninvested cash sitting in it, and the coins
 * are valued from the holdings.
 */
export const INVESTMENT_KINDS: AccountKind[] = ["investment", "crypto"];

/**
 * A defined benefit pension, which is not an account holding money.
 *
 * What it holds is a promise: an income stream earned by service, whose only
 * cash figure is the transfer value — the lump sum payable if you left, which
 * moves with interest rates as much as with what you put in. That figure
 * belongs in net worth, since it is yours, but it is not spendable and it must
 * not be stacked in beside chequing: on this record the pension is nine
 * tenths of what the balance sheet called "assets", which made $3,628 of
 * actual cash read as $41,118.
 *
 * So it is its own kind, drawn in its own band, and left out of every figure
 * that means "money you could use".
 */
export function isPension(kind: AccountKind): boolean {
  return kind === "pension";
}

/**
 * Registration is meaningless for debts and for property, so it is only
 * offered on the kinds that can actually be sheltered.
 */
export function supportsRegistration(kind: AccountKind): boolean {
  return !isLiability(kind) && kind !== "property";
}

export function isInvestmentAccount(kind: AccountKind): boolean {
  return INVESTMENT_KINDS.includes(kind);
}

export const ASSET_CLASSES: AssetClass[] = [
  "US Equity",
  "Intl Equity",
  "Bonds",
  "Crypto",
];

export const EXPENSE_CATEGORIES = [
  "Housing",
  "Groceries",
  "Dining",
  "Transport",
  "Utilities",
  "Subscriptions",
  "Entertainment",
  "Shopping",
  "Health",
  "Travel",
  "Insurance",
  "Fees",
  "Other",
] as const;

export const INCOME_CATEGORIES = [
  "Salary",
  "Additional Income",
  "Freelance",
  "RSP / Pension",
  "Dividends",
  "Interest",
  "Refund",
  "Loan Proceeds",
  "Gifts",
  "Other",
] as const;

/** Category given to transfers, which are not spending and not income. */
export const TRANSFER_CATEGORY = "Transfer";

/**
 * The same categories, in the order a dropdown should show them.
 *
 * The lists themselves stay in their written order, because the first entry of
 * each is the default a new transaction opens on — Housing and Salary, not
 * whatever happens to sort first. Sorting is a display concern, so it happens
 * here, at the point of display.
 */
export function alphabetical(categories: readonly string[]): string[] {
  return [...categories].sort((a, b) => a.localeCompare(b));
}

export function categoriesFor(type: TxnType): readonly string[] {
  if (type === "transfer") return [TRANSFER_CATEGORY];
  return type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
}

export function isLiability(kind: AccountKind): boolean {
  return LIABILITY_KINDS.includes(kind);
}

/**
 * How `amount` moves an account's stored figure.
 *
 * Assets fall when money leaves and rise when it arrives. Liabilities store
 * what is owed, so the signs invert: spending on a credit card (the card is
 * the source) increases the debt, and paying the card off (the card is the
 * destination) reduces it.
 */
export function balanceDelta(
  kind: AccountKind,
  side: "source" | "destination",
  amount: number,
): number {
  const outgoing = side === "source";
  const sign = isLiability(kind) === outgoing ? 1 : -1;
  return amount * sign;
}

/** Transfers move money between your own accounts, so they are not spending. */
export function isSpending(t: Transaction): boolean {
  return t.type === "expense";
}

/** …and they are not income either. Both charts must exclude them. */
export function isEarning(t: Transaction): boolean {
  return t.type === "income";
}

/** True when the transaction touches the given account on either side. */
export function touchesAccount(t: Transaction, accountId: string): boolean {
  return t.sourceAccountId === accountId || t.destinationAccountId === accountId;
}

/**
 * Where the money came from and where it went, as display labels. The side
 * that is not one of your accounts is the outside world, named by `payee`.
 */
export function transactionEndpoints(
  t: Pick<Transaction, "sourceAccountId" | "destinationAccountId" | "payee">,
  nameOf: (id: string) => string,
): { from: string; to: string } {
  return {
    from: t.sourceAccountId ? nameOf(t.sourceAccountId) : t.payee,
    to: t.destinationAccountId ? nameOf(t.destinationAccountId) : t.payee,
  };
}

/**
 * Put an account on the side its transaction type implies. For everything
 * that is not a transfer, exactly one side is an account of yours.
 */
export function sidesFor(
  type: TxnType,
  accountId: string,
): Pick<Transaction, "sourceAccountId" | "destinationAccountId"> {
  return type === "income"
    ? { destinationAccountId: accountId }
    : { sourceAccountId: accountId };
}

/** The account of yours a transaction most centrally concerns. */
export function primaryAccountId(t: Transaction): string | undefined {
  return t.type === "income"
    ? t.destinationAccountId
    : t.sourceAccountId ?? t.destinationAccountId;
}

export interface MonthlySnapshot {
  month: string; // YYYY-MM
  holdingId: string;
  ticker: string;
  price: number;
  avgCost: number;
  shares: number;
  value: number;
  valueCAD: number;
}

export const HISTORY_MONTHS = 18;
