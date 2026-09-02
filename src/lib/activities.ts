import Papa from "papaparse";
import { ImportedRow, suggestCategory, txnKey } from "./csv";
import { TradeRow, tradeKey } from "./trades";
import { CorporateAction } from "./corporate-actions";
import { Currency, Registration } from "./types";

/**
 * A brokerage activity export: one file covering every kind of event an
 * account can have.
 *
 * The other formats this app reads are lists of one thing — card purchases, or
 * trades. This one interleaves salary landing in a chequing account, bill
 * payments leaving it, money moving to an RRSP, the trade that money then
 * bought, the dividend it later paid, and the tax withheld on it. So parsing
 * cannot answer "what kind of row is this file made of"; it has to ask the
 * question per row, and hand back two lists: cash movements for the ledger,
 * and trades and dividends for the positions.
 */

export interface ActivityParseResult {
  fileName: string;
  cash: ImportedRow[];
  trades: TradeRow[];
  /** Mergers and demergers, which move cost basis rather than money. */
  actions: CorporateAction[];
  /** Rows deliberately dropped, with the reason, so the total still adds up. */
  skipped: { reason: string; count: number }[];
  /** Rows that need a person: corporate actions, share swaps. */
  needsAttention: string[];
}

const HEADERS = ["effective_date", "activity_type", "net_cash_amount"];

/** Whether these column names are a brokerage activity export. */
export function isActivityExport(fields: string[] | undefined): boolean {
  if (!fields) return false;
  const set = new Set(fields.map((f) => f.replace(/^﻿/, "").trim().toLowerCase()));
  return HEADERS.every((h) => set.has(h));
}

/**
 * The account the row belongs to.
 *
 * Chequing is the cash account everything else flows through; the rest are
 * registrations the app already knows. `null` means the row is a cash movement
 * rather than something belonging to an investment account.
 */
function registrationOf(accountType: string): Registration | null {
  const t = accountType.trim().toLowerCase();
  if (t.includes("tfsa")) return "TFSA";
  if (t.includes("rrsp")) return "RRSP";
  if (t.includes("fhsa")) return "FHSA";
  if (t.includes("non-registered") || t.includes("margin")) return "non-registered";
  return null;
}

/**
 * What `accountHint` says for a row from the everyday bank account.
 *
 * The other hints are registrations — TFSA, RRSP — which name an investment
 * account. Chequing has no registration, so it had no hint at all and every
 * row from it arrived anonymous: the monthly checklist, which files anything
 * unattributed against the credit card, then recorded a month of pre-authorized
 * debits and e-transfers as card spending.
 */
export const CHEQUING_HINT = "chequing";

function isChequing(accountType: string): boolean {
  return accountType.trim().toLowerCase().includes("chequing");
}

/**
 * A movement between two accounts you own, rather than money entering or
 * leaving your finances.
 *
 * Each one appears twice in the export — once leaving the chequing account and
 * once arriving in the investment account — so counting both sides would show
 * a month of saving as a month of spending followed by a deposit.
 */
function isInternalTransfer(subType: string, description: string): boolean {
  const d = description.toLowerCase();
  return (
    subType === "EFT" ||
    subType === "TRANSFER_TF" ||
    (subType === "TRANSFER" && d.includes("money transfer"))
  );
}

let seq = 0;
function rowId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

