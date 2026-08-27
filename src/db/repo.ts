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

const round2 = (n: number) => Math.round(n * 100) / 100;

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
  const balance = round2(acc.balance + delta * sign);
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
/* Validation helpers (route bodies -> domain objects)                 */
/* ------------------------------------------------------------------ */

export class BadRequestError extends Error {}

export function parseTransaction(body: unknown): Transaction {
  const b = (body ?? {}) as Record<string, unknown>;
  const amount = Number(b.amount);
  if (typeof b.id !== "string" || !b.id) throw new BadRequestError("id required");
  if (typeof b.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.date))
    throw new BadRequestError("date must be YYYY-MM-DD");
  if (b.type !== "income" && b.type !== "expense")
    throw new BadRequestError("type must be income or expense");
  if (!Number.isFinite(amount) || amount <= 0)
    throw new BadRequestError("amount must be > 0");
  return {
    id: b.id,
    date: b.date,
    type: b.type,
    amount: round2(amount),
    category: String(b.category ?? "Other"),
    accountId: String(b.accountId ?? ""),
    payee: String(b.payee ?? "").trim(),
    note: typeof b.note === "string" && b.note.trim() ? b.note.trim() : undefined,
  };
}

export function parseAccount(body: unknown): Account {
  const b = (body ?? {}) as Record<string, unknown>;
  const balance = Number(b.balance);
  if (typeof b.id !== "string" || !b.id) throw new BadRequestError("id required");
  if (typeof b.name !== "string" || !b.name.trim())
    throw new BadRequestError("name required");
  const history = Array.isArray(b.history) ? (b.history as MonthlyPoint[]) : [];
  return {
    id: b.id,
    name: String(b.name).trim(),
    institution: String(b.institution ?? "—"),
    kind: (b.kind ?? "checking") as AccountKind,
    balance: Number.isFinite(balance) ? round2(balance) : 0,
    history,
  };
}

export function parseHolding(body: unknown): Holding {
  const b = (body ?? {}) as Record<string, unknown>;
  const shares = Number(b.shares);
  const avgCost = Number(b.avgCost);
  const price = Number(b.price);
  if (typeof b.id !== "string" || !b.id) throw new BadRequestError("id required");
  if (typeof b.ticker !== "string" || !b.ticker.trim())
    throw new BadRequestError("ticker required");
  if (!Number.isFinite(shares) || shares <= 0)
    throw new BadRequestError("shares must be > 0");
  if (!Number.isFinite(avgCost) || avgCost <= 0)
    throw new BadRequestError("avgCost must be > 0");
  if (!Number.isFinite(price) || price <= 0)
    throw new BadRequestError("price must be > 0");
  const history = Array.isArray(b.history) ? (b.history as number[]) : [];
  const dividendsReceived = Number(b.dividendsReceived);
  const accountType = String(b.accountType ?? "non-registered");
  const currency = String(b.currency ?? "USD") as Holding["currency"];
  const isUSD = currency === "USD";
  const priceCAD = Number(b.priceCAD);
  const avgCostCAD = Number(b.avgCostCAD);
  const dividendsReceivedCAD = Number(b.dividendsReceivedCAD);
  const historyCAD = Array.isArray(b.historyCAD) ? (b.historyCAD as number[]) : [];
  return {
    id: b.id,
    ticker: String(b.ticker).trim().toUpperCase(),
    name: String(b.name ?? b.ticker).trim(),
    assetClass: (b.assetClass ?? "US Equity") as Holding["assetClass"],
    sector: String(b.sector ?? b.assetClass ?? "Other"),
    shares,
    avgCost,
    price,
    history,
    dividendsReceived: Number.isFinite(dividendsReceived) ? Math.max(0, dividendsReceived) : 0,
    accountType: accountType as Holding["accountType"],
    currency,
    priceCAD: Number.isFinite(priceCAD) ? priceCAD : price,
    avgCostCAD: Number.isFinite(avgCostCAD) ? avgCostCAD : avgCost,
    dividendsReceivedCAD: Number.isFinite(dividendsReceivedCAD) ? dividendsReceivedCAD : dividendsReceived,
    historyCAD: historyCAD.length > 0 ? historyCAD : history,
  };
}

/* ------------------------------------------------------------------ */
/* Monthly snapshots                                                   */
/* ------------------------------------------------------------------ */

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
