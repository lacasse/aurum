"use client";

import { getSettings, saveSettings } from "./api";
import { tradeKey, type TradeRow } from "./trades";

/**
 * Currency conversions already applied, by import key.
 *
 * Shared by the import page and the monthly checklist: a conversion moves cash
 * and leaves no other record, so this list is the only way a second import of
 * the same file knows to leave it alone. Its keys go in with the stored trade
 * keys, and the parser then marks those rows as duplicates like any other.
 */
export async function loadAppliedConversions(): Promise<string[]> {
  try {
    const { keys } = await getSettings<{ keys?: string[] }>("/api/conversions");
    return keys ?? [];
  } catch {
    return [];
  }
}

/** Record the conversions just applied. The whole list goes, since the demo keeps it in one value. */
export async function recordConversions(rows: TradeRow[], known: string[]): Promise<void> {
  const keys = rows.filter((r) => r.type === "conversion").map(tradeKey);
  if (keys.length === 0) return;
  await saveSettings("/api/conversions", { keys: [...new Set([...known, ...keys])] });
}
