export const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function fmtCAD(n: number, decimals = 0): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

/** @deprecated Use fmtCAD */
export const fmtUSD = fmtCAD;

export function fmtSignedCAD(n: number, decimals = 0): string {
  const s = fmtCAD(Math.abs(n), decimals);
  if (n > 0) return `+${s}`;
  if (n < 0) return `-${s}`;
  return s;
}

/** @deprecated Use fmtSignedCAD */
export const fmtSignedUSD = fmtSignedCAD;

export function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${trim1(abs / 1_000_000)}M`;
  if (abs >= 1_000) return `${sign}$${trim1(abs / 1_000)}k`;
  return `${sign}$${Math.round(abs)}`;
}

function trim1(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

export function fmtPct(n: number, decimals = 1): string {
  return `${n >= 0 ? "" : "-"}${Math.abs(n).toFixed(decimals)}%`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function toISODate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Current month key, e.g. "2026-08" */
export function currentMonthKey(): string {
  return monthKeyOf(todayISO());
}

export function monthKeyOf(dateISO: string): string {
  return dateISO.slice(0, 7);
}

/** List of the last `n` month keys ending with `endKey` (oldest first). */
export function lastMonthKeys(n: number, endKey = currentMonthKey()): string[] {
  const [y, m] = endKey.split("-").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/** The month before `key`. */
export function previousMonthKey(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * The last month that has finished.
 *
 * A chart of monthly totals reads the month in progress as a collapse — on the
 * second of the month, a full month of spending is drawn as two days of it —
 * so anything comparing months ends here instead of at today.
 */
export function lastCompleteMonthKey(): string {
  return previousMonthKey(currentMonthKey());
}

/** "2026-08" -> "Aug 2026" */
export function labelMonth(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MONTH_SHORT[m - 1]} ${y}`;
}

/** "2026-08-25" -> "Aug 25, 2026" */
export function labelDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTH_SHORT[m - 1]} ${d}, ${y}`;
}

export function daysLeftInMonth(from = new Date()): number {
  const end = new Date(from.getFullYear(), from.getMonth() + 1, 0);
  return Math.max(1, end.getDate() - from.getDate() + 1);
}
