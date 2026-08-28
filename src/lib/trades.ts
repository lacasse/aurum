/**
 * Parsing and aggregation for the brokerage-trade importer.
 *
 * Kept out of the page component so it can be tested directly. The logic here
 * previously lived inline and, untested, silently filed an entire portfolio
 * into one account and created a separate position for every row.
 */
import Papa from "papaparse";
import { isCoinTicker } from "./market";
import { AssetClass, CashFlow, Currency, Holding, Registration } from "./types";
import { todayISO } from "./format";

export type TradeType = "buy" | "sell" | "dividend" | "deposit" | "withdrawal";

export interface TradeRow {
  id: string;
  date: string;
  /**
   * Null when the activity type was not recognised. Left null rather than
   * defaulted, so an unreadable row is reported instead of being counted as a
   * trade in the wrong direction.
   */
  type: TradeType | null;
  /** The raw activity text, kept so an unmatched row can name it. */
  typeRaw: string;
  ticker: string;
  /**
   * Always positive. The type carries the direction, so an export that also
   * signs its quantities (-8 for a sale) would otherwise subtract twice — or,
   * on a sell, add.
   */
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
  /** Identical to a row already loaded — excluded by default, not silently counted twice. */
  duplicate: boolean;
  error?: string;
  sourceFile: string;
}

/**
 * Identity of a trade for duplicate detection: everything that would make two
 * rows the same event. Dropping a file twice, or a file that overlaps one
 * already loaded, otherwise counts every trade in it a second time — and a
 * double-counted buy is indistinguishable from a real one in the share count.
 */
export function tradeKey(r: {
  date: string;
  type: TradeType | null;
  ticker: string;
  quantity: number;
  transactedAmount: number;
  registrationRaw: string;
}): string {
  return [
    r.date,
    r.type ?? "?",
    r.ticker,
    r.quantity,
    r.transactedAmount.toFixed(2),
    r.registrationRaw.toLowerCase(),
  ].join("|");
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
  let t = String(raw).trim();
  // Accounting notation: (8) means -8.
  let negative = /^\(.*\)$/.test(t);
  if (negative) t = t.slice(1, -1);
  // Thousands separators, currency symbols, stray spaces.
  t = t.replace(/[^0-9.\-]/g, "");
  if (t.includes("-")) {
    negative = true;
    t = t.replace(/-/g, "");
  }
  const n = Number(t);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

/**
 * Map the export's activity text onto a trade type.
 *
 * Returns null for anything unrecognised. The previous default was "buy",
 * which is the worst possible guess: a sell whose wording was not on the list —
 * "Sold" rather than "Sell" — was added to the position instead of taken off
 * it, moving the share count by twice the size of the trade in the wrong
 * direction. Matching is by substring so wordier labels ("Sold — full
 * position", "Reinvested dividend") still land correctly, and sells are tested
 * first so "sell to open" cannot be read as a buy.
 */
export function normalizeType(raw: string | undefined): TradeType | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s.includes("sell") || s.includes("sold") || s.includes("sale")) return "sell";
  if (s.includes("buy") || s.includes("bought") || s.includes("purchase")) return "buy";
  if (s.includes("div") || s.includes("distribution")) return "dividend";
  if (s.includes("withdraw")) return "withdrawal";
  if (s.includes("deposit") || s.includes("contribution") || s.includes("transfer in")) {
    return "deposit";
  }
  return null;
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

