export type TxnType = "income" | "expense" | "transfer";

export type AccountKind =
  | "checking"
  | "savings"
  | "cash"
  | "investment"
  | "crypto"
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
}

export interface Account {
  id: string;
  name: string;
  institution: string;
  kind: AccountKind;
  balance: number; // assets >= 0, liabilities stored as positive amount owed
  history: MonthlyPoint[];
  /** Tax treatment. Undefined for kinds where it does not apply. */
  registration?: Registration;
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
