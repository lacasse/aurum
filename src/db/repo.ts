import { and, asc, desc, eq, gt, inArray, isNull, like, sql } from "drizzle-orm";
import { db } from "./index";
import {
  accounts,
  invites,
  users,
  budgets,
  categories,
  holdings,
  merchantRules,
  monthlySnapshots,
  recurringTransactions,
  transactions,
  userSettings,
} from "./schema";
import {
  Account,
  AccountKind,
  FinanceData,
  Granularity,
  Holding,
  MonthlySnapshot,
  RecurringRule,
  Transaction,
  TxnType,
  balanceDelta,
  movementApplies,
  withBalanceRecorded,
} from "@/lib/types";
import { advanceRule, dueOccurrences } from "@/lib/recurrence";
import {
  REGISTERED_PLANS,
  type ContributionLimits,
  type RegisteredPlan,
  type RoomDeferrals,
} from "@/lib/contributions";
import { todayISO } from "@/lib/format";
import { addMoney } from "@/lib/money";
import { SPEND_GROUPS, type SpendGroup } from "@/lib/expenses";
import {
  DEMO_ACCOUNT_ID_PREFIX,
  DEMO_HOLDING_ID_PREFIX,
  DEMO_RECURRING_ID_PREFIX,
  DEMO_TRANSACTION_ID_PREFIX,
  SAMPLE_BUDGETS,
  type SampleSnapshot,
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
  securityUpdateSchema,
  snapshotSchema,
  snapshotsBodySchema,
  transactionSchema,
} from "@/lib/schemas";
import { PROVIDERS, type ApiKeys } from "@/lib/api-keys";
import { normaliseUsername } from "@/lib/usernames";
import type { InviteRow } from "@/lib/invites";

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
    balanceUSD: row.balanceUSD ?? 0,
    history: row.history,
    registration: (row.registration ?? undefined) as Account["registration"],
    pensionAnnual: row.pensionAnnual ?? undefined,
    pensionService: row.pensionService ?? undefined,
    balanceAsOf: row.balanceAsOf ?? null,
  };
}

