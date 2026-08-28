/**
 * Parsing and aggregation for the brokerage-trade importer.
 *
 * Kept out of the page component so it can be tested directly. The logic here
 * previously lived inline and, untested, silently filed an entire portfolio
 * into one account and created a separate position for every row.
 */
import Papa from "papaparse";
import { Currency, Holding, Registration } from "./types";
import { todayISO } from "./format";

export type TradeType = "buy" | "sell" | "dividend" | "deposit" | "withdrawal";

export interface TradeRow {
  id: string;
  date: string;
  type: TradeType;
  ticker: string;
  quantity: number;
  pricePerUnit: number;
  /** The amount as traded, in the security's listing currency. */
  transactedAmount: number;
  /**
   * Null when the CSV's account type was not recognised. Left null rather than
   * defaulted, so an unreadable value is reported instead of quietly filing the
   * trade in the wrong account.
   */
  registration: Registration | null;
  /** The raw account-type text, kept so an unmatched row can name it. */
  registrationRaw: string;
  /**
   * A manual CAD conversion in the export means the trade settled in another
   * currency and had to be converted — i.e. the security is US-listed. Its
   * absence means the trade was already in CAD.
   */
  currency: Currency;
  /** The trade in CAD: the manual conversion when there is one. */
  amountCad: number;
  include: boolean;
  error?: string;
  sourceFile: string;
}

export function parseTradeDate(raw: string | undefined): string {
  if (!raw) return todayISO();
  const s = raw.trim();
  // YYYY-MM-DD or YYYY/MM/DD
  const iso = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  // MM/DD/YYYY or DD/MM/YYYY (assume MM first)
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return todayISO();
}

export function parseNum(raw: string | undefined): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[^0-9.\-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeType(raw: string | undefined): TradeType {
  const s = (raw ?? "").trim().toLowerCase();
  if (s === "buy" || s === "purchase") return "buy";
  if (s === "sell" || s === "sale") return "sell";
  if (s === "dividend" || s === "div") return "dividend";
  if (s === "deposit" || s === "contribution") return "deposit";
  if (s === "withdrawal" || s === "withdraw" || s === "withdrawal") return "withdrawal";
  return "buy";
}

/**
 * Map the export's account-type text onto a registration.
 *
 * Returns null for anything unrecognised. The previous default of
 * "non-registered" meant a typo or a new account type was silently filed under
 * whichever account happened to match, which is how an entire import ended up
 * in one account.
 */
export function normalizeAccountType(raw: string | undefined): Registration | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s.includes("tfsa")) return "TFSA";
  if (s.includes("rrsp") || s.includes("rrif")) return "RRSP";
  if (s.includes("fhsa")) return "FHSA";
  if (s.includes("pension") || s.includes("lira") || s.includes("rpp")) return "Pension";
  // Brokerages label an ordinary account by its tax treatment, not by a
  // registration it does not have.
  if (
    s.includes("taxable") ||
    s.includes("non-registered") ||
    s.includes("non registered") ||
    s.includes("nonregistered") ||
    s.includes("unregistered") ||
    s.includes("cash") ||
    s.includes("margin")
  ) {
    return "non-registered";
  }
  return null;
}

let seq = 0;
function rowId(): string {
  seq += 1;
  return `trade-${Date.now().toString(36)}-${seq}`;
}

export function parseTradeCsv(fileName: string, csvText: string): TradeRow[] {
  const result = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim(),
  });

  const rows: TradeRow[] = [];
  for (const raw of result.data as Record<string, string>[]) {
    // Match columns by header name (case-insensitive)
    const get = (name: string) => {
      for (const k of Object.keys(raw)) {
        if (k.toLowerCase().replace(/\s+/g, " ").trim() === name.toLowerCase()) {
          return raw[k];
        }
      }
      return undefined;
    };

    const type = normalizeType(get("Type") ?? get("type"));
    const ticker = (get("Ticker") ?? get("ticker") ?? "").trim().toUpperCase();
    const quantity = parseNum(get("Quantity") ?? get("quantity"));
    const pricePerUnit = parseNum(get("Price per unit") ?? get("price per unit") ?? get("price"));
    const transactedAmount = parseNum(get("Transacted amount") ?? get("transacted amount") ?? get("amount"));
    const registrationRaw = (get("account type") ?? get("accounttype") ?? "").trim();
    const registration = normalizeAccountType(registrationRaw);
    const manualCadRaw =
      get("Manual CAD Conversion") ?? get("manual cad conversion") ?? get("cad") ?? get("cad conversion");
    const manualCad = parseNum(manualCadRaw);

    // Skip empty rows
    if (!type && !ticker && transactedAmount === 0) continue;

    /*
     * A CAD conversion was only ever needed because the trade did not settle in
     * CAD, so its presence identifies a US-listed security. Without it the
     * trade was already in CAD and the two amounts are the same.
     */
    const converted = manualCad !== 0;
    const currency: Currency = converted ? "USD" : "CAD";
    const amountCad = converted ? Math.abs(manualCad) : Math.abs(transactedAmount);

    rows.push({
      id: rowId(),
      date: parseTradeDate(get("Date") ?? get("date")),
      type,
      ticker,
      quantity,
      pricePerUnit,
      transactedAmount: Math.abs(transactedAmount),
      registration,
      registrationRaw,
      currency,
      amountCad,
      include: registration !== null,
      error:
        registration === null
          ? registrationRaw
            ? `Unrecognized account type "${registrationRaw}"`
            : "No account type in this row"
          : undefined,
      sourceFile: fileName,
    });
  }

  return rows;
}


/* ------------------------------------------------------------------ */
/* Aggregation                                                         */
/* ------------------------------------------------------------------ */

