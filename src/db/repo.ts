import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "./index";
import {
  accounts,
  budgets,
  categories,
  holdings,
  merchantRules,
  monthlySnapshots,
  transactions,
} from "./schema";
import {
  Account,
  AccountKind,
  FinanceData,
  Holding,
  MonthlyPoint,
  MonthlySnapshot,
  Transaction,
  TxnType,
  isLiability,
} from "@/lib/types";
import { addMoney } from "@/lib/money";
import { z } from "zod";
import {
  accountSchema,
  budgetSchema,
  categorySchema,
  formatIssues,
  holdingSchema,
  merchantRuleSchema,
  renameCategorySchema,
  snapshotSchema,
  snapshotsBodySchema,
  transactionSchema,
} from "@/lib/schemas";

type AccountRow = typeof accounts.$inferSelect;
type HoldingRow = typeof holdings.$inferSelect;

/* ------------------------------------------------------------------ */
/* Row <-> domain mapping                                              */
/* ------------------------------------------------------------------ */

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    institution: row.institution,
    kind: row.kind as AccountKind,
    balance: row.balance,
    history: row.history,
  };
}

function toHolding(row: HoldingRow): Holding {
  return {
    id: row.id,
    ticker: row.ticker,
    name: row.name,
    assetClass: row.assetClass as Holding["assetClass"],
    sector: row.sector,
    shares: row.shares,
    avgCost: row.avgCost,
    price: row.price,
    history: row.history,
    dividendsReceived: row.dividendsReceived ?? 0,
    accountType: (row.accountType ?? "non-registered") as Holding["accountType"],
    currency: (row.currency ?? "USD") as Holding["currency"],
    priceCAD: row.priceCAD ?? row.price,
    avgCostCAD: row.avgCostCAD ?? row.avgCost,
    dividendsReceivedCAD: row.dividendsReceivedCAD ?? row.dividendsReceived ?? 0,
    historyCAD: row.historyCAD ?? row.history,
  };
}

