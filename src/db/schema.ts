import {
  date,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  text,
} from "drizzle-orm/pg-core";
import type { MonthlyPoint } from "@/lib/types";

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  institution: text("institution").notNull().default("—"),
  kind: text("kind").notNull(),
  balance: doublePrecision("balance").notNull().default(0),
  history: jsonb("history").$type<MonthlyPoint[]>().notNull(),
  position: integer("position").notNull().default(0),
});

export const transactions = pgTable("transactions", {
  id: text("id").primaryKey(),
  date: date("date", { mode: "string" }).notNull(),
  type: text("type").notNull(),
  amount: doublePrecision("amount").notNull(),
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
  shares: doublePrecision("shares").notNull(),
  avgCost: doublePrecision("avg_cost").notNull(),
  price: doublePrecision("price").notNull(),
  history: jsonb("history").$type<number[]>().notNull(),
  dividendsReceived: doublePrecision("dividends_received").notNull().default(0),
  accountType: text("account_type").notNull().default("non-registered"),
  currency: text("currency").notNull().default("USD"),
  priceCAD: doublePrecision("price_cad").notNull().default(0),
  avgCostCAD: doublePrecision("avg_cost_cad").notNull().default(0),
  dividendsReceivedCAD: doublePrecision("dividends_received_cad").notNull().default(0),
  historyCAD: jsonb("history_cad").$type<number[]>().notNull().default([]),
  position: integer("position").notNull().default(0),
});

export const budgets = pgTable("budgets", {
  category: text("category").primaryKey(),
  max: doublePrecision("max").notNull(),
});

export const categories = pgTable("categories", {
  name: text("name").primaryKey(),
  position: integer("position").notNull().default(0),
});

export const merchantRules = pgTable("merchant_rules", {
  merchant: text("merchant").primaryKey(),
  category: text("category").notNull(),
});

export const monthlySnapshots = pgTable("monthly_snapshots", {
  month: text("month").notNull(),
  holdingId: text("holding_id").notNull(),
  ticker: text("ticker").notNull(),
  price: doublePrecision("price").notNull(),
  avgCost: doublePrecision("avg_cost").notNull(),
  shares: doublePrecision("shares").notNull(),
  value: doublePrecision("value").notNull(),
  valueCAD: doublePrecision("value_cad").notNull().default(0),
}, (t) => ({ pk: { columns: [t.month, t.holdingId] } }));
