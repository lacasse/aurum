/**
 * Money-weighted rate of return.
 *
 * A portfolio's return depends on when money went in, not just how much. Two
 * positions can end at the same value from the same total contributions and
 * have very different returns if one was funded early and the other late. That
 * is what a money-weighted return measures, and it is the internal rate of
 * return over dated cash flows — the rate at which the flows discount to zero.
 *
 * The previous implementation was not this. It took a simple total return and
 * annualized it over a hardcoded 18 months for every holding, so a position
 * bought last month and one held five years were divided by the same number.
 */

export interface DatedFlow {
  date: string; // YYYY-MM-DD
  /** Negative for money paid in, positive for money received. */
  amount: number;
}

const DAYS_PER_YEAR = 365;
const MS_PER_DAY = 86_400_000;

function yearsBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return (b - a) / MS_PER_DAY / DAYS_PER_YEAR;
}

/**
 * A flow reduced to what the search actually needs: how many years after the
 * first one it lands, and how much it was.
 *
 * The dates are parsed once, here, rather than inside the loop below. The
 * bisection evaluates the same flows forty-odd times, and parsing a date
 * string is far and away the most expensive thing in that loop — on this
 * record it was two `Date.parse` calls per flow per iteration, some 188,000
 * of them for one pass over the holdings table.
 */
interface TimedFlow {
  years: number;
  amount: number;
}

/** Net present value of the flows at annual rate `rate`. */
function npv(flows: TimedFlow[], rate: number): number {
  let total = 0;
  const base = 1 + rate;
  for (const f of flows) {
    // base ** years is undefined for rate <= -1; the caller keeps the search
    // strictly above it.
    total += f.amount / base ** f.years;
  }
  return total;
}

/**
 * Annualized internal rate of return, as a percentage, or null when it cannot
 * be determined.
 *
 * Null rather than zero on purpose: "no flows to measure" and "made nothing"
 * are different answers, and showing the second when the first is true is how
 * a dash becomes a lie.
 *
 * Solved by bisection rather than Newton's method. It is slower and entirely
 * reliable, which matters more here: IRR is not well behaved when flows change
 * sign more than once, and Newton can diverge on exactly the messy real
 * portfolios this needs to handle.
 */
export function xirr(flows: DatedFlow[]): number | null {
  const meaningful = flows.filter((f) => f.amount !== 0);
  if (meaningful.length < 2) return null;

  // An IRR only exists when money went both in and out.
  const hasOutflow = meaningful.some((f) => f.amount < 0);
  const hasInflow = meaningful.some((f) => f.amount > 0);
  if (!hasOutflow || !hasInflow) return null;

  const sorted = [...meaningful].sort((a, b) => a.date.localeCompare(b.date));
  const start = sorted[0].date;
  const span = yearsBetween(start, sorted[sorted.length - 1].date);
  // Everything on one day has no time dimension to annualize over.
  if (span <= 0) return null;

  const timed: TimedFlow[] = sorted.map((f) => ({
    years: yearsBetween(start, f.date),
    amount: f.amount,
  }));

  // Bracket the root. Rates below -100% are meaningless; the upper bound is
  // generous enough for a position that multiplied many times over in months.
  let lo = -0.9999;
  let hi = 10;
  let fLo = npv(timed, lo);
  let fHi = npv(timed, hi);

  // Expand upward a few times for extreme returns before giving up.
  for (let i = 0; i < 8 && fLo * fHi > 0; i++) {
    hi *= 4;
    fHi = npv(timed, hi);
  }
  if (fLo * fHi > 0) return null; // no sign change: no bracketed root

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(timed, mid);
    /*
     * A rate is reported to three decimals of a percent, so 1e-9 was
     * bisecting well past anything that can show: the bracket starts about 11
     * wide, and each halving is one pass over the flows. 1e-8 is still two
     * orders of magnitude finer than the rounding and saves several passes.
     */
    if (fMid === 0 || (hi - lo) / 2 < 1e-8) return round(mid);
    if (fLo * fMid < 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return round((lo + hi) / 2);
}

function round(rate: number): number {
  return Math.round(rate * 1000 * 100) / 1000; // percent, 3 decimals
}