function toHolding(row: HoldingRow): Holding {
  return {
    id: row.id,
    ticker: row.ticker,
    name: row.name,
    assetClass: row.assetClass as Holding["assetClass"],
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
    flows: row.flows ?? [],
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
    granularity: (row.granularity as Granularity) ?? "individual",
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

export async function getState(userId: string): Promise<
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
    db.select().from(accounts).where(eq(accounts.userId, userId)).orderBy(asc(accounts.position)),
    db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .orderBy(desc(transactions.date), desc(transactions.id)),
    db.select().from(holdings).where(eq(holdings.userId, userId)).orderBy(asc(holdings.position)),
    db.select().from(budgets).where(eq(budgets.userId, userId)),
    db
      .select()
      .from(categories)
      .where(eq(categories.userId, userId))
      .orderBy(asc(categories.position)),
    db.select().from(merchantRules).where(eq(merchantRules.userId, userId)),
    db
      .select()
      .from(recurringTransactions)
      .where(eq(recurringTransactions.userId, userId))
      .orderBy(asc(recurringTransactions.position)),
    hasDemoData(userId),
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

export async function isSeeded(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(accounts)
    .where(eq(accounts.userId, userId));
  return (row?.count ?? 0) > 0;
}

/* ------------------------------------------------------------------ */
/* Seed / reset                                                        */
/* ------------------------------------------------------------------ */

export async function seed(
  userId: string,
  data: FinanceData,
  snapshotRows: SampleSnapshot[] = [],
): Promise<void> {
  if (data.accounts.length > 0) {
    await db.insert(accounts).values(
      data.accounts.map((a, i) => ({
        id: a.id,
        userId,
        name: a.name,
        institution: a.institution,
        kind: a.kind,
        balance: a.balance,
        balanceUSD: a.balanceUSD ?? 0,
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
        userId,
        date: t.date,
        type: t.type,
        amount: t.amount,
        category: t.category,
        sourceAccountId: t.sourceAccountId ?? null,
        destinationAccountId: t.destinationAccountId ?? null,
        payee: t.payee,
        note: t.note ?? null,
        granularity: t.granularity ?? "individual",
      })),
    );
  }
  if (data.holdings.length > 0) {
    await db.insert(holdings).values(
      data.holdings.map((h, i) => ({
        id: h.id,
        userId,
        ticker: h.ticker,
        name: h.name,
        assetClass: h.assetClass,
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
        flows: h.flows ?? [],
        position: i,
      })),
    );
  }
  if (data.budgets.length > 0) {
    await db
      .insert(budgets)
      .values(data.budgets.map((b) => ({ userId, category: b.category, max: b.limit })));
  }
  if (data.recurring.length > 0) {
    await db
      .insert(recurringTransactions)
      .values(data.recurring.map((r, i) => ({ ...recurringValues(r, i), userId })));
  }
  if (data.categories.length > 0) {
    await db
      .insert(categories)
      .values(data.categories.map((name, i) => ({ userId, name, position: i })));
  }
  /*
   * Month-end valuations for the sample portfolio.
   *
   * Every chart of the portfolio over time reads the recorded record first and
   * falls back to book cost where there is none, so a sample seeded without
   * these draws eighteen months of flat line however good its prices are.
   * Only written for rows this function itself created, and removed by
   * `deleteDemoData` along with the holdings they belong to.
   */
  if (snapshotRows.length > 0) {
    await db.insert(monthlySnapshots).values(snapshotRows.map((r) => ({ ...r, userId })));
  }
}

/** Empties one user's record. Nobody else's rows are touched. */
export async function wipe(userId: string): Promise<void> {
  await db.delete(transactions).where(eq(transactions.userId, userId));
  await db.delete(recurringTransactions).where(eq(recurringTransactions.userId, userId));
  await db.delete(budgets).where(eq(budgets.userId, userId));
  await db.delete(merchantRules).where(eq(merchantRules.userId, userId));
  await db.delete(categories).where(eq(categories.userId, userId));
  await db.delete(holdings).where(eq(holdings.userId, userId));
  await db.delete(accounts).where(eq(accounts.userId, userId));
}

export async function resetToSample(userId: string, data: FinanceData): Promise<void> {
  await wipe(userId);
  await seed(userId, data);
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
  userId: string,
  rule: RecurringRule,
  position: number,
): Promise<void> {
  await db.insert(recurringTransactions).values({ ...recurringValues(rule, position), userId });
}

export async function replaceRecurringRule(userId: string, rule: RecurringRule): Promise<void> {
  const { id: _id, position: _position, ...rest } = recurringValues(rule, 0);
  void _id;
  void _position;
  await db
    .update(recurringTransactions)
    .set(rest)
    .where(and(eq(recurringTransactions.id, rule.id), eq(recurringTransactions.userId, userId)));
}

export async function deleteRecurringRule(userId: string, id: string): Promise<void> {
  await db
    .delete(recurringTransactions)
    .where(and(eq(recurringTransactions.id, id), eq(recurringTransactions.userId, userId)));
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
  userId: string,
  today = todayISO(),
): Promise<number> {
  const rules = (
    await db.select().from(recurringTransactions).where(eq(recurringTransactions.userId, userId))
  ).map(toRecurringRule);
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
          .where(and(eq(transactions.recurringId, rule.id), eq(transactions.userId, userId)))
      ).map((r) => r.date),
    );

    for (const date of due) {
      if (existing.has(date)) continue;
      await insertTransaction(userId, {
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
      .where(and(eq(recurringTransactions.id, rule.id), eq(recurringTransactions.userId, userId)));
  }

  return created;
}

/* ------------------------------------------------------------------ */
/* Demo data                                                           */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Per-user settings                                                   */
/* ------------------------------------------------------------------ */

async function getSetting(userId: string, key: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(userSettings)
    .where(and(eq(userSettings.userId, userId), eq(userSettings.key, key)));
  return row?.value ?? null;
}

async function setSetting(userId: string, key: string, value: string): Promise<void> {
  await db
    .insert(userSettings)
    .values({ userId, key, value })
    .onConflictDoUpdate({ target: [userSettings.userId, userSettings.key], set: { value } });
}

/** Setting key recording that the user deleted the seeded demo data. */
const DEMO_DELETED_KEY = "demo_data_deleted";

/** Escape LIKE wildcards so a prefix is matched literally. */
const startsWith = (prefix: string) =>
  `${prefix.replace(/([%_\\])/g, "\\$1")}%`;

/**
 * True once the user has deleted the demo data. Checked before first-run
 * seeding so an emptied database is not re-populated with samples.
 */
export async function isDemoDeleted(userId: string): Promise<boolean> {
  return (await getSetting(userId, DEMO_DELETED_KEY)) !== null;
}

/**
 * True while any seeded demo row survives. Drives the sidebar's "Delete demo
 * data" button, which is hidden once there is nothing left to delete.
 */
export async function hasDemoData(userId: string): Promise<boolean> {
  const count = sql<number>`count(*)::int`;
  const [demoAccounts, demoHoldings, demoTransactions] = await Promise.all([
    db
      .select({ count })
      .from(accounts)
      .where(and(eq(accounts.userId, userId), like(accounts.id, startsWith(DEMO_ACCOUNT_ID_PREFIX)))),
    db
      .select({ count })
      .from(holdings)
      .where(and(eq(holdings.userId, userId), like(holdings.id, startsWith(DEMO_HOLDING_ID_PREFIX)))),
    db
      .select({ count })
      .from(transactions)
      .where(
        and(eq(transactions.userId, userId), like(transactions.id, startsWith(DEMO_TRANSACTION_ID_PREFIX))),
      ),
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
export async function deleteDemoData(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(monthlySnapshots)
      .where(
        and(
          eq(monthlySnapshots.userId, userId),
          like(monthlySnapshots.holdingId, startsWith(DEMO_HOLDING_ID_PREFIX)),
        ),
      );
    await tx
      .delete(transactions)
      .where(and(eq(transactions.userId, userId), like(transactions.id, startsWith(DEMO_TRANSACTION_ID_PREFIX))));
    await tx
      .delete(holdings)
      .where(and(eq(holdings.userId, userId), like(holdings.id, startsWith(DEMO_HOLDING_ID_PREFIX))));
    await tx
      .delete(accounts)
      .where(and(eq(accounts.userId, userId), like(accounts.id, startsWith(DEMO_ACCOUNT_ID_PREFIX))));
    await tx
      .delete(recurringTransactions)
      .where(
        and(
          eq(recurringTransactions.userId, userId),
          like(recurringTransactions.id, startsWith(DEMO_RECURRING_ID_PREFIX)),
        ),
      );
    await tx.delete(budgets).where(
      and(
        eq(budgets.userId, userId),
        inArray(
          budgets.category,
          SAMPLE_BUDGETS.map((b) => b.category),
        ),
      ),
    );
    /*
     * The seeded contribution room goes with the deposits it measured.
     *
     * Left behind it would be worse than useless: the demo's deposits are gone
     * but its invented limits remain, so the first real contribution is drawn
     * against room nobody has. A figure the app is not certain of, rendered as
     * though it were a fact.
     */
    await tx
      .delete(userSettings)
      .where(
        and(
          eq(userSettings.userId, userId),
          inArray(userSettings.key, [CONTRIBUTION_LIMITS_KEY, ROOM_DEFERRALS_KEY]),
        ),
      );
    await tx
      .insert(userSettings)
      .values({ userId, key: DEMO_DELETED_KEY, value: new Date().toISOString() })
      .onConflictDoNothing();
  });
}

/* ------------------------------------------------------------------ */
/* Allocation targets                                                  */
/* ------------------------------------------------------------------ */

const TARGETS_KEY = "allocation_targets";

/**
 * What share of the portfolio each security is meant to be, by ticker.
 *
 * A single row of JSON rather than a table: it is one small map that is read
 * whole and written whole, and a table would buy nothing but joins. Absent
 * means no targets have been set, which is different from every target being
 * zero — the first draws no comparison, the second says sell everything.
 */
export async function getAllocationTargets(userId: string): Promise<Record<string, number>> {
  const raw = await getSetting(userId, TARGETS_KEY);
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, number> = {};
    for (const [ticker, value] of Object.entries(parsed as Record<string, unknown>)) {
      const pct = Number(value);
      if (Number.isFinite(pct) && pct >= 0) out[ticker.toUpperCase()] = pct;
    }
    return out;
  } catch {
    return {};
  }
}

export async function setAllocationTargets(
  userId: string,
  targets: Record<string, number>,
): Promise<void> {
  const clean: Record<string, number> = {};
  for (const [ticker, value] of Object.entries(targets)) {
    const pct = Number(value);
    // A target of zero is a real answer — "hold none of this" — so it is kept.
    if (Number.isFinite(pct) && pct >= 0 && pct <= 100) {
      clean[ticker.trim().toUpperCase()] = Math.round(pct * 100) / 100;
    }
  }
  await setSetting(userId, TARGETS_KEY, JSON.stringify(clean));
}

/* ------------------------------------------------------------------ */
/* Expense page settings                                               */
/* ------------------------------------------------------------------ */

const CONTRIBUTION_LIMITS_KEY = "contribution_limits";

/**
 * Registered contribution room per plan per year, as entered by hand.
 *
 * None of it can be derived: room depends on income, on unused room carried
 * forward and on withdrawals made years ago, all of it stated on a notice of
 * assessment this app has never seen. Stored per year because room is a fact
 * about a year — a figure entered for this year must not silently restate last
 * year's.
 */
export async function getContributionLimits(userId: string): Promise<ContributionLimits> {
  const raw = await getSetting(userId, CONTRIBUTION_LIMITS_KEY);
  if (raw === null) return {};
  try {
    const parsed = JSON.parse(raw) as ContributionLimits;
    const out: ContributionLimits = {};
    for (const [year, plans] of Object.entries(parsed ?? {})) {
      if (!/^\d{4}$/.test(year) || typeof plans !== "object" || !plans) continue;
      const kept: Partial<Record<RegisteredPlan, number>> = {};
      for (const plan of REGISTERED_PLANS) {
        const v = (plans as Record<string, unknown>)[plan];
        if (typeof v === "number" && Number.isFinite(v) && v >= 0) kept[plan] = v;
      }
      if (Object.keys(kept).length > 0) out[year] = kept;
    }
    return out;
  } catch {
    return {};
  }
}

const ROOM_DEFERRALS_KEY = "contribution_deferrals";

/**
 * Questions the checklist asked and was told "not yet".
 *
 * Kept apart from the limits themselves because they are different kinds of
 * fact: a limit is what the CRA allows, a deferral is what the owner has not
 * looked up. Storing them together would mean a saved limit rewrites the
 * deferral record and vice versa.
 */
export async function getRoomDeferrals(userId: string): Promise<RoomDeferrals> {
  const raw = await getSetting(userId, ROOM_DEFERRALS_KEY);
  if (raw === null) return {};
  try {
    const parsed = JSON.parse(raw) as RoomDeferrals;
    const out: RoomDeferrals = {};
    for (const [year, plans] of Object.entries(parsed ?? {})) {
      if (!/^\d{4}$/.test(year) || typeof plans !== "object" || !plans) continue;
      const kept: Partial<Record<RegisteredPlan, string>> = {};
      for (const plan of REGISTERED_PLANS) {
        const v = (plans as Record<string, unknown>)[plan];
        if (typeof v === "string" && /^\d{4}-\d{2}$/.test(v)) kept[plan] = v;
      }
      if (Object.keys(kept).length > 0) out[year] = kept;
    }
    return out;
  } catch {
    return {};
  }
}

export async function setRoomDeferrals(userId: string, deferrals: RoomDeferrals): Promise<void> {
  await setSetting(userId, ROOM_DEFERRALS_KEY, JSON.stringify(deferrals));
}

export async function setContributionLimits(
  userId: string,
  limits: ContributionLimits,
): Promise<void> {
  await setSetting(userId, CONTRIBUTION_LIMITS_KEY, JSON.stringify(limits));
}

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

export interface UserRow {
  id: string;
  username: string;
  role: "admin" | "member";
  createdAt: string;
  sessionEpoch: number;
}

const asUser = (r: typeof users.$inferSelect): UserRow => ({
  id: r.id,
  username: r.username,
  role: r.role === "admin" ? "admin" : "member",
  createdAt: r.createdAt,
  sessionEpoch: r.sessionEpoch,
});

export async function countUsers(): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  return row?.n ?? 0;
}

/** Usernames are held lowercase, so signing in is not case-sensitive. */
export async function findUserByUsername(username: string): Promise<
  (UserRow & { passwordHash: string }) | null
> {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.username, normaliseUsername(username)));
  return row ? { ...asUser(row), passwordHash: row.passwordHash } : null;
}

