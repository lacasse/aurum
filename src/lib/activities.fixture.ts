/**
 * Build activity-export rows from named fields, so a test never has to paste
 * one.
 *
 * This exists because of how a leak happened rather than because the tests
 * needed tidying. Writing a parser test meant having a real export open and
 * copying a line out of it, and roughly twenty of those went into the suite
 * verbatim: account identifiers, a salary deposit, real trades. Nothing in a
 * row like that looks out of place, so nothing caught it.
 *
 * With a builder there is nothing to copy. You describe the row — a buy of so
 * many shares at such a price — and the shape comes from here, once, where it
 * can be checked against the format rather than against someone's statement.
 *
 * Every default below is invented. Account codes are deliberately unlike any
 * broker's real scheme, and the symbols name companies that do not exist.
 */

/** The export's columns, in the order the file writes them. */
export const ACTIVITY_HEADER =
  "effective_date,effective_time,settlement_date,account_id,account_type," +
  "activity_type,activity_sub_type,description,direction,symbol,name," +
  "currency,quantity,unit_price,commission,net_cash_amount";

export interface ActivityRow {
  date: string;
  time?: string;
  settled?: string;
  /** Invented account code. Real ones must never appear here. */
  accountId?: string;
  /** The export's own words for the account: "Chequing", "RRSP", "TFSA". */
  accountType?: string;
  activityType?: string;
  subType?: string;
  description?: string;
  direction?: string;
  symbol?: string;
  name?: string;
  currency?: string;
  quantity?: number | string;
  unitPrice?: number | string;
  commission?: number | string;
  netCash?: number | string;
}

const DEFAULTS: Required<Pick<ActivityRow, "time" | "accountId" | "accountType">> = {
  time: "10:00:00",
  accountId: "AA1",
  accountType: "Chequing",
};

/**
 * One row, as the file would write it.
 *
 * A field containing a comma is quoted, which the real export does too — the
 * description carries "FX Rate: 1.38" on a converted trade, and a parser that
 * splits naively on commas gets it wrong. Keeping that here means every test
 * exercises the quoting without anyone remembering to.
 */
export function activityRow(row: ActivityRow): string {
  const cells = [
    row.date,
    row.time ?? DEFAULTS.time,
    row.settled ?? "",
    row.accountId ?? DEFAULTS.accountId,
    row.accountType ?? DEFAULTS.accountType,
    row.activityType ?? "",
    row.subType ?? "",
    row.description ?? "",
    row.direction ?? "",
    row.symbol ?? "",
    row.name ?? "",
    row.currency ?? "",
    row.quantity ?? "",
    row.unitPrice ?? "",
    row.commission ?? "",
    row.netCash ?? "",
  ].map((c) => String(c));

  return cells
    .map((c) => (c.includes(",") || c.includes('"') ? `"${c.replace(/"/g, '""')}"` : c))
    .join(",");
}

/** Money moving in or out of a cash account. */
export function cashRow(
  over: ActivityRow & { subType: string; description: string; netCash: number },
): string {
  return activityRow({ activityType: "MoneyMovement", currency: "CAD", ...over });
}

/**
 * A trade. The description is built the way the export builds it, because the
 * parser reads the quantity and price back out of that sentence rather than
 * trusting the columns — the columns disagree with it on a journalled listing.
 */
export function tradeRow(
  over: ActivityRow & {
    symbol: string;
    quantity: number;
    unitPrice: number;
    side: "BUY" | "SELL";
    fxRate?: number;
  },
): string {
  const { side, fxRate, ...rest } = over;
  const verb = side === "BUY" ? "Bought" : "Sold";
  const qty = Math.abs(over.quantity).toFixed(4);
  const fx = fxRate === undefined ? "" : `, FX Rate: ${fxRate}`;
  return activityRow({
    activityType: "Trade",
    subType: side,
    description: `${over.symbol}: ${verb} ${qty} shares at $${over.unitPrice} per share${fx}`,
    direction: "LONG",
    currency: "CAD",
    ...rest,
    quantity: side === "BUY" ? Math.abs(over.quantity) : -Math.abs(over.quantity),
  });
}
