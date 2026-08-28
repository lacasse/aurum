import { asc, desc, eq, inArray, like, sql } from "drizzle-orm";
import { db } from "./index";
import {
  accounts,
  appMeta,
  budgets,
  categories,
  holdings,
  merchantRules,
  monthlySnapshots,
  recurringTransactions,
  transactions,
} from "./schema";
import {
  Account,
  AccountKind,
  FinanceData,
  Holding,
  MonthlyPoint,
  MonthlySnapshot,
  RecurringRule,
  Transaction,
  TxnType,
  balanceDelta,
} from "@/lib/types";
import { advanceRule, dueOccurrences } from "@/lib/recurrence";
import { todayISO } from "@/lib/format";
import { addMoney } from "@/lib/money";
import {
  DEMO_ACCOUNT_ID_PREFIX,
  DEMO_HOLDING_ID_PREFIX,
  DEMO_RECURRING_ID_PREFIX,
  DEMO_TRANSACTION_ID_PREFIX,
  SAMPLE_BUDGETS,
} from "@/lib/sample";
import { z } from "zod";
import {
  accountSchema,
  budgetSchema,
  categorySchema,
  formatIssues,
  holdingSchema,
  merchantRuleSchema,
  recurringRuleSchema,
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
    registration: (row.registration ?? undefined) as Account["registration"],
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
    accountId: row.accountId,
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
    sourceAccountId: row.sourceAccountId ?? undefined,
    destinationAccountId: row.destinationAccountId ?? undefined,
    payee: row.payee,
    note: row.note ?? undefined,
    recurringId: row.recurringId ?? undefined,
  };
}

function toRecurringRule(
  row: typeof recurringTransactions.$inferSelect,
): RecurringRule {
  return {
    id: row.id,
    type: row.type as TxnType,
    amount: row.amount,
    category: row.category,
    sourceAccountId: row.sourceAccountId ?? undefined,
    destinationAccountId: row.destinationAccountId ?? undefined,
    payee: row.payee,
    note: row.note ?? undefined,
    frequency: row.frequency as RecurringRule["frequency"],
    startDate: row.startDate,
    endDate: row.endDate ?? undefined,
    nextDate: row.nextDate,
    active: row.active,
  };
}

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

export async function getState(): Promise<
  FinanceData & { merchantRules: Record<string, string>; demoPresent: boolean }