export async function findUser(id: string): Promise<UserRow | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row ? asUser(row) : null;
}

export async function listUsers(): Promise<UserRow[]> {
  const rows = await db.select().from(users).orderBy(users.createdAt);
  return rows.map(asUser);
}

/**
 * Adds a user. Fails rather than overwrites when the name is taken: the unique
 * index is the authority, so two people signing up at once cannot both win.
 */
export async function insertUser(user: {
  id: string;
  username: string;
  passwordHash: string;
  role: "admin" | "member";
  createdAt: string;
  sessionEpoch?: number;
}): Promise<void> {
  await db.insert(users).values({ ...user, username: normaliseUsername(user.username) });
}

/** The account that owns an installation's first record: the earliest admin. */
export async function firstAdmin(): Promise<UserRow | null> {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.role, "admin"))
    .orderBy(asc(users.createdAt), asc(users.id))
    .limit(1);
  return row ? asUser(row) : null;
}

/** The name migration 0027 gave the account it created to own existing rows. */
export const PLACEHOLDER_USERNAME = "__unclaimed__";

/**
 * Turns the placeholder owner into the deployment's own account, if it is
 * still waiting to be claimed. True when it was claimed by this call.
 */
export async function claimPlaceholderOwner(
  username: string,
  passwordHash: string,
): Promise<boolean> {
  const claimed = await db
    .update(users)
    .set({ username: normaliseUsername(username), passwordHash })
    .where(eq(users.username, PLACEHOLDER_USERNAME))
    .returning({ id: users.id });
  return claimed.length > 0;
}

