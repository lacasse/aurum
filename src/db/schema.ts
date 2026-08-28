import {
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
});

export const transactions = pgTable("transactions", {
  id: text("id").primaryKey(),
  date: date("date", { mode: "string" }).notNull(),
  type: text("type").notNull(),
  amount: money("amount").notNull(),
  category: text("category").notNull(),
  accountId: text("account_id").notNull(),
  payee: text("payee").notNull(),
  note: text("note"),
});

export const holdings = pgTable("holdings", {
  id: text("id").primaryKey(),
  ticker: text("ticker").notNull(),
  name: text("name").notNull(),
  assetClass: text("asset_class").notNull(),
  sector: text("sector").notNull(),
  shares: quantity("shares").notNull(),
  avgCost: unitPrice("avg_cost").notNull(),
  price: unitPrice("price").notNull(),
  history: jsonb("history").$type<number[]>().notNull(),
  dividendsReceived: money("dividends_received").notNull().default(0),
  accountType: text("account_type").notNull().default("non-registered"),
  currency: text("currency").notNull().default("USD"),
  priceCAD: unitPrice("price_cad").notNull().default(0),
  avgCostCAD: unitPrice("avg_cost_cad").notNull().default(0),
  dividendsReceivedCAD: money("dividends_received_cad").notNull().default(0),
  historyCAD: jsonb("history_cad").$type<number[]>().notNull().default([]),
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
