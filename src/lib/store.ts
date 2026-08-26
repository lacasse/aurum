"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  Account,
  Budget,
  EXPENSE_CATEGORIES,
  FinanceData,
  Holding,
  Transaction,
  isLiability,
} from "./types";
import { generateSampleData } from "./sample";
import { HISTORY_MONTHS } from "./types";
import { lastMonthKeys } from "./format";

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

export type TransactionInput = Omit<Transaction, "id">;
export type HoldingInput = Omit<Holding, "id" | "history">;
export type AccountInput = {
  name: string;
  institution: string;
  kind: Account["kind"];
  balance: number;
};

interface FinanceStore extends FinanceData {
  hydrated: boolean;
  markHydrated: () => void;
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

export const useFinance = create<FinanceStore>()(
  persist(
    (set) => ({
      ...generateSampleData(),
      hydrated: false,
      merchantRules: {},
      categories: [...EXPENSE_CATEGORIES],

      markHydrated: () => set({ hydrated: true }),

      setMerchantRule: (merchant, category) =>
        set((s) => ({
          merchantRules: { ...s.merchantRules, [merchant.trim().toLowerCase()]: category },
        })),

      addTransaction: (input) =>
        set((s) => {
          const txn: Transaction = { ...input, id: uid() };
          return {
            transactions: [txn, ...s.transactions],
            accounts: applyTxn(s.accounts, txn, 1),
          };
        }),

      updateTransaction: (id, input) =>
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
        }),

      deleteTransaction: (id) =>
        set((s) => {
          const old = s.transactions.find((t) => t.id === id);
          if (!old) return s;
          return {
            transactions: s.transactions.filter((t) => t.id !== id),
            accounts: applyTxn(s.accounts, old, -1),
          };
        }),

      addAccount: (input) =>
        set((s) => {
          const account: Account = {
            id: uid(),
            name: input.name,
            institution: input.institution,
            kind: input.kind,
            balance: input.balance,
            history: [{ month: lastMonthKeys(1)[0], value: input.balance }],
          };
          return { accounts: [...s.accounts, account] };
        }),

      updateAccount: (id, input) =>
        set((s) => ({
          accounts: s.accounts.map((a) =>
            a.id === id
              ? extendAccountHistory({
                  ...a,
                  name: input.name,
                  institution: input.institution,
                  kind: input.kind,
                  balance: input.balance,
                })
              : a,
          ),
        })),

      deleteAccount: (id) =>
        set((s) => ({ accounts: s.accounts.filter((a) => a.id !== id) })),

      addHolding: (input) =>
        set((s) => ({
          holdings: [
            ...s.holdings,
            { ...input, id: uid(), history: synthHistory(input.ticker, input.price) },
          ],
        })),

      updateHolding: (id, input) =>
        set((s) => ({
          holdings: s.holdings.map((h) => {
            if (h.id !== id) return h;
            const history = h.history.slice();
            if (history.length > 0) history[history.length - 1] = input.price;
            return { ...h, ...input, history };
          }),
        })),

      deleteHolding: (id) =>
        set((s) => ({ holdings: s.holdings.filter((h) => h.id !== id) })),

      setBudget: (category, limit) =>
        set((s) => {
          const existing = s.budgets.find((b) => b.category === category);
          const budgets: Budget[] = existing
            ? s.budgets.map((b) =>
                b.category === category ? { ...b, limit } : b,
              )
            : [...s.budgets, { category, limit }];
          return { budgets };
        }),

      deleteBudget: (category) =>
        set((s) => ({
          budgets: s.budgets.filter((b) => b.category !== category),
        })),

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
        return true;
      },

      deleteCategory: (name) =>
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
        }),

      resetDemo: () =>
        set({ ...generateSampleData(), merchantRules: {} }),
    }),
    {
      name: "aurum-finance-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        accounts: s.accounts,
        transactions: s.transactions,
        holdings: s.holdings,
        budgets: s.budgets,
        merchantRules: s.merchantRules,
        categories: s.categories,
      }),
      onRehydrateStorage: () => (state) => {
        state?.markHydrated();
      },
    },
  ),
);