/** A new password ends every session the user had, by raising their epoch. */
export async function setUserPassword(id: string, passwordHash: string): Promise<void> {
  await db
    .update(users)
    .set({ passwordHash, sessionEpoch: sql`${users.sessionEpoch} + 1` })
    .where(eq(users.id, id));
}

/* ------------------------------------------------------------------ */
/* Invitations                                                         */
/* ------------------------------------------------------------------ */

export async function insertInvite(invite: {
  id: string;
  tokenHash: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
}): Promise<void> {
  await db.insert(invites).values(invite);
}

/** Every invitation, newest first. Never the token or its hash. */
export async function listInvites(): Promise<InviteRow[]> {
  return db
    .select({
      id: invites.id,
      createdBy: invites.createdBy,
      createdAt: invites.createdAt,
      expiresAt: invites.expiresAt,
      acceptedAt: invites.acceptedAt,
      acceptedBy: invites.acceptedBy,
    })
    .from(invites)
    .orderBy(desc(invites.createdAt));
}

/**
 * Stops an invitation working by moving its expiry to now. The row stays, as a
 * record of who was invited and when; only the link stops.
 */
export async function revokeInvite(id: string, now = new Date()): Promise<boolean> {
  const done = await db
    .update(invites)
    .set({ expiresAt: now.toISOString() })
    .where(and(eq(invites.id, id), isNull(invites.acceptedAt)))
    .returning({ id: invites.id });
  return done.length > 0;
}

