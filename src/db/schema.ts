import type { CashFlow } from "@/lib/types";
import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
} from "drizzle-orm/pg-core";
import type { MonthlyPoint } from "@/lib/types";

/*
 * Money is stored as Postgres `numeric`, never `double precision`: binary
 * floats cannot represent values like 0.10 exactly, and the error compounds
 * across the repeated sums/FX conversions this app does. `mode: "number"`
 * keeps the TypeScript domain types as plain `number` while the database
 * holds an exact decimal and rounds writes to the declared scale.
 *
 * Scales:
 *   money      (18, 2)  — balances, amounts, budgets, portfolio values
 *   unit price (20, 8)  — per-share/per-coin prices and average costs
 *   quantity   (28, 10) — share counts, incl. fractional crypto
 */
const money = (name: string) => numeric(name, { precision: 18, scale: 2, mode: "number" });
const unitPrice = (name: string) => numeric(name, { precision: 20, scale: 8, mode: "number" });
const quantity = (name: string) => numeric(name, { precision: 28, scale: 10, mode: "number" });

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  institution: text("institution").notNull().default("—"),
  kind: text("kind").notNull(),
  balance: money("balance").notNull().default(0),
  history: jsonb("history").$type<MonthlyPoint[]>().notNull(),
  position: integer("position").notNull().default(0),
  /** Tax treatment; null for kinds where it does not apply. */
  registration: text("registration"),
});

export const transactions = pgTable("transactions", {
  id: text("id").primaryKey(),
  date: date("date", { mode: "string" }).notNull(),
  type: text("type").notNull(),
  amount: money("amount").notNull(),
  category: text("category").notNull(),
  // Nullable on purpose: an expense has no destination account and income has
  // no source account — that side of the transaction is the outside world.
  sourceAccountId: text("source_account_id"),
  destinationAccountId: text("destination_account_id"),
  payee: text("payee").notNull(),
  note: text("note"),
  recurringId: text("recurring_id"),
});

export const recurringTransactions = pgTable("recurring_transactions", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  amount: money("amount").notNull(),
  category: text("category").notNull(),
  sourceAccountId: text("source_account_id"),
  destinationAccountId: text("destination_account_id"),
  payee: text("payee").notNull(),
  note: text("note"),
  frequency: text("frequency").notNull(),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }),
  nextDate: date("next_date", { mode: "string" }).notNull(),
  active: boolean("active").notNull().default(true),
  position: integer("position").notNull().default(0),
});

export const holdings = pgTable("holdings", {
  id: text("id").primaryKey(),
  ticker: text("ticker").notNull(),
  name: text("name").notNull(),
  assetClass: text("asset_class").notNull(),
  shares: quantity("shares").notNull(),
  avgCost: unitPrice("avg_cost").notNull(),
  price: unitPrice("price").notNull(),
  history: jsonb("history").$type<number[]>().notNull(),
  dividendsReceived: money("dividends_received").notNull().default(0),
  /** The investment account holding this position. */
  accountId: text("account_id").notNull(),
  currency: text("currency").notNull().default("USD"),
  priceCAD: unitPrice("price_cad").notNull().default(0),
  avgCostCAD: unitPrice("avg_cost_cad").notNull().default(0),
  dividendsReceivedCAD: money("dividends_received_cad").notNull().default(0),
  historyCAD: jsonb("history_cad").$type<number[]>().notNull().default([]),
  /** Dated buys, sells and dividends — the basis for realized gain and MWRR. */
  flows: jsonb("flows").$type<CashFlow[]>().notNull().default([]),
  position: integer("position").notNull().default(0),
});

export const budgets = pgTable("budgets", {
  category: text("category").primaryKey(),
  max: money("max").notNull(),
});

export const categories = pgTable("categories", {
  name: text("name").primaryKey(),
  position: integer("position").notNull().default(0),
});

export const merchantRules = pgTable("merchant_rules", {
  merchant: text("merchant").primaryKey(),
  category: text("category").notNull(),
});

/*
 * Small key/value table for facts about the deployment itself rather than the
 * user's finances. It exists because some state cannot be inferred from the
 * rows: once the demo data is deleted the database may legitimately be empty,
 * and without a marker the first-run seed would put the demo data straight
 * back (see `src/db/init.ts`).
 */
export const appMeta = pgTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const monthlySnapshots = pgTable(
  "monthly_snapshots",
  {
    month: text("month").notNull(),
    holdingId: text("holding_id").notNull(),
    ticker: text("ticker").notNull(),
    price: unitPrice("price").notNull(),
    avgCost: unitPrice("avg_cost").notNull(),
    shares: quantity("shares").notNull(),
    value: money("value").notNull(),
    valueCAD: money("value_cad").notNull().default(0),
  },
  (t) => [
    primaryKey({
      name: "monthly_snapshots_pkey",
      columns: [t.month, t.holdingId],
    }),
  ],
);

/*
 * Monthly closing prices, one row per ticker per month, kept so the portfolio
 * can be valued at any month it was held rather than only over the eighteen
 * months of prices carried on the holding itself.
 *
 * Stored rather than fetched per page load because it is history: a close from
 * March 2023 is settled and will not change, so re-asking for it is pure waste.
 * Only the current month is ever refreshed.
 *
 * `close` is in the currency the symbol trades in, which `currency` records.
 * The USD→CAD rate is kept here too, under the ticker `USDCAD` — it is fetched
 * on the same request, keyed by the same month, and read on the same path, so
 * giving it a table of its own would only duplicate this one.
 */
export const priceHistory = pgTable(
  "price_history",
  {
    ticker: text("ticker").notNull(),
    /** Month key, "2024-03". */
    month: text("month").notNull(),
    close: unitPrice("close").notNull(),
    currency: text("currency").notNull().default("CAD"),
    /**
     * Where the figure came from: `snapshot` for one derived from the user's
     * own month-end records, `provider` for one fetched from a market feed.
     * A snapshot is the better source — it is what the position was actually
     * worth, not a reconstruction — so a provider write never overwrites one.
     */
    source: text("source").notNull().default("provider"),
  },
  (t) => [
    primaryKey({ name: "price_history_pkey", columns: [t.ticker, t.month] }),
  ],
);
