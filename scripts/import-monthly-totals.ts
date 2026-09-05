/**
 * Import a spreadsheet's monthly income and expense totals as transactions.
 *
 * A budgeting sheet usually keeps one row per month and one column per
 * category, which is a different shape from the per-transaction data the app
 * holds. Each non-zero cell becomes one transaction dated at the month end,
 * carrying the sheet's own column name as the payee so nothing about where it
 * came from is lost in the mapping.
 *
 * Two things it deliberately does not do:
 *
 *   - It does not touch account balances. These are historical totals, already
 *     reflected in the balance the accounts carry today; replaying them through
 *     the usual transaction path would count every dollar twice.
 *   - It does not overwrite. Ids are derived from month, category and payee, so
 *     a second run updates the same rows rather than duplicating them.
 *
 * Usage:
 *   docker exec -e DATABASE_URL=... <container> \
 *     npx tsx scripts/import-monthly-totals.ts <rows.json> --map <map.json> [--commit]
 *
 * `rows.json` is an array of { date, kind: "income"|"expense", sheetCategory,
 * amount }. A negative amount means the money went the other way: a refund or
 * a loan drawn down inside an expense column, which is recorded as income.
 * Without --commit it prints what it would do and changes nothing.
 *
 * `map.json` says where each of the sheet's columns lands — see
 * `monthly-totals.example.json` for the shape. It is a separate file, and one
 * you keep outside the repository, because a column map is a list of the
 * things a particular person spends money on: their lender, their landlord,
 * the people they owe. That belongs with the spreadsheet, not with the code
 * that reads it.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { db } from "@/db/index";
import { accounts, categories, transactions } from "@/db/schema";
import { asc, sql } from "drizzle-orm";

interface SheetRow {
  date: string;
  kind: "income" | "expense";
  sheetCategory: string;
  amount: number;
}

/**
 * Where one of the sheet's columns lands.
 *
 * `expense` and `income` differ because a column can be either: a negative
 * number in a spending column is money coming back — a tax refund, a loan
 * drawn down — and belongs on the other side of the ledger. A column that has
 * a meaning for money arriving says so; the rest are treated as refunds of
 * themselves.
 */
interface ColumnMap {
  expense?: string;
  income?: string;
}

type Mapping = Record<string, ColumnMap>;

const NOTE = "Monthly total imported from a spreadsheet";

function idFor(date: string, category: string, payee: string): string {
  return `sheet-${createHash("sha1").update(`${date}|${category}|${payee}`).digest("hex").slice(0, 24)}`;
}

/** Read the column map, complaining about its shape rather than about the rows. */
function loadMapping(path: string): Mapping {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${path}: expected an object of column -> { expense?, income? }`);
  }
  const out: Mapping = {};
  for (const [column, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${path}: "${column}" should be { expense?, income? }`);
    }
    const { expense, income } = value as Record<string, unknown>;
    if (expense !== undefined && typeof expense !== "string") {
      throw new Error(`${path}: "${column}".expense should be a category name`);
    }
    if (income !== undefined && typeof income !== "string") {
      throw new Error(`${path}: "${column}".income should be a category name`);
    }
    if (expense === undefined && income === undefined) {
      throw new Error(`${path}: "${column}" names neither an expense nor an income category`);
    }
    out[column] = { expense, income } as ColumnMap;
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const mapFlag = args.indexOf("--map");
  const mapPath = mapFlag === -1 ? null : args[mapFlag + 1];
  const commit = args.includes("--commit");
  const file = args.find((a, i) => !a.startsWith("--") && i !== mapFlag + 1);

  if (!file || !mapPath) {
    throw new Error(
      "usage: import-monthly-totals.ts <rows.json> --map <map.json> [--commit]",
    );
  }

  const mapping = loadMapping(mapPath);
  const rows = JSON.parse(readFileSync(file, "utf8")) as SheetRow[];

  // Income has no source account and expenses have no destination; the cash
  // side of both is the chequing account the sheet was tracking.
  const [cash] = await db
    .select()
    .from(accounts)
    .where(sql`${accounts.kind} = 'checking'`)
    .orderBy(asc(accounts.name))
    .limit(1);
  if (!cash) throw new Error("no chequing account to attach these to");

  const unmapped = new Set<string>();
  const prepared: (typeof transactions.$inferInsert)[] = [];
  const newExpenseCategories = new Set<string>();

  for (const row of rows) {
    const map = mapping[row.sheetCategory];
    if (!map) {
      unmapped.add(row.sheetCategory);
      continue;
    }
    const inflow = row.kind === "income" ? row.amount > 0 : row.amount < 0;
    const category = inflow ? (map.income ?? "Refund") : map.expense;
    if (!category) {
      unmapped.add(`${row.sheetCategory} (${inflow ? "inflow" : "outflow"})`);
      continue;
    }
    const amount = Math.abs(row.amount);
    if (!inflow) newExpenseCategories.add(category);
    prepared.push({
      id: idFor(row.date, category, row.sheetCategory),
      date: row.date,
      type: inflow ? "income" : "expense",
      amount,
      category,
      sourceAccountId: inflow ? null : cash.id,
      destinationAccountId: inflow ? cash.id : null,
      payee: row.sheetCategory,
      note: NOTE,
    });
  }

  const income = prepared.filter((p) => p.type === "income");
  const expense = prepared.filter((p) => p.type === "expense");
  const sum = (list: typeof prepared) =>
    list.reduce((t, p) => t + Number(p.amount), 0).toFixed(2);

  console.log(`rows in file:       ${rows.length}`);
  console.log(`columns mapped:     ${Object.keys(mapping).length}`);
  console.log(`prepared:           ${prepared.length}`);
  console.log(`  income:           ${income.length} totalling ${sum(income)}`);
  console.log(`  expense:          ${expense.length} totalling ${sum(expense)}`);
  console.log(`expense categories: ${[...newExpenseCategories].sort().join(", ")}`);
  if (unmapped.size > 0) console.log(`UNMAPPED (skipped): ${[...unmapped].join(", ")}`);
  if (!commit) {
    console.log("\ndry run — pass --commit to write");
    process.exit(0);
  }

  // Categories the transaction form offers for spending come from this table,
  // so a category that only exists on the transactions is one you cannot pick
  // again by hand.
  const existing = new Set((await db.select().from(categories)).map((c) => c.name));
  const toAdd = [...newExpenseCategories].filter((c) => !existing.has(c)).sort();
  if (toAdd.length > 0) {
    await db
      .insert(categories)
      .values(toAdd.map((name, i) => ({ name, position: existing.size + i })))
      .onConflictDoNothing();
    console.log(`added ${toAdd.length} categor${toAdd.length === 1 ? "y" : "ies"}: ${toAdd.join(", ")}`);
  }

  for (const row of prepared) {
    await db
      .insert(transactions)
      .values(row)
      .onConflictDoUpdate({
        target: transactions.id,
        set: {
          date: row.date,
          type: row.type,
          amount: row.amount,
          category: row.category,
          sourceAccountId: row.sourceAccountId ?? null,
          destinationAccountId: row.destinationAccountId ?? null,
          payee: row.payee,
          note: row.note ?? null,
        },
      });
  }
  console.log(`wrote ${prepared.length} transactions (account balances untouched)`);
  process.exit(0);
}

void main();