> {
  const [
    accountRows,
    txnRows,
    holdingRows,
    budgetRows,
    categoryRows,
    ruleRows,
    recurringRows,
    demoPresent,
  ] = await Promise.all([
    db.select().from(accounts).orderBy(asc(accounts.position)),
    db.select().from(transactions).orderBy(desc(transactions.date), desc(transactions.id)),
    db.select().from(holdings).orderBy(asc(holdings.position)),
    db.select().from(budgets),
    db.select().from(categories).orderBy(asc(categories.position)),
    db.select().from(merchantRules),
    db.select().from(recurringTransactions).orderBy(asc(recurringTransactions.position)),
    hasDemoData(),
  ]);

  return {
    accounts: accountRows.map(toAccount),
    transactions: txnRows.map(toTransaction),
    holdings: holdingRows.map(toHolding),
    budgets: budgetRows.map((b) => ({ category: b.category, limit: b.max })),
    categories: categoryRows.map((c) => c.name),
    recurring: recurringRows.map(toRecurringRule),
    merchantRules: Object.fromEntries(ruleRows.map((r) => [r.merchant, r.category])),
    demoPresent,
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
        registration: a.registration ?? null,
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
        sourceAccountId: t.sourceAccountId ?? null,
        destinationAccountId: t.destinationAccountId ?? null,
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
        accountId: h.accountId,
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
  if (data.recurring.length > 0) {
    await db
      .insert(recurringTransactions)
      .values(data.recurring.map((r, i) => recurringValues(r, i)));
  }
  if (data.categories.length > 0) {
    await db
      .insert(categories)
      .values(data.categories.map((name, i) => ({ name, position: i })));
  }
}

export async function wipe(): Promise<void> {
  await db.delete(transactions);
  await db.delete(recurringTransactions);
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
/* Recurring transactions                                              */
/* ------------------------------------------------------------------ */

function recurringValues(r: RecurringRule, position: number) {
  return {
    id: r.id,
    type: r.type,
    amount: r.amount,
    category: r.category,
    sourceAccountId: r.sourceAccountId ?? null,
    destinationAccountId: r.destinationAccountId ?? null,
    payee: r.payee,
    note: r.note ?? null,
    frequency: r.frequency,
    startDate: r.startDate,
    endDate: r.endDate ?? null,
    nextDate: r.nextDate,
    active: r.active,
    position,
  };
}

export async function insertRecurringRule(
  rule: RecurringRule,
  position: number,
): Promise<void> {
  await db.insert(recurringTransactions).values(recurringValues(rule, position));
}

export async function replaceRecurringRule(rule: RecurringRule): Promise<void> {
  const { id: _id, position: _position, ...rest } = recurringValues(rule, 0);
  void _id;
  void _position;
  await db
    .update(recurringTransactions)
    .set(rest)
    .where(eq(recurringTransactions.id, rule.id));
}

export async function deleteRecurringRule(id: string): Promise<void> {
  await db.delete(recurringTransactions).where(eq(recurringTransactions.id, id));
}

/**
 * Post every occurrence each active rule owes up to today, then advance the
 * rule past them.
 *
 * Catch-up is driven by the rule's own `nextDate`, so this is safe to call on
 * every load: a rule that is up to date produces nothing, and one that has not
 * run for three months produces exactly the three payments it missed. Each
 * generated transaction carries `recurringId`, so it can be traced back — and
 * so a re-run can never duplicate one that already exists.
 */
export async function materializeRecurring(
  today = todayISO(),
): Promise<number> {
  const rules = (await db.select().from(recurringTransactions)).map(toRecurringRule);
  let created = 0;

  for (const rule of rules) {
    const due = dueOccurrences(rule, today);
    if (due.length === 0) continue;

    // Belt and braces against a double-post: ask which dates already exist for
    // this rule rather than trusting nextDate alone.
    const existing = new Set(
      (
        await db
          .select({ date: transactions.date })
          .from(transactions)
          .where(eq(transactions.recurringId, rule.id))
      ).map((r) => r.date),
    );

    for (const date of due) {
      if (existing.has(date)) continue;
      await insertTransaction({
        id: `rec-${rule.id}-${date}`,
        date,
        type: rule.type,
        amount: rule.amount,
        category: rule.category,
        sourceAccountId: rule.sourceAccountId,
        destinationAccountId: rule.destinationAccountId,
        payee: rule.payee,
        note: rule.note,
        recurringId: rule.id,
      });
      created += 1;
    }

    const { nextDate, active } = advanceRule(rule, due);
    await db
      .update(recurringTransactions)
      .set({ nextDate, active })
      .where(eq(recurringTransactions.id, rule.id));
  }

  return created;
}

/* ------------------------------------------------------------------ */
/* Demo data                                                           */
/* ------------------------------------------------------------------ */

/** `app_meta` key recording that the user deleted the seeded demo data. */
const DEMO_DELETED_KEY = "demo_data_deleted";

/** Escape LIKE wildcards so a prefix is matched literally. */
const startsWith = (prefix: string) =>
  `${prefix.replace(/([%_\\])/g, "\\$1")}%`;

/**
 * True once the user has deleted the demo data. Checked before first-run
 * seeding so an emptied database is not re-populated with samples.
 */
export async function isDemoDeleted(): Promise<boolean> {
  const [row] = await db
    .select()
    .from(appMeta)
    .where(eq(appMeta.key, DEMO_DELETED_KEY));
  return row !== undefined;
}

/**
 * True while any seeded demo row survives. Drives the sidebar's "Delete demo
 * data" button, which is hidden once there is nothing left to delete.
 */
export async function hasDemoData(): Promise<boolean> {
  const count = sql<number>`count(*)::int`;
  const [demoAccounts, demoHoldings, demoTransactions] = await Promise.all([
    db
      .select({ count })
      .from(accounts)
      .where(like(accounts.id, startsWith(DEMO_ACCOUNT_ID_PREFIX))),
    db
      .select({ count })
      .from(holdings)
      .where(like(holdings.id, startsWith(DEMO_HOLDING_ID_PREFIX))),
    db
      .select({ count })
      .from(transactions)
      .where(like(transactions.id, startsWith(DEMO_TRANSACTION_ID_PREFIX))),
  ]);
  return (
    (demoAccounts[0]?.count ?? 0) > 0 ||
    (demoHoldings[0]?.count ?? 0) > 0 ||
    (demoTransactions[0]?.count ?? 0) > 0
  );
}

/**
 * Delete the seeded sample rows, leaving anything the user created.
 *
 * Accounts, holdings and transactions are matched on their demo id prefix;
 * user rows carry a UUID and so never match. Budgets have no id, so the demo
 * ones are matched by the category names the generator seeds.
 *
 * The category list is deliberately kept: it is the taxonomy the user's own
 * transactions are filed under, not sample data, and it is already editable
 * on the Budgets page.
 */
export async function deleteDemoData(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(monthlySnapshots)
      .where(like(monthlySnapshots.holdingId, startsWith(DEMO_HOLDING_ID_PREFIX)));
    await tx
      .delete(transactions)
      .where(like(transactions.id, startsWith(DEMO_TRANSACTION_ID_PREFIX)));
    await tx
      .delete(holdings)
      .where(like(holdings.id, startsWith(DEMO_HOLDING_ID_PREFIX)));
    await tx
      .delete(accounts)
      .where(like(accounts.id, startsWith(DEMO_ACCOUNT_ID_PREFIX)));
    await tx
      .delete(recurringTransactions)
      .where(like(recurringTransactions.id, startsWith(DEMO_RECURRING_ID_PREFIX)));
    await tx.delete(budgets).where(
      inArray(
        budgets.category,
        SAMPLE_BUDGETS.map((b) => b.category),
      ),
    );
    await tx
      .insert(appMeta)
      .values({ key: DEMO_DELETED_KEY, value: new Date().toISOString() })
      .onConflictDoNothing();
  });
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
    registration: a.registration ?? null,
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
      registration: a.registration ?? null,
    })
    .where(eq(accounts.id, a.id));
}

