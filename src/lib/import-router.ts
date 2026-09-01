import Papa from "papaparse";
import {
  ImportedRow,
  SignConvention,
  detectFormat,
  parseCsvRecords,
} from "./csv";
import { TradeRow, parseTradeCsv } from "./trades";
import { isActivityExport, parseActivitiesCsv } from "./activities";
import { CorporateAction } from "./corporate-actions";

/**
 * One import, whatever the file happens to be.
 *
 * Splitting the page by format made the person do the routing: know that a
 * card statement goes through one door and a trade export through another, and
 * that a brokerage activity report — which is both at once — goes through
 * neither. The format is a property of the file, and the file can say which it
 * is, so it says so here instead.
 */

export type FileKind = "card" | "bank" | "trades" | "activities";

export interface RoutedFile {
  fileName: string;
  kind: FileKind | null;
  cash: ImportedRow[];
  trades: TradeRow[];
  actions: CorporateAction[];
  skipped: { reason: string; count: number }[];
  needsAttention: string[];
  /**
   * Which sign the file used for money going out, and how that was decided.
   * Null for files whose rows name their own direction.
   */
  signs?: SignConvention | null;
  error?: string;
}

const KIND_LABEL: Record<FileKind, string> = {
  card: "card statement",
  bank: "bank statement",
  trades: "trade history",
  activities: "account activity",
};

export function labelFor(kind: FileKind | null): string {
  return kind ? KIND_LABEL[kind] : "unrecognised";
}

/** Column names that mean a hand-kept trade log rather than a bank export. */
function isTradeLog(fields: string[] | undefined): boolean {
  if (!fields) return false;
  const set = new Set(fields.map((f) => f.replace(/^﻿/, "").trim().toLowerCase()));
  return set.has("ticker") && (set.has("type") || set.has("quantity"));
}

function readText(file: File): Promise<string> {
  return file.text();
}

export async function routeFile(
  file: File,
  existingTxnKeys: Set<string>,
  existingTradeKeys: Set<string>,
  merchantRules: Record<string, string>,
  userCategories?: readonly string[],
): Promise<RoutedFile> {
  let text: string;
  try {
    text = await readText(file);
  } catch {
    return blank(file.name, "Could not read the file.");
  }

  const head = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.replace(/^﻿/, "").trim(),
    preview: 1,
  });
  const fields = head.meta.fields;

  if (isActivityExport(fields)) {
    const res = parseActivitiesCsv(
      file.name,
      text,
      existingTxnKeys,
      existingTradeKeys,
      merchantRules,
      userCategories,
    );
    return {
      fileName: file.name,
      kind: "activities",
      cash: res.cash,
      trades: res.trades,
      actions: res.actions,
      skipped: res.skipped,
      needsAttention: res.needsAttention,
    };
  }

  const format = detectFormat(fields);
  if (format) {
    const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.replace(/^﻿/, "").trim(),
    });
    const res = parseCsvRecords(
      file.name,
      parsed.meta.fields,
      parsed.data,
      existingTxnKeys,
      merchantRules,
      userCategories,
    );
    return {
      fileName: file.name,
      /*
       * A file with debit and credit columns is an account export, not a card
       * one — which is what decides the account it lands in by default. The
       * two are opposite: a card statement's rows belong to the credit card,
       * a bank statement's to chequing.
       */
      kind: format === "debit-credit" ? "bank" : "card",
      cash: res.rows,
      trades: [],
      actions: [],
      skipped: [
        { reason: "card payments", count: res.skippedPayments },
        { reason: "rows that could not be read", count: res.skippedInvalid },
      ].filter((s) => s.count > 0),
      needsAttention: [],
      signs: res.signs,
      error: res.error,
    };
  }

  if (isTradeLog(fields)) {
    const rows = parseTradeCsv(file.name, text, existingTradeKeys);
    return {
      fileName: file.name,
      kind: "trades",
      cash: [],
      trades: rows,
      actions: [],
      skipped: [],
      needsAttention: [],
    };
  }

  return blank(
    file.name,
    "Unrecognised columns. This reads card statements, brokerage activity exports, and trade logs.",
  );
}

function blank(fileName: string, error: string): RoutedFile {
  return {
    fileName,
    kind: null,
    cash: [],
    trades: [],
    actions: [],
    skipped: [],
    needsAttention: [],
    error,
  };
}