function toTransaction(row: typeof transactions.$inferSelect): Transaction {
  return {
    id: row.id,
    date: row.date,
    type: row.type as TxnType,
    amount: row.amount,
    category: row.category,
    accountId: row.accountId,
    payee: row.payee,
    note: row.note ?? undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

export async function getState(): Promise<
  FinanceData & { merchantRules: Record<string, string> }
> {
  const [accountRows, txnRows, holdingRows, budgetRows, categoryRows, ruleRows] =
    await Promise.all([
      db.select().from(accounts).orderBy(asc(accounts.position)),
      db.select().from(transactions).orderBy(desc(transactions.date), desc(transactions.id)),
      db.select().from(holdings).orderBy(asc(holdings.position)),
      db.select().from(budgets),
      db.select().from(categories).orderBy(asc(categories.position)),
      db.select().from(merchantRules),
    ]);

  return {
    accounts: accountRows.map(toAccount),
    transactions: txnRows.map(toTransaction),
    holdings: holdingRows.map(toHolding),
    budgets: budgetRows.map((b) => ({ category: b.category, limit: b.max })),
    categories: categoryRows.map((c) => c.name),
    merchantRules: Object.fromEntries(ruleRows.map((r) => [r.merchant, r.category])),
  };
}

export async function isSeeded(): Promise<boolean> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(accounts);
  return (row?.count ?? 0) > 0;
}

/* ------------------------------------------------------------------ */
/* Seed / reset                                                        */
/* ------------------------------------------------------------------ */

export async function seed(data: FinanceData): Promise<void> {
  if (data.accounts.length > 0) {
    await db.insert(accounts).values(
      data.accounts.map((a, i) => ({
        id: a.id,
        name: a.name,
        institution: a.institution,
        kind: a.kind,
        balance: a.balance,
        history: a.history,
        position: i,
      })),
    );
  }
  if (data.transactions.length > 0) {
    await db.insert(transactions).values(
      data.transactions.map((t) => ({
        id: t.id,
        date: t.date,
        type: t.type,
        amount: t.amount,
        category: t.category,
        accountId: t.accountId,
        payee: t.payee,
        note: t.note ?? null,
      })),
    );
  }
  if (data.holdings.length > 0) {
    await db.insert(holdings).values(
      data.holdings.map((h, i) => ({
        id: h.id,
        ticker: h.ticker,
        name: h.name,
        assetClass: h.assetClass,
        sector: h.sector,
        shares: h.shares,
        avgCost: h.avgCost,
        price: h.price,
        history: h.history,
        dividendsReceived: h.dividendsReceived ?? 0,
        accountType: h.accountType ?? "non-registered",
        currency: h.currency ?? "USD",
        priceCAD: h.priceCAD ?? h.price,
        avgCostCAD: h.avgCostCAD ?? h.avgCost,
        dividendsReceivedCAD: h.dividendsReceivedCAD ?? h.dividendsReceived ?? 0,
        historyCAD: h.historyCAD ?? h.history,
        position: i,
      })),
    );
  }
  if (data.budgets.length > 0) {
    await db
      .insert(budgets)
      .values(data.budgets.map((b) => ({ category: b.category, max: b.limit })));
  }
  if (data.categories.length > 0) {
    await db
      .insert(categories)
      .values(data.categories.map((name, i) => ({ name, position: i })));
  }
}

export async function wipe(): Promise<void> {
  await db.delete(transactions);
  await db.delete(budgets);
  await db.delete(merchantRules);
  await db.delete(categories);
  await db.delete(holdings);
  await db.delete(accounts);
}

export async function resetToSample(data: FinanceData): Promise<void> {
  await wipe();
  await seed(data);
}

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

export async function insertAccount(a: Account, position: number): Promise<void> {
  await db.insert(accounts).values({
    id: a.id,
    name: a.name,
    institution: a.institution,
    kind: a.kind,
    balance: a.balance,
    history: a.history,
    position,
  });
}

export async function replaceAccount(a: Account): Promise<void> {
  await db
    .update(accounts)
    .set({
      name: a.name,
      institution: a.institution,
      kind: a.kind,
      balance: a.balance,
      history: a.history,
    })
    .where(eq(accounts.id, a.id));
}

export async function deleteAccountRow(id: string): Promise<void> {
  await db.delete(accounts).where(eq(accounts.id, id));
}

export async function nextPosition(
  table: typeof accounts | typeof holdings | typeof categories,
): Promise<number> {
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${table.position}), -1)::int` })
    .from(table);
  return (row?.max ?? -1) + 1;
}

/* ------------------------------------------------------------------ */
/* Transactions (with account-balance side effects)                    */
/* ------------------------------------------------------------------ */

/** Mirror of the client-side rule: expenses drain assets / grow debts, income the reverse. */
async function applyTxnEffect(txn: Transaction, sign: 1 | -1): Promise<void> {
  const [acc] = await db.select().from(accounts).where(eq(accounts.id, txn.accountId));
  if (!acc) return;
  const liability = isLiability(acc.kind as AccountKind);
  let delta = txn.type === "income" ? txn.amount : -txn.amount;
  if (liability) delta = -delta;
  const balance = addMoney(acc.balance, delta * sign);
  const history: MonthlyPoint[] = acc.history.slice();
  if (history.length > 0) {
    history[history.length - 1] = { ...history[history.length - 1], value: balance };
  }
  await db.update(accounts).set({ balance, history }).where(eq(accounts.id, acc.id));
}

export async function insertTransaction(txn: Transaction): Promise<void> {
  await db.insert(transactions).values({
    id: txn.id,
    date: txn.date,
    type: txn.type,
    amount: txn.amount,
    category: txn.category,
    accountId: txn.accountId,
    payee: txn.payee,
    note: txn.note ?? null,
  });
  await applyTxnEffect(txn, 1);
}

export async function updateTransactionRow(
  id: string,
  input: Transaction,
): Promise<void> {
  const [old] = await db.select().from(transactions).where(eq(transactions.id, id));
  if (!old) return;
  await applyTxnEffect(toTransaction(old), -1);
  const updated: Transaction = { ...toTransaction(old), ...input, id };
  await db
    .update(transactions)
    .set({
      date: updated.date,
      type: updated.type,
      amount: updated.amount,
      category: updated.category,
      accountId: updated.accountId,
      payee: updated.payee,
      note: updated.note ?? null,
    })
    .where(eq(transactions.id, id));
  await applyTxnEffect(updated, 1);
}

export async function removeTransaction(id: string): Promise<void> {
  const [old] = await db.select().from(transactions).where(eq(transactions.id, id));
  if (!old) return;
  await applyTxnEffect(toTransaction(old), -1);
  await db.delete(transactions).where(eq(transactions.id, id));
}

/* ------------------------------------------------------------------ */
/* Holdings                                                            */
/* ------------------------------------------------------------------ */

export async function insertHolding(h: Holding, position: number): Promise<void> {
  await db.insert(holdings).values({
    id: h.id,
    ticker: h.ticker,
    name: h.name,
    assetClass: h.assetClass,
    sector: h.sector,
    shares: h.shares,
    avgCost: h.avgCost,
    price: h.price,
    history: h.history,
    dividendsReceived: h.dividendsReceived ?? 0,
    accountType: h.accountType ?? "non-registered",
    currency: h.currency ?? "USD",
    priceCAD: h.priceCAD ?? h.price,
    avgCostCAD: h.avgCostCAD ?? h.avgCost,
    dividendsReceivedCAD: h.dividendsReceivedCAD ?? h.dividendsReceived ?? 0,
    historyCAD: h.historyCAD ?? h.history,
    position,
  });
}

export async function replaceHolding(h: Holding): Promise<void> {
  await db
    .update(holdings)
    .set({
      ticker: h.ticker,
      name: h.name,
      assetClass: h.assetClass,
      sector: h.sector,
      shares: h.shares,
      avgCost: h.avgCost,
      price: h.price,
      history: h.history,
      dividendsReceived: h.dividendsReceived ?? 0,
      accountType: h.accountType ?? "non-registered",
      currency: h.currency ?? "USD",
      priceCAD: h.priceCAD ?? h.price,
      avgCostCAD: h.avgCostCAD ?? h.avgCost,
      dividendsReceivedCAD: h.dividendsReceivedCAD ?? h.dividendsReceived ?? 0,
      historyCAD: h.historyCAD ?? h.history,
    })
    .where(eq(holdings.id, h.id));
}

export async function deleteHoldingRow(id: string): Promise<void> {
  await db.delete(holdings).where(eq(holdings.id, id));
}

/* ------------------------------------------------------------------ */
/* Budgets / categories / merchant rules                               */
/* ------------------------------------------------------------------ */

export async function upsertBudget(category: string, limit: number): Promise<void> {
  await db
    .insert(budgets)
    .values({ category, max: limit })
    .onConflictDoUpdate({ target: budgets.category, set: { max: limit } });
}

export async function deleteBudgetRow(category: string): Promise<void> {
  await db.delete(budgets).where(eq(budgets.category, category));
}

export async function insertCategory(name: string, position: number): Promise<void> {
  await db.insert(categories).values({ name, position }).onConflictDoNothing();
}

export async function renameCategoryEverywhere(
  oldName: string,
  newName: string,
): Promise<void> {
  await db.update(categories).set({ name: newName }).where(eq(categories.name, oldName));
  await db.update(budgets).set({ category: newName }).where(eq(budgets.category, oldName));
  await db.update(transactions).set({ category: newName }).where(eq(transactions.category, oldName));
}

export async function deleteCategoryEverywhere(name: string, fallback: string): Promise<void> {
  await db.delete(categories).where(eq(categories.name, name));
  await db.delete(budgets).where(eq(budgets.category, name));
  await db.update(transactions).set({ category: fallback }).where(eq(transactions.category, name));
}

/** Deletes a category and re-homes its transactions ("Other" if available). */
export async function deleteCategorySmart(name: string): Promise<void> {
  const rows = await db.select().from(categories).orderBy(asc(categories.position));
  const rest = rows.map((r) => r.name).filter((n) => n !== name);
  const fallback = rest.includes("Other") ? "Other" : rest[0] ?? name;
  await deleteCategoryEverywhere(name, fallback);
}

export async function upsertMerchantRule(merchant: string, category: string): Promise<void> {
  await db
    .insert(merchantRules)
    .values({ merchant, category })
    .onConflictDoUpdate({ target: merchantRules.merchant, set: { category } });
}

/* ------------------------------------------------------------------ */
/* Validation (route bodies -> domain objects, via shared schemas)     */
/* ------------------------------------------------------------------ */

export class BadRequestError extends Error {}

/** Validate `body` against a shared schema, surfacing issues as a 400. */
function parseWith<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body ?? {});
  if (!result.success) throw new BadRequestError(formatIssues(result.error));
  return result.data;
}

export function parseTransaction(body: unknown): Transaction {
  return parseWith(transactionSchema, body);
}

export function parseAccount(body: unknown): Account {
  return parseWith(accountSchema, body);
}

export function parseHolding(body: unknown): Holding {
  return parseWith(holdingSchema, body);
}

export function parseBudget(body: unknown): { category: string; limit: number } {
  return parseWith(budgetSchema, body);
}

export function parseCategory(body: unknown): { name: string } {
  return parseWith(categorySchema, body);
}

export function parseRenameCategory(body: unknown): { oldName: string; newName: string } {
  return parseWith(renameCategorySchema, body);
}

export function parseMerchantRule(body: unknown): { merchant: string; category: string } {
  return parseWith(merchantRuleSchema, body);
}

export function parseSnapshotsBody(body: unknown): MonthlySnapshot[] {
  return parseWith(snapshotsBodySchema, body).snapshots;
}

/* ------------------------------------------------------------------ */
/* Monthly snapshots                                                   */
/* ------------------------------------------------------------------ */

export function parseSnapshotInput(body: unknown): MonthlySnapshot {
  return parseWith(snapshotSchema, body);
}

export async function getSnapshots(month: string): Promise<MonthlySnapshot[]> {
  const rows = await db
    .select()
    .from(monthlySnapshots)
    .where(eq(monthlySnapshots.month, month));
  return rows.map((r) => ({
    month: r.month,
    holdingId: r.holdingId,
    ticker: r.ticker,
    price: r.price,
    avgCost: r.avgCost,
    shares: r.shares,
    value: r.value,
    valueCAD: r.valueCAD ?? r.value,
  }));
}

export async function upsertSnapshots(rows: MonthlySnapshot[]): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(monthlySnapshots)
    .values(
      rows.map((r) => ({
        month: r.month,
        holdingId: r.holdingId,
        ticker: r.ticker,
        price: r.price,
        avgCost: r.avgCost,
        shares: r.shares,
        value: r.value,
        valueCAD: r.valueCAD ?? r.value,
      })),
    )
    .onConflictDoUpdate({
      target: [monthlySnapshots.month, monthlySnapshots.holdingId],
      set: {
        price: sql`excluded.price`,
        avgCost: sql`excluded.avg_cost`,
        shares: sql`excluded.shares`,
        value: sql`excluded.value`,
        valueCAD: sql`excluded.value_cad`,
      },
    });
}
