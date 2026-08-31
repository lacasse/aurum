import { Account, CashFlow, Holding, Registration } from "./types";
import { fromCents, roundMoney, toCents } from "./money";

/**
 * What a year owes tax on.
 *
 * The app already knows enough to answer this: every disposal has an adjusted
 * cost base behind it, every dividend is dated, and every holding sits in an
 * account whose registration says whether any of it is taxable at all. Nothing
 * put those three together.
 *
 * The registration is the part that matters most and is easiest to get wrong.
 * Two thirds of the sales on this record happened inside an RRSP, a TFSA or an
 * FHSA, where a gain is not a taxable event and reporting one would be a
 * fiction. They are counted here — a year is easier to read when the sheltered
 * side is visible beside the taxable one — but they are counted separately,
 * and never added in.
 *
 * This is a summary of what is recorded, not tax advice and not a return. The
 * inclusion rate, the superficial loss rule, foreign reporting and everything
 * else belong to whoever files.
 */

/** Registrations where a gain is not a taxable event. */
const SHELTERED: Registration[] = ["TFSA", "RRSP", "FHSA", "Pension"];

export function isSheltered(registration: Registration | undefined): boolean {
  return registration !== undefined && SHELTERED.includes(registration);
}

export interface Disposal {
  date: string;
  year: string;
  ticker: string;
  name: string;
  /** Units sold, positive. */
  units: number;
  proceeds: number;
  /** The cost base of the units sold, on the average-cost method. */
  acb: number;
  gain: number;
  accountName: string;
  registration: Registration | undefined;
  sheltered: boolean;
}

/**
 * Every sale, with the cost base that went with it.
 *
 * Average cost, replayed forward: selling a third of a position disposes of a
 * third of its cost, and what stays keeps the same average. `replayFlows`
 * totals the same arithmetic; this keeps each event, because a year is made of
 * events and a total cannot be filed.
 */
function disposalsOf(flows: CashFlow[]): {
  date: string;
  units: number;
  proceeds: number;
  acb: number;
}[] {
  const out: { date: string; units: number; proceeds: number; acb: number }[] = [];
  let shares = 0;
  let cost = 0;
  for (const f of [...flows].sort((a, b) => a.date.localeCompare(b.date))) {
    if (f.kind === "buy") {
      shares += f.shares;
      cost += f.amount;
    } else if (f.kind === "sell") {
      const sold = Math.min(Math.abs(f.shares), shares);
      const acb = shares > 0 ? cost * (sold / shares) : 0;
      out.push({
        date: f.date,
        units: sold,
        proceeds: f.amount,
        acb: roundMoney(acb),
      });
      cost -= acb;
      shares -= sold;
    }
  }
  return out;
}

export function disposals(holdings: Holding[], accounts: Account[]): Disposal[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const out: Disposal[] = [];
  for (const h of holdings) {
    const account = byId.get(h.accountId);
    const registration = account?.registration;
    for (const d of disposalsOf(h.flows)) {
      out.push({
        date: d.date,
        year: d.date.slice(0, 4),
        ticker: h.ticker,
        name: h.name,
        units: d.units,
        proceeds: d.proceeds,
        acb: d.acb,
        gain: roundMoney(d.proceeds - d.acb),
        accountName: account?.name ?? "—",
        registration,
        sheltered: isSheltered(registration),
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker));
}

export interface TaxYear {
  year: string;
  /** Disposals in accounts with no shelter, newest first. */
  taxable: Disposal[];
  proceeds: number;
  acb: number;
  /** Realized gain in taxable accounts. Negative is a loss. */
  gain: number;
  /** Gains realized inside registered accounts. Shown, never added. */
  shelteredGain: number;
  shelteredCount: number;
  /** Dividends credited to taxable accounts. */
  dividends: number;
  shelteredDividends: number;
  /** Interest and cashback, from the transactions that recorded them. */
  interest: number;
  /**
   * Taxable disposals recorded with no proceeds at all.
   *
   * A sale for nothing is almost always a sale nobody entered the proceeds
   * for, and it reads as a loss of the entire cost base — on this record five
   * of them come to $197,932 of losses that did not happen. They are counted
   * in the figures above, because leaving them out would invent a different
   * lie, but they are listed here so the year can say it is not ready.
   */
  unpriced: Disposal[];
}

/** The category interest and cashback are recorded under. */
export const INTEREST_CATEGORY = "Interest";

export function taxYears(
  holdings: Holding[],
  accounts: Account[],
  transactions: { date: string; type: string; amount: number; category: string }[],
): TaxYear[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const years = new Map<string, TaxYear>();
  const year = (key: string): TaxYear => {
    const found = years.get(key);
    if (found) return found;
    const fresh: TaxYear = {
      year: key,
      taxable: [],
      unpriced: [],
      proceeds: 0,
      acb: 0,
      gain: 0,
      shelteredGain: 0,
      shelteredCount: 0,
      dividends: 0,
      shelteredDividends: 0,
      interest: 0,
    };
    years.set(key, fresh);
    return fresh;
  };

  // Cents throughout, converted once at the end: a year is a long column to add.
  const cents = new Map<string, { proceeds: number; acb: number; sheltered: number; div: number; shDiv: number; int: number }>();
  const bucket = (key: string) => {
    const found = cents.get(key);
    if (found) return found;
    const fresh = { proceeds: 0, acb: 0, sheltered: 0, div: 0, shDiv: 0, int: 0 };
    cents.set(key, fresh);
    return fresh;
  };

  for (const d of disposals(holdings, accounts)) {
    const y = year(d.year);
    const c = bucket(d.year);
    if (d.sheltered) {
      c.sheltered += toCents(d.gain);
      y.shelteredCount++;
    } else {
      y.taxable.push(d);
      if (d.proceeds === 0) y.unpriced.push(d);
      c.proceeds += toCents(d.proceeds);
      c.acb += toCents(d.acb);
    }
  }

  for (const h of holdings) {
    const sheltered = isSheltered(byId.get(h.accountId)?.registration);
    for (const f of h.flows) {
      if (f.kind !== "dividend") continue;
      const key = f.date.slice(0, 4);
      year(key);
      const c = bucket(key);
      if (sheltered) c.shDiv += toCents(f.amount);
      else c.div += toCents(f.amount);
    }
  }

  for (const t of transactions) {
    if (t.type !== "income" || t.category !== INTEREST_CATEGORY) continue;
    const key = t.date.slice(0, 4);
    year(key);
    bucket(key).int += toCents(t.amount);
  }

  for (const [key, y] of years) {
    const c = bucket(key);
    y.proceeds = fromCents(c.proceeds);
    y.acb = fromCents(c.acb);
    y.gain = fromCents(c.proceeds - c.acb);
    y.shelteredGain = fromCents(c.sheltered);
    y.dividends = fromCents(c.div);
    y.shelteredDividends = fromCents(c.shDiv);
    y.interest = fromCents(c.int);
    y.taxable.sort((a, b) => b.date.localeCompare(a.date));
  }

  return [...years.values()].sort((a, b) => b.year.localeCompare(a.year));
}