/** A security's running position in one account, built up across trades. */
export interface Position {
  /** Set when these trades land on a position that already exists. */
  existing?: Holding;
  ticker: string;
  accountId: string;
  currency: Currency;
  shares: number;
  /** Pooled cost of the shares still held, in the listing currency. */
  costNative: number;
  /** The same cost in CAD, at the rates actually paid. */
  costCad: number;
  dividendsNative: number;
  dividendsCad: number;
  lastPrice: number;
  /**
   * Whether any shares were ever bought. A position bought and sold within one
   * import ends at zero shares but is still a realized gain worth recording,
   * and cannot be told apart from an empty position by its totals alone.
   */
  everHeld: boolean;
}

export interface AccumulationResult {
  positions: Position[];
  /** Net cash movement per account: buys spend it, sells and dividends add it. */
  cashDeltas: Map<string, number>;
  /** Deposits and withdrawals, to be posted as transfers by the caller. */
  transfers: {
    date: string;
    registration: Registration;
    accountId: string;
    amount: number;
    deposit: boolean;
  }[];
  /** Rows dropped because their account type could not be resolved. */
  skipped: number;
}

/**
 * Fold trades into one position per ticker-and-account.
 *
 * The running totals live here rather than being read back from the store
 * between rows. Reading the store's snapshot per row meant every buy of a
 * ticker looked like the first one and created another position — 219 rows
 * became 219 holdings instead of 29.
 */
export function accumulatePositions(
  rows: TradeRow[],
  accountIdFor: (registration: Registration) => string,
  existingHoldings: Holding[],
): AccumulationResult {
  const positions = new Map<string, Position>();
  const cashDeltas = new Map<string, number>();
  const transfers: AccumulationResult["transfers"] = [];
  let skipped = 0;

  const moveCash = (accountId: string, delta: number) =>
    cashDeltas.set(accountId, (cashDeltas.get(accountId) ?? 0) + delta);

  const positionFor = (row: TradeRow, accountId: string): Position => {
    const key = `${row.ticker}|${accountId}`;
    const found = positions.get(key);
    if (found) return found;
    const existing = existingHoldings.find(
      (h) => h.ticker.toUpperCase() === row.ticker && h.accountId === accountId,
    );
    const fresh: Position = existing
      ? {
          existing,
          ticker: existing.ticker,
          accountId,
          currency: existing.currency,
          shares: existing.shares,
          costNative: existing.shares * existing.avgCost,
          costCad: existing.shares * (existing.avgCostCAD ?? existing.avgCost),
          everHeld: true,
          dividendsNative: existing.dividendsReceived ?? 0,
          dividendsCad: existing.dividendsReceivedCAD ?? existing.dividendsReceived ?? 0,
          lastPrice: existing.price,
        }
      : {
          ticker: row.ticker,
          accountId,
          currency: row.currency,
          shares: 0,
          costNative: 0,
          costCad: 0,
          everHeld: false,
          dividendsNative: 0,
          dividendsCad: 0,
          lastPrice: row.pricePerUnit,
        };
    positions.set(key, fresh);
    return fresh;
  };

  // Chronological, so an average cost is never computed from a later buy.
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));

  for (const row of sorted) {
    if (row.registration === null) {
      skipped += 1;
      continue;
    }
    const accountId = accountIdFor(row.registration);
    if (!accountId) {
      skipped += 1;
      continue;
    }

    if (row.type === "deposit" || row.type === "withdrawal") {
      transfers.push({
        date: row.date,
        registration: row.registration,
        accountId,
        amount: row.amountCad,
        deposit: row.type === "deposit",
      });
      continue;
    }

    const pos = positionFor(row, accountId);
    if (row.pricePerUnit > 0) pos.lastPrice = row.pricePerUnit;

    if (row.type === "buy") {
      // Buying converts cash already in the account into securities, so the
      // cash has to leave the balance or the money is counted twice — once as
      // cash and again as the position.
      moveCash(accountId, -row.amountCad);
      pos.shares += row.quantity;
      pos.costNative += row.transactedAmount;
      pos.costCad += row.amountCad;
      pos.everHeld = true;
    } else if (row.type === "sell") {
      moveCash(accountId, row.amountCad);
      // Average-cost disposal: selling a third of the shares removes a third of
      // the basis, leaving the average cost of what remains unchanged.
      const remaining = Math.max(0, pos.shares - row.quantity);
      const kept = pos.shares > 0 ? remaining / pos.shares : 0;
      pos.costNative *= kept;
      pos.costCad *= kept;
      pos.shares = remaining;
    } else if (row.type === "dividend") {
      moveCash(accountId, row.amountCad);
      pos.dividendsNative += row.transactedAmount;
      pos.dividendsCad += row.amountCad;
    }
  }

  return { positions: [...positions.values()], cashDeltas, transfers, skipped };
}

/** The holding fields a finished position should be written with. */
export function positionToHolding(pos: Position) {
  const shares = Math.round(pos.shares * 1e8) / 1e8;
  const avgCost = shares > 0 ? Math.round((pos.costNative / shares) * 10000) / 10000 : 0;
  const avgCostCAD = shares > 0 ? Math.round((pos.costCad / shares) * 10000) / 10000 : 0;
  return {
    ticker: pos.ticker,
    name: pos.existing?.name ?? pos.ticker,
    assetClass: pos.existing?.assetClass ?? ("US Equity" as const),
    sector: pos.existing?.sector ?? "Other",
    shares,
    avgCost,
    price: pos.lastPrice,
    dividendsReceived: Math.round(pos.dividendsNative * 100) / 100,
    accountId: pos.accountId,
    currency: pos.currency,
    avgCostCADOverride: avgCostCAD,
    dividendsReceivedCADOverride: Math.round(pos.dividendsCad * 100) / 100,
  };
}