export function parseTradeCsv(
  fileName: string,
  csvText: string,
  /** Keys of rows already loaded, so a second drop of the same file is caught. */
  existingKeys: ReadonlySet<string> = new Set(),
): TradeRow[] {
  const result = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim(),
  });

  const rows: TradeRow[] = [];
  const seen = new Set(existingKeys);
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

    const typeRaw = (get("Type") ?? get("type") ?? "").trim();
    const type = normalizeType(typeRaw);
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

    const date = parseTradeDate(get("Date") ?? get("date"));
    const key = tradeKey({
      date,
      type,
      ticker,
      quantity: Math.abs(quantity),
      transactedAmount: Math.abs(transactedAmount),
      registrationRaw,
    });
    const duplicate = seen.has(key);
    seen.add(key);

    rows.push({
      id: rowId(),
      date,
      type,
      typeRaw,
      ticker,
      quantity: Math.abs(quantity),
      pricePerUnit: Math.abs(pricePerUnit),
      transactedAmount: Math.abs(transactedAmount),
      registration,
      registrationRaw,
      currency,
      amountCad,
      duplicate,
      include: registration !== null && type !== null && !duplicate,
      error: duplicate
        ? "Identical to a row already loaded"
        : type === null
          ? typeRaw
            ? `Unrecognized activity type "${typeRaw}"`
            : "No activity type in this row"
          : registration === null
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
/* Already-imported detection                                          */
/* ------------------------------------------------------------------ */

/**
 * Identity of a trade as it ends up stored: the security, the account it
 * landed in, the day, the direction and the money. Deliberately excludes the
 * share count, because a sale clamped by an oversell stores fewer shares than
 * the row asked for and would otherwise fail to match itself.
 */
function flowKey(
  ticker: string,
  accountId: string,
  date: string,
  kind: string,
  amount: number,
): string {
  return `${ticker.toUpperCase()}|${accountId}|${date}|${kind}|${amount.toFixed(2)}`;
}

/** The same, for the transfers a deposit or withdrawal turns into. */
function transferKey(date: string, amount: number, accountId: string, deposit: boolean): string {
  return `${date}|${amount.toFixed(2)}|${accountId}|${deposit ? "in" : "out"}`;
}

/**
 * Flag rows that are already in the database.
 *
 * Within-file detection is not enough on its own: importing the same file a
 * second time, in a fresh page, starts with an empty review list, so nothing
 * looks like a duplicate and every position doubles. The stored flows are the
 * record of what has already been imported, so they are what this compares
 * against.
 */
export function markAlreadyImported(
  rows: TradeRow[],
  accountIdFor: (registration: Registration) => string,
  existingHoldings: Holding[],
  existingTransfers: {
    date: string;
    amount: number;
    sourceAccountId?: string;
    destinationAccountId?: string;
  }[],
  investmentAccountIds: ReadonlySet<string>,
): TradeRow[] {
  const seen = new Set<string>();
  for (const h of existingHoldings) {
    for (const f of h.flows ?? []) {
      seen.add(flowKey(h.ticker, h.accountId, f.date, f.kind, f.amount));
    }
  }
  for (const t of existingTransfers) {
    // The investment side is the one a deposit or withdrawal names.
    const into = t.destinationAccountId && investmentAccountIds.has(t.destinationAccountId);
    const out = t.sourceAccountId && investmentAccountIds.has(t.sourceAccountId);
    if (into) seen.add(transferKey(t.date, t.amount, t.destinationAccountId!, true));
    if (out) seen.add(transferKey(t.date, t.amount, t.sourceAccountId!, false));
  }

  return rows.map((r) => {
    if (r.duplicate || r.registration === null || r.type === null) return r;
    const accountId = accountIdFor(r.registration);
    if (!accountId) return r;
    const key =
      r.type === "deposit" || r.type === "withdrawal"
        ? transferKey(r.date, r.amountCad, accountId, r.type === "deposit")
        : flowKey(r.ticker, accountId, r.date, r.type, r.amountCad);
    if (!seen.has(key)) return r;
    return {
      ...r,
      duplicate: true,
      include: false,
      error: "Already imported",
    };
  });
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
  /** Every dated movement, kept so a return can be measured against time. */
  flows: CashFlow[];
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
  /** Rows dropped because their account type or activity type was unreadable. */
  skipped: number;
  /** Sales larger than the position they were applied to. */
  oversold: { ticker: string; accountId: string; sold: number; held: number }[];
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
  const oversold: AccumulationResult["oversold"] = [];

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
          flows: [...(existing.flows ?? [])],
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
          flows: [],
        };
    positions.set(key, fresh);
    return fresh;
  };

  /*
   * Chronological, so an average cost is never computed from a later buy.
   * Within a single day buys are applied before sells: the file's own order is
   * not guaranteed to be chronological within a date, and a same-day round trip
   * whose sell came first would clamp at zero and lose the shares.
   */
  const order: Record<string, number> = { deposit: 0, buy: 1, dividend: 2, sell: 3, withdrawal: 4 };
  const sorted = [...rows].sort(
    (a, b) =>
      a.date.localeCompare(b.date) || (order[a.type ?? ""] ?? 9) - (order[b.type ?? ""] ?? 9),
  );

  for (const row of sorted) {
    if (row.registration === null || row.type === null) {
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
      pos.flows.push({ date: row.date, kind: "buy", amount: row.amountCad, shares: row.quantity });
    } else if (row.type === "sell") {
      moveCash(accountId, row.amountCad);
      /*
       * A sale bigger than the position means the buys are missing or landed
       * elsewhere. Clamping at zero keeps the arithmetic sane, but the caller
       * is told, because silently swallowing the difference hides exactly the
       * kind of import fault that produces a wrong share count.
       */
      if (row.quantity > pos.shares + 1e-8) {
        oversold.push({ ticker: row.ticker, accountId, sold: row.quantity, held: pos.shares });
      }
      // Average-cost disposal: selling a third of the shares removes a third of
      // the basis, leaving the average cost of what remains unchanged.
      const remaining = Math.max(0, pos.shares - row.quantity);
      // What actually left, which is less than the row asked for when the
      // position was already short of that many shares.
      const sold = pos.shares - remaining;
      const kept = pos.shares > 0 ? remaining / pos.shares : 0;
      pos.costNative *= kept;
      pos.costCad *= kept;
      pos.shares = remaining;
      pos.flows.push({ date: row.date, kind: "sell", amount: row.amountCad, shares: -sold });
    } else if (row.type === "dividend") {
      moveCash(accountId, row.amountCad);
      pos.dividendsNative += row.transactedAmount;
      pos.dividendsCad += row.amountCad;
      pos.flows.push({ date: row.date, kind: "dividend", amount: row.amountCad, shares: 0 });
    }
  }

  return { positions: [...positions.values()], cashDeltas, transfers, skipped, oversold };
}

