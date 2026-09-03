"use client";

import type {
  Account,
  FinanceData,
  Holding,
  MonthlySnapshot,
  RecurringRule,
  Transaction,
} from "./types";

export interface ServerState extends FinanceData {
  merchantRules: Record<string, string>;
  /** Whether any seeded demo row is still in the database. */
  demoPresent: boolean;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

async function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : JSON_HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${method} ${url} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

export const api = {
  loadData: () => send<ServerState>("/api/data", "GET"),
  deleteDemo: () => send<ServerState>("/api/demo", "DELETE", { confirm: "DELETE" }),

  createAccount: (account: Account) => send("/api/accounts", "POST", account),
  updateAccount: (account: Account) =>
    send(`/api/accounts/${encodeURIComponent(account.id)}`, "PUT", account),
  deleteAccount: (id: string) =>
    send(`/api/accounts/${encodeURIComponent(id)}`, "DELETE"),

  createTransaction: (txn: Transaction) => send("/api/transactions", "POST", txn),
  updateTransaction: (id: string, input: Transaction) =>
    send(`/api/transactions/${encodeURIComponent(id)}`, "PUT", input),
  deleteTransaction: (id: string) =>
    send(`/api/transactions/${encodeURIComponent(id)}`, "DELETE"),

  createHolding: (holding: Holding) => send("/api/holdings", "POST", holding),
  updateHolding: (holding: Holding) =>
    send(`/api/holdings/${encodeURIComponent(holding.id)}`, "PUT", holding),
  deleteHolding: (id: string) =>
    send(`/api/holdings/${encodeURIComponent(id)}`, "DELETE"),
  updateSecurity: (
    from: string,
    input: {
      ticker: string;
      name: string;
      assetClass: string;
      price?: number;
      priceCAD?: number;
      currency: string;
    },
  ) => send("/api/holdings/security", "PUT", { from, ...input }),

  setBudget: (category: string, limit: number) =>
    send("/api/budgets", "PUT", { category, limit }),
  deleteBudget: (category: string) =>
    send(`/api/budgets/${encodeURIComponent(category)}`, "DELETE"),

  addCategory: (name: string) => send("/api/categories", "POST", { name }),
  renameCategory: (oldName: string, newName: string) =>
    send("/api/categories", "PUT", { oldName, newName }),
  deleteCategory: (name: string) =>
    send(`/api/categories/${encodeURIComponent(name)}`, "DELETE"),

  setMerchantRule: (merchant: string, category: string) =>
    send("/api/merchant-rules", "PUT", { merchant, category }),

  // These return the whole state: creating or editing a rule can post the
  // occurrences it already owes, which changes transactions and balances too.
  createRecurring: (rule: RecurringRule) =>
    send<ServerState>("/api/recurring", "POST", rule),
  updateRecurring: (rule: RecurringRule) =>
    send<ServerState>(`/api/recurring/${encodeURIComponent(rule.id)}`, "PUT", rule),
  deleteRecurring: (id: string) =>
    send(`/api/recurring/${encodeURIComponent(id)}`, "DELETE"),

  getSnapshots: (month: string) =>
    send<{ snapshots: MonthlySnapshot[] }>(`/api/snapshots?month=${encodeURIComponent(month)}`, "GET"),
  saveSnapshots: (snapshots: MonthlySnapshot[]) =>
    send("/api/snapshots", "POST", { snapshots }),
  getSnapshotHistory: () =>
    send<{ months: Record<string, Record<string, number>> }>(
      "/api/snapshots/history",
      "GET",
    ),
};