export function parseActivitiesCsv(
  fileName: string,
  csvText: string,
  existingTxnKeys: ReadonlySet<string>,
  existingTradeKeys: ReadonlySet<string>,
  merchantRules: Record<string, string>,
  userCategories?: readonly string[],
): ActivityParseResult {
  const parsed = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.replace(/^﻿/, "").trim(),
  });
  const records = parsed.data as Record<string, string>[];

  const cash: ImportedRow[] = [];
  const trades: TradeRow[] = [];
  const actions: CorporateAction[] = [];
  const skipped = new Map<string, number>();
  const needsAttention: string[] = [];
  const seenTxn = new Set(existingTxnKeys);
  const seenTrade = new Set(existingTradeKeys);
  const drop = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);

  /*
   * The paired side of every internal transfer, so the chequing row that
   * mirrors an investment-account deposit can be recognised and dropped. Both
   * sides carry the same date and amount, which is enough: two unrelated
   * movements of the identical amount on the identical day would be a
   * coincidence, and the cost of it is one row to re-add by hand.
   */
  const transferSides = new Set<string>();
  /*
   * A ticker that became another ticker.
   *
   * Norbert's Gambit buys the US-dollar listing of a currency ETF and sells the
   * Canadian one, and the broker journals the shares across in between. The two
   * listings are one security, so without this the file reads as a sale of
   * shares that were never bought.
   */
  const alias = new Map<string, string>();
  /*
   * A security that arrived out of a demerger, and the holding it came from.
   *
   * The parent appears on the same day with a quantity of zero — it did not
   * change, it just spun something off — so the row carrying shares is the new
   * security and the row carrying none names where it came from.
   */
  const spinoffParent = new Map<string, string>();
  /** Outgoing e-transfers of the same amount, month after month. */
  const transferMonths = new Map<string, Set<string>>();

  const swapsByDate = new Map<string, { ticker: string; quantity: number }[]>();
  const demergersByDate = new Map<string, { ticker: string; quantity: number }[]>();
  for (const r of records) {
    const date = (r.effective_date ?? "").trim();
    const sub = (r.activity_sub_type ?? "").trim();
    const desc = (r.description ?? "").trim();
    const type = (r.activity_type ?? "").trim();
    const ticker = (r.symbol ?? "").trim().toUpperCase();
    const quantity = Number(r.quantity);
    const amount = Number(r.net_cash_amount);

    if (Number.isFinite(amount) && amount !== 0) {
      if (registrationOf(r.account_type ?? "") && isInternalTransfer(sub, desc)) {
        transferSides.add(`${date}|${Math.abs(amount).toFixed(2)}`);
      }
      if (sub === "E_TRFOUT") {
        const key = Math.abs(amount).toFixed(2);
        const months = transferMonths.get(key) ?? new Set<string>();
        months.add(date.slice(0, 7));
        transferMonths.set(key, months);
      }
    }
    if (type === "ListingSwap" && ticker && Number.isFinite(quantity) && quantity !== 0) {
      swapsByDate.set(date, [...(swapsByDate.get(date) ?? []), { ticker, quantity }]);
    }
    if (type === "CorporateAction" && sub === "DEMERGER" && ticker) {
      demergersByDate.set(date, [
        ...(demergersByDate.get(date) ?? []),
        { ticker, quantity: Number.isFinite(quantity) ? quantity : 0 },
      ]);
    }
  }
  for (const rows of swapsByDate.values()) {
    const out = rows.find((r) => r.quantity < 0);
    const into = rows.find((r) => r.quantity > 0);
    if (out && into && Math.abs(out.quantity) === into.quantity) {
      alias.set(out.ticker, into.ticker);
    }
  }
  for (const rows of demergersByDate.values()) {
    const parent = rows.find((r) => r.quantity === 0);
    const child = rows.find((r) => r.quantity > 0);
    if (parent && child) spinoffParent.set(child.ticker, parent.ticker);
  }

  /*
   * The same amount leaving by e-transfer in three separate months is rent, or
   * something enough like it that the guess is worth making. The payee carries
   * the amount so that correcting it teaches this one transfer rather than
   * every e-transfer, and the correction is remembered by merchant.
   */
  const recurringOut = new Set(
    [...transferMonths.entries()]
      .filter(([, months]) => months.size >= 3)
      .map(([amount]) => amount),
  );

  for (const r of records) {
    const date = (r.effective_date ?? "").trim();
    const accountType = (r.account_type ?? "").trim();
    const type = (r.activity_type ?? "").trim();
    const sub = (r.activity_sub_type ?? "").trim();
    const desc = (r.description ?? "").trim();
    const symbol = (r.symbol ?? "").trim().toUpperCase();
    const currency = ((r.currency ?? "CAD").trim().toUpperCase() || "CAD") as Currency;
    const amount = Number(r.net_cash_amount);
    const quantity = Number(r.quantity);
    const unitPrice = Number(r.unit_price);
    const registration = registrationOf(accountType);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue; // trailing "As of" line

    const addCash = (
      kind: "income" | "expense",
      payee: string,
      hint: string,
      note?: string,
    ) => {
      const abs = Math.abs(Math.round(amount * 100) / 100);
      if (abs === 0) return;
      const key = txnKey(date, abs, payee);
      const dup = seenTxn.has(key);
      seenTxn.add(key);
      const s = suggestCategory(
        payee,
        hint,
        note ?? "",
        hint,
        kind,
        merchantRules,
        userCategories,
      );
      cash.push({
        id: rowId("act"),
        date,
        payee,
        amount: abs,
        type: kind,
        note,
        sourceFile: fileName,
        accountHint:
          registration ?? (isChequing(accountType) ? CHEQUING_HINT : undefined),
        csvCategory: hint,
        category: s.category,
        suggestedCategory: s.category,
        confident: s.confident,
        include: !dup,
        dup,
        // An activity export names each row — dividend, withholding tax, buy —
        // so the direction never comes from reading its signs.
        explicitType: true,
      });
    };

    const addTrade = (
      tradeType: TradeRow["type"],
      qty: number,
      price: number,
      cashAmount: number,
    ) => {
      if (!symbol) {
        drop("security rows with no symbol");
        return;
      }
      /*
       * A journalled ticker is the same security under its other listing — the
       * two halves of Norbert's Gambit — so it is recorded under the one the
       * position ends up in.
       *
       * Shares from a demerger are left alone here. They are a real position
       * with a real cost basis, carved out of the parent's by the corporate
       * action below; selling them is an ordinary sale against that basis.
       */
      const ticker = alias.get(symbol) ?? symbol;
      const row: TradeRow = {
        id: rowId("trd"),
        date,
        type: tradeType,
        typeRaw: `${type} ${sub}`.trim(),
        ticker,
        quantity: Math.abs(qty),
        pricePerUnit: Math.abs(price),
        transactedAmount: Math.abs(cashAmount),
        registration,
        registrationRaw: accountType,
        currency,
        // FX rates travel in the description on the rows that need one.
        amountCad: Math.abs(cashAmount) * fxRateFrom(desc, currency),
        include: true,
        duplicate: false,
        sourceFile: fileName,
      };
      const key = tradeKey(row);
      row.duplicate = seenTrade.has(key);
      row.include = !row.duplicate;
      seenTrade.add(key);
      trades.push(row);
    };

    switch (type) {
      case "Trade": {
        if (sub === "BUY") addTrade("buy", quantity, unitPrice, amount);
        else if (sub === "SELL") addTrade("sell", quantity, unitPrice, amount);
        else drop(`unrecognised trade (${sub})`);
        break;
      }
      case "Dividend":
        addTrade("dividend", 0, 0, amount);
        break;
      case "Interest":
        /*
         * Stock-lending interest belongs to the security that earned it, when
         * the export names one. It usually does not — the payment is for the
         * account's whole loanable book — and then it is income like any other
         * interest rather than a row to throw away.
         */
        if (registration && symbol) addTrade("dividend", 0, 0, amount);
        else addCash("income", "Interest", "Interest", desc);
        break;
      case "BonusPayment":
        addCash(
          "income",
          sub === "CASHBACK" ? "Cash back" : "Bonus",
          sub === "CASHBACK" ? "Refund" : "Gifts",
          desc,
        );
        break;
      case "InterestCharged":
        addCash("expense", "Margin interest", "Fees", desc);
        break;
      case "Tax":
        addCash("expense", "Withholding tax", "Taxes", desc);
        break;
      case "FxExchange":
        drop("currency conversions");
        break;
      case "ListingSwap":
        /*
         * Two rows move the shares between listings and a third carries the
         * broker's fee. The move is bookkeeping — the position is unchanged —
         * so only the fee is money.
         */
        if (symbol) drop("journalled shares (Norbert's Gambit)");
        else if (amount < 0) addCash("expense", "Journalling fee", "Fees", desc);
        else drop("journalled shares (Norbert's Gambit)");
        break;
      case "CorporateAction": {
        const parentOf = spinoffParent.get(symbol);
        if (parentOf && quantity > 0) {
          /*
           * The shares out of a demerger, and the holding they came from. What
           * the file cannot say is how the cost basis divides — that comes
           * from the company's own allocation notice — so it is asked for in
           * review rather than assumed here.
           */
          actions.push({
            id: rowId("act-corp"),
            kind: "demerger",
            date,
            from: parentOf,
            to: symbol,
            shares: quantity,
            registration,
            registrationRaw: accountType,
            allocationPct: 0,
            include: true,
            sourceFile: fileName,
          });
        } else if (parentOf || quantity === 0) {
          // The parent's own row: it names the demerger without changing.
          drop("demerger notices");
        } else if (sub === "MERGER" || sub === "AMALGAMATION") {
          actions.push({
            id: rowId("act-corp"),
            kind: "merger",
            date,
            from: (desc.match(/^([A-Z0-9.\-]+)/)?.[1] ?? symbol).toUpperCase(),
            to: symbol,
            shares: quantity,
            registration,
            registrationRaw: accountType,
            allocationPct: 100,
            include: true,
            sourceFile: fileName,
          });
        } else {
          needsAttention.push(
            `${date} ${symbol || "—"}: ${type}${desc ? ` — ${desc}` : ""}`,
          );
        }
        break;
      }
      case "MoneyMovement": {
        const d = desc.toLowerCase();
        if (d.includes("credit card payment")) {
          // The card's own export carries the purchases; the payment that
          // settles it would count the same spending a second time.
          drop("credit card payments");
          break;
        }
        if (isInternalTransfer(sub, desc)) {
          drop("transfers between your own accounts");
          break;
        }
        if (
          isChequing(accountType) &&
          transferSides.has(`${date}|${Math.abs(amount).toFixed(2)}`)
        ) {
          drop("transfers between your own accounts");
          break;
        }
        if (amount > 0) {
          addCash("income", payeeFor(sub, desc), incomeHintFor(sub), desc);
        } else if (sub === "E_TRFOUT" && recurringOut.has(Math.abs(amount).toFixed(2))) {
          addCash(
            "expense",
            `${payeeFor(sub, desc)} · $${Math.abs(amount).toFixed(2)}`,
            "Housing",
            desc,
          );
        } else {
          addCash("expense", payeeFor(sub, desc), "", desc);
        }
        break;
      }
      default:
        drop(`unrecognised activity (${type})`);
    }
  }

  return {
    fileName,
    cash,
    trades,
    actions,
    skipped: [...skipped.entries()].map(([reason, count]) => ({ reason, count })),
    needsAttention,
  };
}

/**
 * The FX rate a row settled at.
 *
 * US trades carry it in their own description, which is better than today's
 * rate: what the trade cost in Canadian dollars was fixed on the day.
 */
function fxRateFrom(description: string, currency: Currency): number {
  if (currency !== "USD") return 1;
  const m = description.match(/FX Rate:\s*([\d.]+)/i) ?? description.match(/\$1USD\s*=\s*\$([\d.]+)/i);
  const rate = m ? Number(m[1]) : NaN;
  return Number.isFinite(rate) && rate > 0 ? rate : 1;
}

/** A name for the other side, since the export does not carry one. */
function payeeFor(sub: string, description: string): string {
  const named = description.replace(/\s*\(executed at [^)]+\)/i, "").trim();
  if (named) return named;
  return sub || "Money movement";
}

function incomeHintFor(sub: string): string {
  if (sub === "AFT_IN") return "Salary";
  if (sub === "E_TRFIN" || sub === "P2P") return "Gifts";
  return "";
}