/** The holding fields a finished position should be written with. */
export function positionToHolding(pos: Position) {
  const shares = Math.round(pos.shares * 1e8) / 1e8;
  const avgCost = shares > 0 ? Math.round((pos.costNative / shares) * 10000) / 10000 : 0;
  const avgCostCAD = shares > 0 ? Math.round((pos.costCad / shares) * 1e6) / 1e6 : 0;
  return {
    ticker: pos.ticker,
    name: pos.existing?.name ?? pos.ticker,
    // A coin is not an equity, and getting this wrong sends it to the wrong
    // price feed for a symbol that does not exist.
    assetClass:
      pos.existing?.assetClass ??
      ((isCoinTicker(pos.ticker) ? "Crypto" : "US Equity") as AssetClass),
    sector: pos.existing?.sector ?? "Other",
    shares,
    avgCost,
    price: pos.lastPrice,
    dividendsReceived: Math.round(pos.dividendsNative * 100) / 100,
    accountId: pos.accountId,
    currency: pos.currency,
    avgCostCADOverride: avgCostCAD,
    dividendsReceivedCADOverride: Math.round(pos.dividendsCad * 100) / 100,
    // Chronological, so a replay and an IRR both see them in order.
    flows: [...pos.flows].sort((a, b) => a.date.localeCompare(b.date)),
  };
}