/** Whether a token belongs to an invitation that could still be accepted. */
export async function inviteIsUsable(tokenHash: string, now = new Date()): Promise<boolean> {
  const [row] = await db
    .select({ id: invites.id })
    .from(invites)
    .where(
      and(
        eq(invites.tokenHash, tokenHash),
        isNull(invites.acceptedAt),
        gt(invites.expiresAt, now.toISOString()),
      ),
    );
  return row !== undefined;
}

export class InviteUnusableError extends Error {}
export class UsernameTakenError extends Error {}

/**
 * Turns an invitation into an account, once.
 *
 * The invitation is claimed and the user created in one transaction. The claim
 * is a conditional update — only an unused, unexpired invitation matches — so
 * two people using the same link at the same moment cannot both succeed: one
 * update wins and the other finds nothing to claim. If creating the account
 * fails, a taken username say, the whole transaction rolls back and the
 * invitation is still good for another try.
 */
export async function acceptInvite(
  tokenHash: string,
  user: { id: string; username: string; passwordHash: string; createdAt: string },
  now = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const claimed = await tx
      .update(invites)
      .set({ acceptedAt: now.toISOString(), acceptedBy: user.id })
      .where(
        and(
          eq(invites.tokenHash, tokenHash),
          isNull(invites.acceptedAt),
          gt(invites.expiresAt, now.toISOString()),
        ),
      )
      .returning({ id: invites.id });
    if (claimed.length === 0) throw new InviteUnusableError();
    const username = normaliseUsername(user.username);
    const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.username, username));
    if (taken) throw new UsernameTakenError();
    await tx.insert(users).values({ ...user, username, role: "member" });
  });
}

const API_KEYS_KEY = "api_keys";

/**
 * One user's market-data keys, if they have saved any.
 *
 * Secrets, kept with the record of the person they belong to. Nothing here decides which
 * key is used — that is `src/db/api-keys.ts`, which weighs these against the
 * environment — and nothing here reaches the browser: the settings route sends
 * a description of a key, never a key.
 */
export async function getSavedApiKeys(userId: string): Promise<Partial<ApiKeys>> {
  const raw = await getSetting(userId, API_KEYS_KEY);
  if (raw === null) return {};
  try {
    const parsed = JSON.parse(raw) as Partial<ApiKeys>;
    const out: Partial<ApiKeys> = {};
    for (const provider of PROVIDERS) {
      const value = parsed?.[provider];
      if (typeof value === "string" && value.trim() !== "") out[provider] = value.trim();
    }
    return out;
  } catch {
    return {};
  }
}

/** Saves the keys given, and removes the ones set to an empty string. */
export async function setSavedApiKeys(userId: string, next: Partial<ApiKeys>): Promise<void> {
  const current = await getSavedApiKeys(userId);
  const merged: Partial<ApiKeys> = { ...current };
  for (const provider of PROVIDERS) {
    if (!(provider in next)) continue;
    const value = (next[provider] ?? "").trim();
    if (value === "") delete merged[provider];
    else merged[provider] = value;
  }
  await setSetting(userId, API_KEYS_KEY, JSON.stringify(merged));
}

const EXPENSE_SETTINGS_KEY = "expense_settings";

/**
 * The two judgements the expenses page cannot make on its own: which
 * categories count as necessities, and which of them belong to the car.
 *
 * Only the departures from the defaults are stored, so a category added later
 * picks up the default rather than being silently frozen at whatever the map
 * happened to say when it was written.
 */
export interface ExpenseSettings {
  groups: Record<string, SpendGroup>;
  car: { start: string; categories: string[] } | null;
}

