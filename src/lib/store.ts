"use client";

import { create } from "zustand";
import {
  Account,
  Budget,
  FinanceData,
  Holding,
  MonthlySnapshot,
  Transaction,
  isLiability,
} from "./types";
import { generateSampleData } from "./sample";
import { HISTORY_MONTHS } from "./types";
import { currentMonthKey, lastMonthKeys } from "./format";
import { api } from "./api";

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

export type TransactionInput = Omit<Transaction, "id">;
export type HoldingInput = Omit<Holding, "id" | "history" | "historyCAD" | "priceCAD" | "avgCostCAD" | "dividendsReceivedCAD">;
export type AccountInput = {
  name: string;
  institution: string;
  kind: Account["kind"];
  balance: number;
};

interface FinanceStore extends FinanceData {
  hydrated: boolean;
  /** Loads the full state from the API (Postgres via /api/data). */
  loadFromServer: () => Promise<void>;
  /** USD/CAD exchange rate, fetched from /api/fx. */
  usdCadRate: number;
  refreshFxRate: () => Promise<void>;
  /** Merchant name (lowercase) -> category, learned from import corrections. */
  merchantRules: Record<string, string>;
  setMerchantRule: (merchant: string, category: string) => void;
  addTransaction: (input: TransactionInput) => void;
  updateTransaction: (id: string, input: TransactionInput) => void;
  deleteTransaction: (id: string) => void;
  addAccount: (input: AccountInput) => void;
  updateAccount: (id: string, input: AccountInput) => void;
  deleteAccount: (id: string) => void;
  addHolding: (input: HoldingInput) => void;
  updateHolding: (id: string, input: HoldingInput) => void;
  deleteHolding: (id: string) => void;
  setBudget: (category: string, limit: number) => void;
  deleteBudget: (category: string) => void;
  addCategory: (name: string, limit?: number) => boolean;
  renameCategory: (oldName: string, newName: string) => boolean;
  /** Deletes a category, its budget, and moves its transactions to "Other". */
  deleteCategory: (name: string) => void;
  resetDemo: () => void;
  /** Monthly snapshots for the checklist feature. */
  snapshots: MonthlySnapshot[];
  snapshotMonth: string;
  loadSnapshots: (month: string) => Promise<void>;
  saveSnapshots: (snapshots: MonthlySnapshot[]) => Promise<void>;
}

