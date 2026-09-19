"use client";

import type {
  Account,
  FinanceData,
  Holding,
  MonthlySnapshot,
  RecurringRule,
  Transaction,
} from "./types";
import { browserStorage, isDemo, readDemoSetting, writeDemoSetting, type DemoSetting } from "./demo";

export interface ServerState extends FinanceData {
  merchantRules: Record<string, string>;
  /** Whether any seeded demo row is still in the database. */
  demoPresent: boolean;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

/**
 * A request the server refused because nobody is signed in.
 *
 * Distinguished from every other failure because the answer is different: an
 * expired session is fixed by signing in again, and until this existed the
 * store treated it like being offline and left demo data on screen.
 */
export class NotAuthenticatedError extends Error {
  constructor() {
    super("not signed in");
    this.name = "NotAuthenticatedError";
  }
}

/**
 * A request the demo does not make.
 *
 * The store keeps a demo visitor's record in the browser and never asks the
 * server for anything. This is the backstop behind that: if some path forgets,
 * the request still does not leave, and the caller hears a reason rather than
 * an expired session.
 */
export class DemoModeError extends Error {
  constructor(url: string) {
    super(`not sent in the demo: ${url}`);
    this.name = "DemoModeError";
  }
}

async function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  /*
   * In the demo a write is a success that goes nowhere — the store has already
   * applied it and saves it in the browser — and a read is refused, since the
   * only thing on the other end is the record the demo exists to keep out of
   * reach.
   */
  if (isDemo()) {
    if (method === "GET") throw new DemoModeError(url);
    return undefined as T;
  }
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : JSON_HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403) throw new NotAuthenticatedError();
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

/*
 * Settings that pages load and save for themselves rather than through the
 * store. One pair of functions for all of them, so the demo is handled in one
 * place: in the demo they are kept in the browser under their own key, and
 * otherwise they go to the server exactly as they did.
 */
const SETTINGS: Record<"/api/expense-settings" | "/api/contribution-limits", DemoSetting> = {
  "/api/expense-settings": "expense-settings",
  "/api/contribution-limits": "contribution-limits",
};
export type SettingsPath = keyof typeof SETTINGS;

export async function getSettings<T extends object>(path: SettingsPath): Promise<T> {
  if (isDemo()) return (readDemoSetting(browserStorage(), SETTINGS[path]) ?? {}) as T;
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

export async function saveSettings(path: SettingsPath, value: object): Promise<void> {
  if (isDemo()) {
    writeDemoSetting(browserStorage(), SETTINGS[path], value);
    return;
  }
  await fetch(path, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(value),
  });
}
