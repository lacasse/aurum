/**
 * Import the spreadsheet's monthly account cash flows, pension balance and
 * cash on hand.
 *
 * The trade importer knew what was bought but not what funded it, so buys drew
 * cash out of accounts that had never been shown receiving any: the investment
 * accounts ended up hundreds of thousands of dollars overdrawn on paper. The
 * sheet has the funding — a deposit and withdrawal figure per account per month
 * back to 2020 — and month-end totals for the pension and for cash on hand.
 *
 * What this writes:
 *
 *   - one transfer per non-zero account/month, chequing to the account and back
 *     the other way when the month was a withdrawal;
 *   - the pension account's month-end balances as its history, since the
 *     pension is a balance the employer reports rather than something with
 *     trades behind it;
 *   - the chequing account's month-end cash, which the sheet tracks as one
 *     figure across every account.
 *
 * The partial transfers the trade importer wrote are removed first: the sheet
 * covers the same ground completely, and keeping both would count the deposits
 * that appear in both twice.
 *
 * Usage:
 *   docker exec -e DATABASE_URL=... <container> \
 *     npx tsx scripts/import-account-cashflows.ts <file.json> [--commit]
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { db } from "@/db/index";
import { accounts, transactions } from "@/db/schema";
import { and, eq, like, sql } from "drizzle-orm";

interface CashflowRow {
  month: string; // month-end date, YYYY-MM-DD
  pension: number | null;
  cash: number | null;
  /** What the student loan still owed at that month end, unsigned. */
  loanOwed?: number | null;
  taxable: number | null;
  tfsa: number | null;
  rrsp: number | null;
  fhsa: number | null;
}

/** The sheet's column name for each account, by the app's account name. */
const ACCOUNT_COLUMN: Record<string, keyof CashflowRow> = {
  "Non-registered": "taxable",
  TFSA: "tfsa",
  RRSP: "rrsp",
  FHSA: "fhsa",
};

const NOTE = "Monthly account cash flow imported from the spreadsheet";
const REPLACES = "Historical import%";

function idFor(month: string, account: string): string {
  return `cashflow-${createHash("sha1").update(`${month}|${account}`).digest("hex").slice(0, 24)}`;
}

async function main() {
  const [file, ...flags] = process.argv.slice(2);
  if (!file) throw new Error("usage: import-account-cashflows.ts <file.json> [--commit]");
  const commit = flags.includes("--commit");

  const rows = JSON.parse(readFileSync(file, "utf8")) as CashflowRow[];
  const all = await db.select().from(accounts);
  const byName = new Map(all.map((a) => [a.name, a]));
  const cash = all.find((a) => a.kind === "checking");
  const pension = all.find((a) => a.name.toLowerCase().includes("pension"));
  if (!cash) throw new Error("no chequing account");

  const prepared: (typeof transactions.$inferInsert)[] = [];
  for (const row of rows) {
    for (const [name, column] of Object.entries(ACCOUNT_COLUMN)) {
      const account = byName.get(name);
      const amount = row[column] as number | null;
      if (!account || !amount || Math.round(amount * 100) === 0) continue;
      const into = amount > 0;
      prepared.push({
        id: idFor(row.month, name),
        date: row.month,
        type: "transfer",
        amount: Math.abs(amount),
        category: "Transfer",
        sourceAccountId: into ? cash.id : account.id,
        destinationAccountId: into ? account.id : cash.id,
        payee: into ? `Deposit to ${name}` : `Withdrawal from ${name}`,
        note: NOTE,
      });
    }
  }

  const last = rows[rows.length - 1];
  const pensionHistory = rows
    .filter((r) => r.pension != null)
    .map((r) => ({ month: r.month.slice(0, 7), value: Number(r.pension) }));
  const cashHistory = rows
    .filter((r) => r.cash != null)
    .map((r) => ({ month: r.month.slice(0, 7), value: Number(r.cash) }));
  // Debts are stored as the amount owed, positive.
  const loanHistory = rows
    .filter((r) => r.loanOwed != null)
    .map((r) => ({ month: r.month.slice(0, 7), value: Number(r.loanOwed) }));

  const [{ count: replacing }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(transactions)
    .where(and(eq(transactions.type, "transfer"), like(transactions.note, REPLACES)));

  const perAccount = new Map<string, number>();
  for (const p of prepared) {
    const name = p.payee!.replace(/^(Deposit to|Withdrawal from) /, "");
    const signed = p.payee!.startsWith("Deposit") ? Number(p.amount) : -Number(p.amount);
    perAccount.set(name, (perAccount.get(name) ?? 0) + signed);
  }

  console.log(`transfers to write:   ${prepared.length}`);
  for (const [name, total] of perAccount) {
    console.log(`  ${name.padEnd(16)} net ${total.toFixed(2)}`);
  }
  console.log(`partial transfers to remove: ${replacing}`);
  console.log(`pension history months: ${pensionHistory.length}, latest ${last.pension}`);
  console.log(`cash history months:    ${cashHistory.length}, latest ${last.cash}`);
  console.log(`loan history months:    ${loanHistory.length}, latest ${last.loanOwed ?? "—"}`);
  if (!commit) {
    console.log("\ndry run — pass --commit to write");
    process.exit(0);
  }

  await db
    .delete(transactions)
    .where(and(eq(transactions.type, "transfer"), like(transactions.note, REPLACES)));

  for (const row of prepared) {
    await db
      .insert(transactions)
      .values(row)
      .onConflictDoUpdate({
        target: transactions.id,
        set: {
          date: row.date,
          amount: row.amount,
          sourceAccountId: row.sourceAccountId ?? null,
          destinationAccountId: row.destinationAccountId ?? null,
          payee: row.payee,
          note: row.note ?? null,
        },
      });
  }

  /*
   * Balances are set from the sheet rather than accumulated from the flows.
   * The flows are a record of what moved; the balance is a fact the statements
   * report, and the two only agree if every movement was captured — which for
   * the crypto years it was not.
   */
  if (pension && last.pension != null) {
    await db
      .update(accounts)
      .set({ balance: Number(last.pension), history: pensionHistory })
      .where(eq(accounts.id, pension.id));
  }
  if (last.cash != null) {
    await db
      .update(accounts)
      .set({ balance: Number(last.cash), history: cashHistory })
      .where(eq(accounts.id, cash.id));
  }
  const loan = all.find((a) => a.kind === "loan");
  if (loan && loanHistory.length > 0) {
    await db
      .update(accounts)
      .set({
        balance: loanHistory[loanHistory.length - 1].value,
        history: loanHistory,
      })
      .where(eq(accounts.id, loan.id));
  }

  /*
   * The sheet counts cash on hand once, across every account, and holds it in
   * the figure above: the investment accounts keep no idle cash of their own.
   *
   * Their history goes with the balance. What is in there is the trail of the
   * trade import drawing on money it never saw arrive — a chart of a debt that
   * was never owed — and there is no per-account cash history to put in its
   * place, so it becomes a single point saying nothing rather than a series
   * saying something false.
   */
  const currentMonth = new Date().toISOString().slice(0, 7);
  for (const name of Object.keys(ACCOUNT_COLUMN)) {
    const account = byName.get(name);
    if (!account) continue;
    await db
      .update(accounts)
      .set({ balance: 0, history: [{ month: currentMonth, value: 0 }] })
      .where(eq(accounts.id, account.id));
  }

  console.log(`wrote ${prepared.length} transfers, set pension and cash balances`);
  process.exit(0);
}

void main();