export async function getExpenseSettings(userId: string): Promise<ExpenseSettings> {
  const empty: ExpenseSettings = { groups: {}, car: null };
  const raw = await getSetting(userId, EXPENSE_SETTINGS_KEY);
  if (raw === null) return empty;
  try {
    const parsed = JSON.parse(raw) as Partial<ExpenseSettings>;
    const groups: Record<string, SpendGroup> = {};
    for (const [category, group] of Object.entries(parsed.groups ?? {})) {
      if (SPEND_GROUPS.includes(group as SpendGroup)) {
        groups[category] = group as SpendGroup;
      }
    }
    const car =
      parsed.car && /^\d{4}-\d{2}$/.test(parsed.car.start)
        ? {
            start: parsed.car.start,
            categories: (parsed.car.categories ?? []).filter(
              (c): c is string => typeof c === "string",
            ),
          }
        : null;
    return { groups, car };
  } catch {
    return empty;
  }
}

export async function setExpenseSettings(userId: string, s: ExpenseSettings): Promise<void> {
  await setSetting(userId, EXPENSE_SETTINGS_KEY, JSON.stringify(s));
}

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

export async function insertAccount(userId: string, a: Account, position: number): Promise<void> {
  await db.insert(accounts).values({
    id: a.id,
    userId,
    name: a.name,
    institution: a.institution,
    kind: a.kind,
    balance: a.balance,
    balanceUSD: a.balanceUSD ?? 0,
    history: a.history,
    position,
    registration: a.registration ?? null,
    pensionAnnual: a.pensionAnnual ?? null,
    pensionService: a.pensionService ?? null,
    balanceAsOf: a.balanceAsOf ?? null,
  });
}

export async function replaceAccount(userId: string, a: Account): Promise<void> {
  await db
    .update(accounts)
    .set({
      name: a.name,
      institution: a.institution,
      kind: a.kind,
      balance: a.balance,
      balanceUSD: a.balanceUSD ?? 0,
      history: a.history,
      registration: a.registration ?? null,
      pensionAnnual: a.pensionAnnual ?? null,
      pensionService: a.pensionService ?? null,
      balanceAsOf: a.balanceAsOf ?? null,
    })
    .where(and(eq(accounts.id, a.id), eq(accounts.userId, userId)));
}

export async function deleteAccountRow(userId: string, id: string): Promise<void> {
  await db.delete(accounts).where(and(eq(accounts.id, id), eq(accounts.userId, userId)));
}