export async function deleteAccountRow(id: string): Promise<void> {
  await db.delete(accounts).where(eq(accounts.id, id));
}

export async function nextPosition(
  table:
    | typeof accounts
    | typeof holdings
    | typeof categories
    | typeof recurringTransactions,
): Promise<number> {
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${table.position}), -1)::int` })
    .from(table);
  return (row?.max ?? -1) + 1;
}

/* ------------------------------------------------------------------ */
/* Transactions (with account-balance side effects)                    */
/* ------------------------------------------------------------------ */

/**
 * A database handle inside a transaction. Writing a transaction and moving the
 * balances it affects must be atomic: a transfer touches two accounts, and a
 * failure between the two halves would make money disappear.
 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Move one account's balance, keeping the latest history point in step. */
async function applyToAccount(
  tx: Tx,
  accountId: string,
  side: "source" | "destination",
  amount: number,
  sign: 1 | -1,
): Promise<void> {
  const [acc] = await tx.select().from(accounts).where(eq(accounts.id, accountId));
  if (!acc) return;
  const delta = balanceDelta(acc.kind as AccountKind, side, amount) * sign;
  const balance = addMoney(acc.balance, delta);
  const history: MonthlyPoint[] = acc.history.slice();
  if (history.length > 0) {
    history[history.length - 1] = { ...history[history.length - 1], value: balance };
  }
  await tx.update(accounts).set({ balance, history }).where(eq(accounts.id, acc.id));
}

/**
 * Apply a transaction to both of its sides. A transfer touches two accounts
 * and nets to zero across them; income and expenses touch only the one side
 * that is an account of yours. `sign=-1` reverses the effect.
 */
async function applyTxnEffect(tx: Tx, txn: Transaction, sign: 1 | -1): Promise<void> {
  if (txn.sourceAccountId) {
    await applyToAccount(tx, txn.sourceAccountId, "source", txn.amount, sign);
  }
  if (txn.destinationAccountId) {
    await applyToAccount(tx, txn.destinationAccountId, "destination", txn.amount, sign);
  }
}

export async function insertTransaction(txn: Transaction): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(transactions).values({
      id: txn.id,
      date: txn.date,
      type: txn.type,
      amount: txn.amount,
      category: txn.category,
      sourceAccountId: txn.sourceAccountId ?? null,
      destinationAccountId: txn.destinationAccountId ?? null,
      payee: txn.payee,
      note: txn.note ?? null,
      recurringId: txn.recurringId ?? null,
    });
    await applyTxnEffect(tx, txn, 1);
  });
}

export async function updateTransactionRow(
  id: string,
  input: Transaction,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [old] = await tx.select().from(transactions).where(eq(transactions.id, id));
    if (!old) return;
    await applyTxnEffect(tx, toTransaction(old), -1);
    const updated: Transaction = { ...toTransaction(old), ...input, id };
    await tx
      .update(transactions)
      .set({
        date: updated.date,
        type: updated.type,
        amount: updated.amount,
        category: updated.category,
        sourceAccountId: updated.sourceAccountId ?? null,
        destinationAccountId: updated.destinationAccountId ?? null,
        payee: updated.payee,
        note: updated.note ?? null,
      })
      .where(eq(transactions.id, id));
    await applyTxnEffect(tx, updated, 1);
  });
}

export async function removeTransaction(id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [old] = await tx.select().from(transactions).where(eq(transactions.id, id));
    if (!old) return;
    await applyTxnEffect(tx, toTransaction(old), -1);
    await tx.delete(transactions).where(eq(transactions.id, id));
  });
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
    accountId: h.accountId,
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
      accountId: h.accountId,
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

export function parseRecurringRule(body: unknown): RecurringRule {
  return parseWith(recurringRuleSchema, body);
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
