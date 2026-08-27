export type TxnType = "income" | "expense";

export type AccountKind =
  | "checking"
  | "savings"
  | "cash"
  | "property"
  | "credit"
  | "loan";

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
}

export interface Transaction {
  id: string;
  date: string; // YYYY-MM-DD
  type: TxnType;
  amount: number; // always positive
  category: string;
  accountId: string;
  payee: string;
  note?: string;
}

export type AssetClass = "US Equity" | "Intl Equity" | "Bonds" | "Crypto";

export type AccountType = "TFSA" | "RRSP" | "FHSA" | "non-registered";
export type Currency = "CAD" | "USD";

export interface Holding {
  id: string;
  ticker: string;
  name: string;
  assetClass: AssetClass;
  sector: string;
  shares: number;
  avgCost: number; // in listing currency
  price: number; // current price in listing currency
  history: number[]; // monthly prices in listing currency, last entry === price
  dividendsReceived: number; // total dividends in listing currency
  accountType: AccountType;
  currency: Currency;
  /** Price converted to CAD. Same as price when currency is CAD. */
  priceCAD: number;
  /** Average cost converted to CAD. Same as avgCost when currency is CAD. */
  avgCostCAD: number;
  /** Dividends converted to CAD. Same as dividendsReceived when currency is CAD. */
  dividendsReceivedCAD: number;
  /** Monthly prices converted to CAD. Same as history when currency is CAD. */
  historyCAD: number[];
}

export const ACCOUNT_TYPES: AccountType[] = ["TFSA", "RRSP", "FHSA", "non-registered"];
export const CURRENCIES: Currency[] = ["CAD", "USD"];

export interface Budget {
  category: string;
  limit: number;
}

export interface FinanceData {
  accounts: Account[];
  transactions: Transaction[];
  holdings: Holding[];
  budgets: Budget[];
  /** User-managed expense categories (managed on the Budgets page). */
  categories: string[];
}

export const LIABILITY_KINDS: AccountKind[] = ["credit", "loan"];

export const ACCOUNT_KIND_LABELS: Record<AccountKind, string> = {
  checking: "Checking",
  savings: "Savings",
  cash: "Cash",
  property: "Property",
  credit: "Credit Card",
  loan: "Loan",
};

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
  "Freelance",
  "Dividends",
  "Interest",
  "Refund",
  "Gifts",
  "Other",
] as const;

export function categoriesFor(type: TxnType): readonly string[] {
  return type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
}

export function isLiability(kind: AccountKind): boolean {
  return LIABILITY_KINDS.includes(kind);
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