export async function nextPosition(
  userId: string,
  table:
    | typeof accounts
    | typeof holdings
    | typeof categories
    | typeof recurringTransactions,
): Promise<number> {
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${table.position}), -1)::int` })
    .from(table)
    .where(eq(table.userId, userId));
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
  userId: string,
  accountId: string,
  side: "source" | "destination",
  amount: number,
  sign: 1 | -1,
  date?: string,
): Promise<void> {
  /*
   * The owner is part of the lookup, not a check after it. A transaction names
   * its accounts by id, and an id arrives in a request body: without this, a
   * transaction naming somebody else's account would move their balance.
   */
  const [acc] = await tx
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
  if (!acc) return;
  /*
   * A transaction dated on or before the balance the user last stated by hand
   * is already inside that figure. Applying it again is double counting, and
   * it is silent: the balance simply drifts. The transaction is still stored —
   * it belongs in the history and on every chart — it just does not move a
   * number somebody has already reconciled.
   */
  if (!movementApplies(toAccount(acc), date)) return;
  const delta = balanceDelta(acc.kind as AccountKind, side, amount) * sign;
  const balance = addMoney(acc.balance, delta);
  /*
   * The same rule as the client's optimistic update, from the same function:
   * record against the current month by name. Writing to the last element of
   * the array assumed it was this month, which it is not once a month has
   * closed — August's spending was landing on July's recorded balance.
   */
  const { history } = withBalanceRecorded({ ...toAccount(acc), balance });
  await tx
    .update(accounts)
    .set({ balance, history })
    .where(and(eq(accounts.id, acc.id), eq(accounts.userId, userId)));
}

/**
 * Apply a transaction to both of its sides. A transfer touches two accounts
 * and nets to zero across them; income and expenses touch only the one side
 * that is an account of yours. `sign=-1` reverses the effect.
 */
async function applyTxnEffect(
  tx: Tx,
  userId: string,
  txn: Transaction,
  sign: 1 | -1,
): Promise<void> {
  if (txn.sourceAccountId) {
    await applyToAccount(tx, userId, txn.sourceAccountId, "source", txn.amount, sign, txn.date);
  }
  if (txn.destinationAccountId) {
    await applyToAccount(
      tx, userId, txn.destinationAccountId, "destination", txn.amount, sign, txn.date,
    );
  }
}

export async function insertTransaction(userId: string, txn: Transaction): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(transactions).values({
      id: txn.id,
      userId,
      date: txn.date,
      type: txn.type,
      amount: txn.amount,
      category: txn.category,
      sourceAccountId: txn.sourceAccountId ?? null,
      destinationAccountId: txn.destinationAccountId ?? null,
      payee: txn.payee,
      note: txn.note ?? null,
      recurringId: txn.recurringId ?? null,
      granularity: txn.granularity ?? "individual",
    });
    await applyTxnEffect(tx, userId, txn, 1);
  });
}

export async function updateTransactionRow(
  userId: string,
  id: string,
  input: Transaction,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [old] = await tx
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.userId, userId)));
    if (!old) return;
    await applyTxnEffect(tx, userId, toTransaction(old), -1);
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
        granularity: updated.granularity ?? "individual",
      })
      .where(and(eq(transactions.id, id), eq(transactions.userId, userId)));
    await applyTxnEffect(tx, userId, updated, 1);
  });
}

export async function removeTransaction(userId: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [old] = await tx
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.userId, userId)));
    if (!old) return;
    await applyTxnEffect(tx, userId, toTransaction(old), -1);
    await tx
      .delete(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.userId, userId)));
  });
}

/* ------------------------------------------------------------------ */
/* Holdings                                                            */
/* ------------------------------------------------------------------ */

export async function insertHolding(userId: string, h: Holding, position: number): Promise<void> {
  await db.insert(holdings).values({
    id: h.id,
    userId,
    ticker: h.ticker,
    name: h.name,
    assetClass: h.assetClass,
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
    flows: h.flows ?? [],
    position,
  });
}

/**
 * Rename a security, or move it to another asset class, everywhere it is held.
 *
 * Ticker, name and asset class describe the security itself, so they cannot
 * differ between two accounts holding it — the holdings page pools by ticker,
 * and a rename applied to one account only would split the position in two.
 * One statement covers every row, so a rename cannot land half-applied.
 *
 * A manual price can ride along. It is deliberately not sticky: the next price
 * refresh writes over it, which is the point — the manual figure fills the gap
 * until the feed can quote the security again.
 *
 * Returns the number of rows changed, which is what the caller reports.
 */
export async function updateSecurity(
  userId: string,
  ticker: string,
  next: {
    ticker: string;
    name: string;
    assetClass: string;
    price?: number;
    priceCAD?: number;
    currency?: string;
  },
): Promise<number> {
  const where = and(eq(holdings.userId, userId), sql`upper(${holdings.ticker}) = upper(${ticker})`);

  const rows = await db
    .update(holdings)
    .set({
      ticker: next.ticker,
      name: next.name,
      assetClass: next.assetClass,
    })
    .where(where)
    .returning({ id: holdings.id });

  /*
   * A manual price is a separate statement because it reaches fewer rows: only
   * the lots quoted in the same currency as the one that was edited, since the
   * number typed in is a price in that currency and nothing converts it for a
   * lot listed elsewhere.
   *
   * `history` carries the monthly prices and ends on the current one, so its
   * last entry moves with the price — otherwise the chart's final point and
   * the table would disagree by exactly the manual correction.
   */
  if (next.price != null && next.priceCAD != null) {
    const last = sql`greatest(jsonb_array_length(${holdings.history}) - 1, 0)::text`;
    const lastCad = sql`greatest(jsonb_array_length(${holdings.historyCAD}) - 1, 0)::text`;
    await db
      .update(holdings)
      .set({
        price: next.price,
        priceCAD: next.priceCAD,
        history: sql`CASE WHEN jsonb_array_length(${holdings.history}) > 0
          THEN jsonb_set(${holdings.history}, ARRAY[${last}], to_jsonb(${next.price}::numeric))
          ELSE ${holdings.history} END`,
        historyCAD: sql`CASE WHEN jsonb_array_length(${holdings.historyCAD}) > 0
          THEN jsonb_set(${holdings.historyCAD}, ARRAY[${lastCad}], to_jsonb(${next.priceCAD}::numeric))
          ELSE ${holdings.historyCAD} END`,
      })
      .where(
        and(
          eq(holdings.userId, userId),
          sql`upper(${holdings.ticker}) = upper(${next.ticker}) and ${holdings.currency} = ${next.currency ?? "CAD"}`,
        ),
      );
  }

  return rows.length;
}

export async function replaceHolding(userId: string, h: Holding): Promise<void> {
  await db
    .update(holdings)
    .set({
      ticker: h.ticker,
      name: h.name,
      assetClass: h.assetClass,
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
      flows: h.flows ?? [],
    })
    .where(and(eq(holdings.id, h.id), eq(holdings.userId, userId)));
}

export async function deleteHoldingRow(userId: string, id: string): Promise<void> {
  await db.delete(holdings).where(and(eq(holdings.id, id), eq(holdings.userId, userId)));
}

/* ------------------------------------------------------------------ */
/* Budgets / categories / merchant rules                               */
/* ------------------------------------------------------------------ */

export async function upsertBudget(userId: string, category: string, limit: number): Promise<void> {
  await db
    .insert(budgets)
    .values({ userId, category, max: limit })
    .onConflictDoUpdate({ target: [budgets.userId, budgets.category], set: { max: limit } });
}

export async function deleteBudgetRow(userId: string, category: string): Promise<void> {
  await db
    .delete(budgets)
    .where(and(eq(budgets.userId, userId), eq(budgets.category, category)));
}

export async function insertCategory(userId: string, name: string, position: number): Promise<void> {
  await db.insert(categories).values({ userId, name, position }).onConflictDoNothing();
}

export async function renameCategoryEverywhere(
  userId: string,
  oldName: string,
  newName: string,
): Promise<void> {
  await db
    .update(categories)
    .set({ name: newName })
    .where(and(eq(categories.userId, userId), eq(categories.name, oldName)));
  await db
    .update(budgets)
    .set({ category: newName })
    .where(and(eq(budgets.userId, userId), eq(budgets.category, oldName)));
  await db
    .update(transactions)
    .set({ category: newName })
    .where(and(eq(transactions.userId, userId), eq(transactions.category, oldName)));
}

export async function deleteCategoryEverywhere(
  userId: string,
  name: string,
  fallback: string,
): Promise<void> {
  await db
    .delete(categories)
    .where(and(eq(categories.userId, userId), eq(categories.name, name)));
  await db.delete(budgets).where(and(eq(budgets.userId, userId), eq(budgets.category, name)));
  await db
    .update(transactions)
    .set({ category: fallback })
    .where(and(eq(transactions.userId, userId), eq(transactions.category, name)));
}

/** Deletes a category and re-homes its transactions ("Other" if available). */
export async function deleteCategorySmart(userId: string, name: string): Promise<void> {
  const rows = await db
    .select()
    .from(categories)
    .where(eq(categories.userId, userId))
    .orderBy(asc(categories.position));
  const rest = rows.map((r) => r.name).filter((n) => n !== name);
  const fallback = rest.includes("Other") ? "Other" : rest[0] ?? name;
  await deleteCategoryEverywhere(userId, name, fallback);
}

export async function upsertMerchantRule(
  userId: string,
  merchant: string,
  category: string,
): Promise<void> {
  await db
    .insert(merchantRules)
    .values({ userId, merchant, category })
    .onConflictDoUpdate({ target: [merchantRules.userId, merchantRules.merchant], set: { category } });
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

export function parseSecurityUpdate(body: unknown): {
  from: string;
  ticker: string;
  name: string;
  assetClass: string;
  price?: number;
  priceCAD?: number;
  currency: string;
} {
  return parseWith(securityUpdateSchema, body);
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

/**
 * Every month's portfolio value, pooled per ticker.
 *
 * The chart asks "what was this worth" per security, not per account, so the
 * pooling happens here. Where the imported spreadsheet history covers a month
 * it is used alone rather than added to any per-lot rows for the same ticker:
 * the sheet figure is already the whole position, so summing the two would
 * count it twice.
 */
export async function getSnapshotHistory(userId: string): Promise<
  Record<string, Record<string, number>>
> {
  const rows = await db
    .select({
      month: monthlySnapshots.month,
      ticker: monthlySnapshots.ticker,
      value: sql<string>`COALESCE(
        SUM(${monthlySnapshots.valueCAD}) FILTER (WHERE ${monthlySnapshots.holdingId} LIKE 'sheet:%'),
        SUM(${monthlySnapshots.valueCAD})
      )`,
    })
    .from(monthlySnapshots)
    .where(eq(monthlySnapshots.userId, userId))
    .groupBy(monthlySnapshots.month, monthlySnapshots.ticker);

  const out: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    const value = Number(row.value);
    if (!Number.isFinite(value) || value === 0) continue;
    (out[row.month] ??= {})[row.ticker.toUpperCase()] = value;
  }
  return out;
}

export async function getSnapshots(userId: string, month: string): Promise<MonthlySnapshot[]> {
  const rows = await db
    .select()
    .from(monthlySnapshots)
    .where(and(eq(monthlySnapshots.userId, userId), eq(monthlySnapshots.month, month)));
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

export async function upsertSnapshots(userId: string, rows: MonthlySnapshot[]): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(monthlySnapshots)
    .values(
      rows.map((r) => ({
        userId,
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
      target: [monthlySnapshots.userId, monthlySnapshots.month, monthlySnapshots.holdingId],
      set: {
        price: sql`excluded.price`,
        avgCost: sql`excluded.avg_cost`,
        shares: sql`excluded.shares`,
        value: sql`excluded.value`,
        valueCAD: sql`excluded.value_cad`,
      },
    });
}