/** Apply a transaction's effect on its account balance. sign=-1 reverts it. */
function applyTxn(accounts: Account[], txn: Transaction, sign: 1 | -1): Account[] {
  return accounts.map((acc) => {
    if (acc.id !== txn.accountId) return acc;
    const liability = isLiability(acc.kind);
    let delta = txn.type === "income" ? txn.amount : -txn.amount;
    if (liability) delta = -delta; // paying with credit increases what you owe
    const balance = round2(acc.balance + delta * sign);
    const history = acc.history.slice();
    if (history.length > 0) {
      history[history.length - 1] = { ...history[history.length - 1], value: balance };
    }
    return { ...acc, balance, history };
  });
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Deterministic pseudo price history for user-created holdings so charts work. */
function synthHistory(ticker: string, price: number): number[] {
  let seed = 0;
  for (let i = 0; i < ticker.length; i++) seed = (seed * 31 + ticker.charCodeAt(i)) >>> 0;
  let a = seed || 7;
  const rng = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const drift = 1 + (rng() * 0.5 - 0.15);
  const out: number[] = [];
  let p = price / drift;
  for (let i = 0; i < HISTORY_MONTHS; i++) {
    out.push(i === HISTORY_MONTHS - 1 ? price : Math.round(p * 100) / 100);
    p *= Math.pow(drift, 1 / (HISTORY_MONTHS - 1)) * (1 + (rng() - 0.5) * 0.08);
  }
  return out;
}

/** Rebuild an 18-month series for an account, backfilling gaps and pinning "now" to its balance. */
function extendAccountHistory(acc: Account): Account {
  const months = lastMonthKeys(HISTORY_MONTHS);
  const byMonth = new Map(acc.history.map((p) => [p.month, p.value]));
  const first = acc.history.length > 0 ? acc.history[0].value : acc.balance;
  const history = months.map((m) => ({
    month: m,
    value: byMonth.get(m) ?? first,
  }));
  const curKey = months[months.length - 1];
  history[history.length - 1] = { month: curKey, value: acc.balance };
  return { ...acc, history };
}

const report = (err: unknown) => console.error("[sync]", err);

/** Convert a value to CAD based on currency and current rate. */
function toCad(value: number, currency: string, rate: number): number {
  return currency === "USD" ? Math.round(value * rate * 100) / 100 : value;
}

/** Compute CAD fields for a holding given the current FX rate. */
function computeCadFields(
  h: Pick<Holding, "price" | "avgCost" | "dividendsReceived" | "history" | "currency">,
  rate: number,
) {
  const isUSD = h.currency === "USD";
  return {
    priceCAD: isUSD ? Math.round(h.price * rate * 100) / 100 : h.price,
    avgCostCAD: isUSD ? Math.round(h.avgCost * rate * 100) / 100 : h.avgCost,
    dividendsReceivedCAD: isUSD
      ? Math.round(h.dividendsReceived * rate * 100) / 100
      : h.dividendsReceived,
    historyCAD: isUSD ? h.history.map((v) => Math.round(v * rate * 100) / 100) : h.history,
  };
}

export const useFinance = create<FinanceStore>()((set, get) => ({
  ...generateSampleData(),
  hydrated: false,
  usdCadRate: 1.37,
  merchantRules: {},
  categories: [...generateSampleData().categories],
  snapshots: [],
  snapshotMonth: "",

  refreshFxRate: async () => {
    try {
      const res = await fetch("/api/fx");
      const data = await res.json();
      if (typeof data.rate === "number" && Number.isFinite(data.rate)) {
        set({ usdCadRate: data.rate });
      }
    } catch {
      // keep current rate
    }
  },

  loadFromServer: async () => {
    try {
      const [data] = await Promise.all([api.loadData(), get().refreshFxRate()]);
      set({ ...data, hydrated: true });
    } catch (err) {
      report(err);
      set({ hydrated: true }); // offline: keep bundled sample data
    }
  },

  setMerchantRule: (merchant, category) => {
    set((s) => ({
      merchantRules: { ...s.merchantRules, [merchant.trim().toLowerCase()]: category },
    }));
    api.setMerchantRule(merchant, category).catch(report);
  },

  loadSnapshots: async (month) => {
    try {
      const { snapshots } = await api.getSnapshots(month);
      set({ snapshots, snapshotMonth: month });
    } catch (err) {
      report(err);
    }
  },

  saveSnapshots: async (rows) => {
    try {
      await api.saveSnapshots(rows);
      set({ snapshots: rows });
    } catch (err) {
      report(err);
    }
  },

      addTransaction: (input) => {
        const txn: Transaction = { ...input, id: uid() };
        set((s) => ({
          transactions: [txn, ...s.transactions],
          accounts: applyTxn(s.accounts, txn, 1),
        }));
        api.createTransaction(txn).catch(report);
      },

      updateTransaction: (id, input) => {
        set((s) => {
          const old = s.transactions.find((t) => t.id === id);
          if (!old) return s;
          let accounts = applyTxn(s.accounts, old, -1);
          const updated: Transaction = { ...old, ...input };
          accounts = applyTxn(accounts, updated, 1);
          return {
            transactions: s.transactions.map((t) => (t.id === id ? updated : t)),
            accounts,
          };
        });
        api.updateTransaction(id, input as Transaction).catch(report);
      },

      deleteTransaction: (id) => {
        set((s) => {
          const old = s.transactions.find((t) => t.id === id);
          if (!old) return s;
          return {
            transactions: s.transactions.filter((t) => t.id !== id),
            accounts: applyTxn(s.accounts, old, -1),
          };
        });
        api.deleteTransaction(id).catch(report);
      },

      addAccount: (input) => {
        const account: Account = {
          id: uid(),
          name: input.name,
          institution: input.institution,
          kind: input.kind,
          balance: input.balance,
          history: [{ month: currentMonthKey(), value: input.balance }],
        };
        set((s) => ({ accounts: [...s.accounts, account] }));
        api.createAccount(account).catch(report);
      },

      updateAccount: (id, input) => {
        let updated: Account | undefined;
        set((s) => ({
          accounts: s.accounts.map((a) => {
            if (a.id !== id) return a;
            updated = extendAccountHistory({
              ...a,
              name: input.name,
              institution: input.institution,
              kind: input.kind,
              balance: input.balance,
            });
            return updated;
          }),
        }));
        if (updated) api.updateAccount(updated).catch(report);
      },

      deleteAccount: (id) => {
        set((s) => ({ accounts: s.accounts.filter((a) => a.id !== id) }));
        api.deleteAccount(id).catch(report);
      },

      addHolding: (input) => {
        const rate = get().usdCadRate;
        const cadFields = computeCadFields(
          { ...input, history: synthHistory(input.ticker, input.price) },
          rate,
        );
        const holding: Holding = {
          ...input,
          id: uid(),
          history: synthHistory(input.ticker, input.price),
          ...cadFields,
        };
        set((s) => ({ holdings: [...s.holdings, holding] }));
        api.createHolding(holding).catch(report);
      },

      updateHolding: (id, input) => {
        let updated: Holding | undefined;
        const rate = get().usdCadRate;
        set((s) => ({
          holdings: s.holdings.map((h) => {
            if (h.id !== id) return h;
            const history = h.history.slice();
            if (history.length > 0) history[history.length - 1] = input.price;
            const cadFields = computeCadFields(
              { ...h, ...input, history },
              rate,
            );
            updated = { ...h, ...input, history, ...cadFields };
            return updated;
          }),
        }));
        if (updated) api.updateHolding(updated).catch(report);
      },

      deleteHolding: (id) => {
        set((s) => ({ holdings: s.holdings.filter((h) => h.id !== id) }));
        api.deleteHolding(id).catch(report);
      },

      setBudget: (category, limit) => {
        set((s) => {
          const existing = s.budgets.find((b) => b.category === category);
          const budgets: Budget[] = existing
            ? s.budgets.map((b) =>
                b.category === category ? { ...b, limit } : b,
              )
            : [...s.budgets, { category, limit }];
          return { budgets };
        });
        api.setBudget(category, limit).catch(report);
      },

      deleteBudget: (category) => {
        set((s) => ({
          budgets: s.budgets.filter((b) => b.category !== category),
        }));
        api.deleteBudget(category).catch(report);
      },

      addCategory: (name, limit) => {
        const n = name.trim();
        if (!n) return false;
        const state = useFinance.getState();
        if (state.categories.some((c) => c.toLowerCase() === n.toLowerCase())) {
          return false;
        }
        set((s) => ({
          categories: [...s.categories, n],
          budgets:
            limit && limit > 0
              ? [...s.budgets, { category: n, limit: round2(limit) }]
              : s.budgets,
        }));
        api.addCategory(n).catch(report);
        if (limit && limit > 0) api.setBudget(n, round2(limit)).catch(report);
        return true;
      },

      renameCategory: (oldName, newName) => {
        const n = newName.trim();
        if (!n) return false;
        const state = useFinance.getState();
        if (
          state.categories.some(
            (c) => c.toLowerCase() === n.toLowerCase() && c !== oldName,
          )
        ) {
          return false;
        }
        set((s) => ({
          categories: s.categories.map((c) => (c === oldName ? n : c)),
          budgets: s.budgets.map((b) =>
            b.category === oldName ? { ...b, category: n } : b,
          ),
          transactions: s.transactions.map((t) =>
            t.category === oldName ? { ...t, category: n } : t,
          ),
        }));
        api.renameCategory(oldName, n).catch(report);
        return true;
      },

      deleteCategory: (name) => {
        set((s) => {
          const categories = s.categories.filter((c) => c !== name);
          const fallback = categories.includes("Other")
            ? "Other"
            : categories[0];
          return {
            categories,
            budgets: s.budgets.filter((b) => b.category !== name),
            transactions: fallback
              ? s.transactions.map((t) =>
                  t.category === name ? { ...t, category: fallback } : t,
                )
              : s.transactions,
          };
        });
        api.deleteCategory(name).catch(report);
      },

      resetDemo: () => {
        const fresh = generateSampleData();
        set({ ...fresh, merchantRules: {} });
        api
          .reset()
          .then((data) => set({ ...data }))
          .catch(report);
      },
    }),
);
