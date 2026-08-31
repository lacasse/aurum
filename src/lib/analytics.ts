"use client";

import {
  Account,
  AssetClass,
  Budget,
  CashFlow,
  Currency,
  Holding,
  isLiability,
  isPension,
  Transaction,
  withBalanceRecorded,
} from "./types";
import {
  currentMonthKey,
  labelMonth,
  lastMonthKeys,
  lastCompleteMonthKey,
  monthKeyOf,
  todayISO,
} from "./format";
import { DatedFlow, xirr } from "./xirr";
import {
  fromCents,
  roundMoney,
  subtractMoney,
  sumMoney,
  sumProducts,
  toCents,
} from "./money";


export { withBalanceRecorded };

export interface NetWorthPoint {
  key: string;
  label: string;
  /** Cash and balances you could actually draw on. Excludes the pension. */
  assets: number;
  liabilities: number;
  portfolio: number;
  /** Defined benefit pensions, at their transfer value. Yours, but not money. */
  pension: number;
  net: number;
}

/**
 * An account's cash in Canadian dollars, both sides of it.
 *
 * The US balance is converted here rather than when it is entered: the rate
 * moves, and storing a converted figure would freeze whatever it happened to be
 * on the day, then quietly drift away from the truth.
 */
export function accountCadBalance(acc: Account, usdCadRate: number): number {
  return roundMoney(acc.balance + (acc.balanceUSD ?? 0) * usdCadRate);
}

export function accountValueAt(acc: Account, monthKey: string): number {
  const pt = acc.history.find((p) => p.month === monthKey);
  if (pt) return pt.value;
  if (acc.history.length === 0) return acc.balance;
  /*
   * Off either end of the recorded history, hold the nearest value rather than
   * always reaching for the first one. A month after the last recorded point is
   * the account as it stands now — reading the oldest figure there drew a cliff
   * at the right edge of every chart the moment a history stopped one month
   * short of today.
   */
  const first = acc.history[0];
  const lastPoint = acc.history[acc.history.length - 1];
  if (monthKey < first.month) return first.value;
  if (monthKey > lastPoint.month) return acc.balance;
  /*
   * A gap in the middle holds the last figure recorded *before* it, which is
   * what the balance was until something changed it. Reaching for the end of
   * the history instead read a later month's balance back into an earlier one.
   */
  let carried = first.value;
  for (const p of acc.history) {
    if (p.month > monthKey) break;
    carried = p.value;
  }
  return carried;
}

function portfolioValueAt(holdings: Holding[], monthsAgoFromEnd: number): number {
  return sumProducts(
    holdings.map((h) => {
      const hist = h.historyCAD ?? h.history;
      const idx = hist.length - 1 - monthsAgoFromEnd;
      const px =
        hist[Math.max(0, Math.min(hist.length - 1, idx))] ?? h.priceCAD ?? h.price;
      return [h.shares, px] as const;
    }),
  );
}

export function netWorthSeries(
  accounts: Account[],
  holdings: Holding[],
  n = 18,
  usdCadRate = 1,
): NetWorthPoint[] {
  const keys = lastMonthKeys(n);
  const last = keys[keys.length - 1];
  return keys.map((key, i) => {
    let assetCents = 0;
    let liabilityCents = 0;
    let pensionCents = 0;
    for (const acc of accounts) {
      // Nothing recorded yet is nothing held: an account joins the line in the
      // month its own record starts. See `netWorthOver` for why.
      const begins = acc.history[0]?.month;
      if (begins && key < begins) continue;
      /*
       * History is recorded in Canadian dollars and has no second currency in
       * it, so the US side can only be added to the month that is current —
       * which is the one it is a fact about.
       */
      const usd = key === last ? (acc.balanceUSD ?? 0) * usdCadRate : 0;
      const v = toCents(accountValueAt(acc, key) + usd);
      if (isLiability(acc.kind)) liabilityCents += v;
      else if (isPension(acc.kind)) pensionCents += v;
      else assetCents += v;
    }
    const portfolio = portfolioValueAt(holdings, keys.length - 1 - i);
    return {
      key,
      label: labelMonth(key),
      assets: fromCents(assetCents),
      liabilities: fromCents(liabilityCents),
      portfolio,
      pension: fromCents(pensionCents),
      net: fromCents(assetCents + pensionCents + toCents(portfolio) - liabilityCents),
    };
  });
}

/** The earliest month any account has a recorded balance for. */
export function firstAccountMonth(accounts: Account[]): string | null {
  let earliest: string | null = null;
  for (const acc of accounts) {
    const first = acc.history[0]?.month;
    if (first && (earliest === null || first < earliest)) earliest = first;
  }
  return earliest;
}

/**
 * Net worth for every month a portfolio series covers, however far back it goes.
 *
 * The portfolio is passed in rather than derived here because the good
 * long-run figure comes from recorded month-end values (`allTimeSeries`),
 * which the caller has to fetch; this adds the accounts around whatever it is
 * given, so both halves of net worth span the same months.
 *
 * An account is worth nothing before its own record begins. Holding its first
 * known balance backwards — which is right for a gap in the middle of a
 * history — would draw a pension opened last year as though it had been full
 * since the chart's first month, and put tens of thousands of dollars into
 * years that never had them.
 */
export function netWorthOver(
  accounts: Account[],
  portfolio: readonly PortfolioPoint[],
  usdCadRate = 1,
): NetWorthPoint[] {
  const last = portfolio[portfolio.length - 1]?.key;
  return portfolio.map((point) => {
    let assetCents = 0;
    let liabilityCents = 0;
    let pensionCents = 0;
    for (const acc of accounts) {
      const begins = acc.history[0]?.month;
      if (begins && point.key < begins) continue;
      // As in `netWorthSeries`: history carries no second currency, so the US
      // side belongs only to the month it is a fact about.
      const usd = point.key === last ? (acc.balanceUSD ?? 0) * usdCadRate : 0;
      const v = toCents(accountValueAt(acc, point.key) + usd);
      if (isLiability(acc.kind)) liabilityCents += v;
      else if (isPension(acc.kind)) pensionCents += v;
      else assetCents += v;
    }
    return {
      key: point.key,
      label: point.label,
      assets: fromCents(assetCents),
      liabilities: fromCents(liabilityCents),
      portfolio: point.value,
      pension: fromCents(pensionCents),
      net: fromCents(
        assetCents + pensionCents + toCents(point.value) - liabilityCents,
      ),
    };
  });
}

export interface CashflowPoint {
  key: string;
  label: string;
  income: number;
  expenses: number;
  net: number;
}

/**
 * Income and spending, month by month.
 *
 * `end` defaults to the month in progress, but a chart that compares one month
 * against the next should pass the last complete one: a partial month is drawn
 * as a short one, and the drop is a calendar artefact rather than anything
 * that happened.
 */
export function cashflowSeries(
  transactions: Transaction[],
  n = 12,
  end = currentMonthKey(),
): CashflowPoint[] {
  const keys = lastMonthKeys(n, end);
  const map = new Map<string, { income: number; expenses: number }>();
  for (const k of keys) map.set(k, { income: 0, expenses: 0 });
  for (const t of transactions) {
    const k = monthKeyOf(t.date);
    const slot = map.get(k);
    if (!slot) continue;
    if (t.type === "income") slot.income += toCents(t.amount);
    else if (t.type === "expense") slot.expenses += toCents(t.amount);
  }
  return keys.map((key) => {
    const { income, expenses } = map.get(key)!;
    return {
      key,
      label: labelMonth(key),
      income: fromCents(income),
      expenses: fromCents(expenses),
      net: fromCents(income - expenses),
    };
  });
}

export function spendByCategory(
  transactions: Transaction[],
  monthKey?: string,
): { name: string; value: number }[] {
  const totals = new Map<string, number>();
  for (const t of transactions) {
    if (t.type !== "expense") continue;
    if (monthKey && monthKeyOf(t.date) !== monthKey) continue;
    totals.set(t.category, (totals.get(t.category) ?? 0) + toCents(t.amount));
  }
  return [...totals.entries()]
    .map(([name, cents]) => ({ name, value: fromCents(cents) }))
    .sort((a, b) => b.value - a.value);
}

/**
 * What a typical month's spending is made of, category by category.
 *
 * The same window and the same denominator as `monthlyAverages`, so the slices
 * add up to the average-expenses figure beside them: months with nothing
 * recorded are months that did not happen rather than frugal ones, and
 * averaging over them would halve every slice.
 */
export function avgSpendByCategory(
  transactions: Transaction[],
  months = 12,
  end = currentMonthKey(),
): { name: string; value: number }[] {
  const keys = new Set(lastMonthKeys(months, end));
  const totals = new Map<string, number>();
  const active = new Set<string>();
  for (const t of transactions) {
    const key = monthKeyOf(t.date);
    if (!keys.has(key)) continue;
    if (t.type !== "income" && t.type !== "expense") continue;
    active.add(key);
    if (t.type !== "expense") continue;
    totals.set(t.category, (totals.get(t.category) ?? 0) + toCents(t.amount));
  }
  const n = active.size;
  if (n === 0) return [];
  return [...totals.entries()]
    .map(([name, cents]) => ({ name, value: roundMoney(fromCents(cents) / n) }))
    .sort((a, b) => b.value - a.value);
}

/** Monthly totals for each of the given categories (top-N spending). */
export function stackedSpend(
  transactions: Transaction[],
  categories: string[],
  n = 12,
  end = currentMonthKey(),
): Record<string, number | string>[] {
  const keys = lastMonthKeys(n, end);
  return keys.map((key) => {
    const cents = new Map<string, number>(categories.map((c) => [c, 0]));
    for (const t of transactions) {
      if (t.type !== "expense") continue;
      if (monthKeyOf(t.date) !== key) continue;
      if (!cents.has(t.category)) continue;
      cents.set(t.category, cents.get(t.category)! + toCents(t.amount));
    }
    const row: Record<string, number | string> = { key, label: labelMonth(key) };
    for (const [category, total] of cents) row[category] = fromCents(total);
    return row;
  });
}

export interface PortfolioPoint {
  key: string;
  label: string;
  value: number;
  cost: number;
}

export function portfolioSeries(holdings: Holding[], n = 18): PortfolioPoint[] {
  const keys = lastMonthKeys(Math.min(n, 18));
  const totalCost = sumProducts(
    holdings.map((h) => [h.shares, h.avgCostCAD ?? h.avgCost] as const),
  );
  return keys.map((key, i) => ({
    key,
    label: labelMonth(key),
    value: portfolioValueAt(holdings, keys.length - 1 - i),
    cost: totalCost,
  }));
}

export function allocationByClass(
  holdings: Holding[],
): { name: string; value: number }[] {
  const totals = new Map<string, number>();
  for (const h of holdings) {
    const px = h.priceCAD ?? h.price;
    totals.set(h.assetClass, (totals.get(h.assetClass) ?? 0) + toCents(h.shares * px));
  }
  return [...totals.entries()].map(([name, cents]) => ({
    name,
    value: fromCents(cents),
  }));
}

/**
 * One slice per security for the exposure pie, pooled across accounts.
 *
 * Asset class is what groups them — the individual positions, not the group
 * totals, are what the chart draws. Closed positions are left out: a pie is a
 * picture of what is owned now.
 *
 * Slices come out grouped, largest group first and largest holding first
 * within a group, so that a caller shading a group can walk the array in order
 * and get the shades adjacent on the arc.
 */
export interface ExposureSlice {
  ticker: string;
  name: string;
  assetClass: AssetClass;
  value: number;
}

export function holdingExposure(holdings: Holding[]): ExposureSlice[] {
  const pooled = new Map<string, ExposureSlice>();
  for (const h of holdings) {
    const value = fromCents(toCents(h.shares * (h.priceCAD ?? h.price)));
    if (value <= 0) continue;
    const key = `${h.assetClass}|${h.ticker.toUpperCase()}`;
    const seen = pooled.get(key);
    if (seen) {
      seen.value = fromCents(toCents(seen.value + value));
      // Several rows for one ticker can disagree on the name, one of them
      // being the bare ticker. Prefer whichever says more.
      if (h.name.length > seen.name.length) seen.name = h.name;
    } else {
      pooled.set(key, {
        ticker: h.ticker,
        name: h.name,
        assetClass: h.assetClass,
        value,
      });
    }
  }

  const slices = [...pooled.values()];
  const groupTotal = new Map<AssetClass, number>();
  for (const s of slices) {
    groupTotal.set(s.assetClass, (groupTotal.get(s.assetClass) ?? 0) + s.value);
  }
  slices.sort((a, b) => {
    const ga = groupTotal.get(a.assetClass) ?? 0;
    const gb = groupTotal.get(b.assetClass) ?? 0;
    if (ga !== gb) return gb - ga;
    if (a.assetClass !== b.assetClass) return a.assetClass.localeCompare(b.assetClass);
    if (a.value !== b.value) return b.value - a.value;
    return a.ticker.localeCompare(b.ticker);
  });
  return slices;
}

/**
 * One row per security, pooling every account that holds it.
 *
 * Positions are stored per account because that is what is true — the same
 * ticker bought in a TFSA and in a non-registered account has a different cost
 * basis and a different tax treatment, and merging them in the database would
 * throw that away. But a portfolio is read per security: "how much NVDA do I
 * own, and how has it done" is one question, not one question per account. So
 * the pooling happens here, at the point of display, and `lots` keeps the
 * per-account detail available for anything that needs it.
 */
export interface HoldingRow {
  /** Every stored position for this ticker, one per account. */
  lots: Holding[];
  /** The accounts still holding it — one tag each on the holdings page. */
  accountIds: string[];
  /**
   * Every share has been sold. The row is kept rather than deleted: the cost
   * basis and the dividends it paid are the record of a realized gain, which
   * still matters at tax time in a non-registered account. The holdings table
   * hides these unless closed positions are shown.
   */
  closed: boolean;
  ticker: string;
  name: string;
  currency: Currency;
  /** Combined across accounts. */
  shares: number;
  /** Share-weighted across accounts, in CAD. */
  avgCostCAD: number;
  priceCAD: number;
  marketValue: number;
  costBasis: number;
  /** Unrealized: what the shares still held are worth, less what they cost. */
  gain: number;
  /** Realized: what past sales brought in, less what those shares had cost. */
  realizedGain: number;
  totalDividends: number;
  /** Unrealized plus realized plus dividends — everything the position made. */
  totalReturn: number;
  /**
   * Annualized money-weighted return (%), or null when there are no dated
   * flows to measure — a position entered by hand has none. Null and zero are
   * different answers and are shown differently.
   */
  mwrr: number | null;
  weightPct: number;
  change1mPct: number;
}

/**
 * Replay a position's flows to recover what they add up to.
 *
 * Realized gain is not stored anywhere: it is whatever the sales brought in
 * less what those particular shares had cost, and that depends on the average
 * cost at the moment of each sale. Deriving it here keeps one source of truth —
 * the flows — instead of a stored total that can drift away from them.
 */
export function replayFlows(flows: CashFlow[]): {
  shares: number;
  costCAD: number;
  realizedGainCAD: number;
  dividendsCAD: number;
} {
  let shares = 0;
  let costCAD = 0;
  let realizedGainCAD = 0;
  let dividendsCAD = 0;

  for (const f of [...flows].sort((a, b) => a.date.localeCompare(b.date))) {
    if (f.kind === "buy") {
      shares += f.shares;
      costCAD += f.amount;
    } else if (f.kind === "sell") {
      const sold = Math.min(Math.abs(f.shares), shares);
      // Average cost: selling a third of the shares disposes of a third of the
      // basis, and what remains keeps the same average.
      const costOfSold = shares > 0 ? costCAD * (sold / shares) : 0;
      realizedGainCAD += f.amount - costOfSold;
      costCAD -= costOfSold;
      shares -= sold;
    } else {
      dividendsCAD += f.amount;
    }
  }

  return {
    shares: Math.round(shares * 1e8) / 1e8,
    costCAD: roundMoney(costCAD),
    realizedGainCAD: roundMoney(realizedGainCAD),
    dividendsCAD: roundMoney(dividendsCAD),
  };
}

/**
 * Money-weighted return for a position, from its flows plus what it is worth
 * now.
 *
 * Null when there is nothing to measure — no flows, or everything on one day.
 * Previously this was a simple total return annualized over a hardcoded 18
 * months, which gave a position bought last month and one held five years the
 * same denominator.
 */
/**
 * The date the closing value is dated at: today, or the last flow if a trade
 * is dated later than that.
 *
 * The default used to be the fifteenth of the current month, and anything
 * bought after it broke the calculation outright: the series then ended on the
 * purchase rather than on the value, so the money-weighted return of a
 * position was money going out and never coming back, which has no rate.
 * XEQT was bought on the 17th and had no figure at all for a fortnight.
 */
function valuationDate(flows: readonly CashFlow[], asOf: string): string {
  let latest = asOf;
  for (const f of flows) if (f.date > latest) latest = f.date;
  return latest;
}

function computeMwrr(flows: CashFlow[], marketValue: number, asOf: string): number | null {
  if (flows.length === 0) return null;
  const dated: DatedFlow[] = flows.map((f) => ({
    date: f.date,
    // Money paid in is negative, money received is positive.
    amount: f.kind === "buy" ? -f.amount : f.amount,
  }));
  // What the position is worth today closes the series: selling it now is the
  // final inflow.
  if (marketValue > 0) {
    dated.push({ date: valuationDate(flows, asOf), amount: marketValue });
  }
  return xirr(dated);
}

/**
 * Money-weighted return for the whole portfolio.
 *
 * Every dated flow from every position, pooled, closed by what the portfolio
 * is worth today. This is the counterpart to the time-weighted figure on the
 * chart, and it answers the other question: the time-weighted return measures
 * the holdings regardless of when money arrived, while this one measures what
 * actually happened to the money — a well-timed contribution before a rise
 * lifts it, and the same amount added at a peak drags it down. Read together
 * they say whether the timing helped.
 *
 * Closed positions keep their flows: money that went in and came back out is
 * part of the story even when the position no longer is. They contribute
 * nothing to the closing value, which is what a sold-off holding is worth.
 *
 * Null when there is nothing to solve — no flows at all, or every flow on the
 * same day.
 */
export function portfolioMwrr(
  holdings: Holding[],
  marketValue: number,
  asOf: string = todayISO(),
): number | null {
  const flows = holdings.flatMap((h) => h.flows);
  const dated: DatedFlow[] = flows.map((f) => ({
    date: f.date,
    // Money paid in is negative, money received is positive.
    amount: f.kind === "buy" ? -f.amount : f.amount,
  }));
  if (dated.length === 0) return null;
  if (marketValue > 0) {
    dated.push({ date: valuationDate(flows, asOf), amount: marketValue });
  }
  return xirr(dated);
}

/**
 * Money-weighted return over one window, rather than over all time.
 *
 * The window opens by treating what the portfolio was already worth as a
 * purchase made that month, and closes by treating what it is worth at the end
 * as a sale. Between them sit the real flows. That is what makes the figure
 * comparable to a time-weighted return over the same months: both then answer
 * for the same period, and the difference between them is the effect of when
 * money moved rather than an artefact of measuring different spans.
 *
 * Null when there is nothing to solve — no opening value and no flows, or
 * everything landing on one day.
 */
export function portfolioMwrrOver(
  holdings: Holding[],
  startMonth: string,
  startValue: number,
  endMonth: string,
  endValue: number,
): number | null {
  // Mid-month, matching the convention the per-position figure already uses:
  // a month key names a month, not a day, and the middle is the least wrong
  // day to stand in for it.
  const opened = `${startMonth}-15`;
  const closed = `${endMonth}-15`;
  const dated: DatedFlow[] = [];
  if (startValue > 0) dated.push({ date: opened, amount: -startValue });
  for (const h of holdings) {
    for (const f of h.flows) {
      const month = monthKeyOf(f.date);
      if (month <= startMonth || month > endMonth) continue;
      dated.push({
        date: f.date,
        amount: f.kind === "buy" ? -f.amount : f.amount,
      });
    }
  }
  if (dated.length === 0) return null;
  if (endValue > 0) dated.push({ date: closed, amount: endValue });
  return xirr(dated);
}

/**
 * A cumulative return restated as an annual rate.
 *
 * Needed because a cumulative figure and an annualized one cannot be compared
 * or subtracted, and the two returns on the chart are read against each other.
 * Below a year this extrapolates, which is standard and still worth knowing is
 * happening: a good quarter annualizes into a spectacular year.
 */
export function annualized(cumulativePct: number, months: number): number | null {
  if (months <= 0) return null;
  const growth = 1 + cumulativePct / 100;
  if (growth <= 0) return null;
  return (Math.pow(growth, 12 / months) - 1) * 100;
}

export interface SimpleReturn {
  /** Everything paid in, over every recorded buy. */
  contributed: number;
  /** Everything that came back: sales and dividends. */
  returned: number;
  /** What is still held, at today's prices. */
  held: number;
  /** Gain or loss as a percentage of what was put in, or null if nothing was. */
  pct: number | null;
}

/**
 * The plainest answer: everything in against everything out.
 *
 * No dates, no weighting — what was paid in, what came back, and what is still
 * held. It is the figure a bank statement would give you, and it ignores time
 * completely: the same 10% looks identical whether it took five months or five
 * years. That blindness is exactly why the other two measures exist, and why
 * showing it beside them explains them better than either does alone.
 */
export function simpleReturn(holdings: Holding[], marketValue: number): SimpleReturn {
  let contributed = 0;
  let returned = 0;
  for (const h of holdings) {
    for (const f of h.flows) {
      if (f.kind === "buy") contributed += f.amount;
      else returned += f.amount;
    }
  }
  contributed = roundMoney(contributed);
  returned = roundMoney(returned);
  const held = roundMoney(marketValue);
  return {
    contributed,
    returned,
    held,
    pct: contributed > 0 ? ((returned + held - contributed) / contributed) * 100 : null,
  };
}

/**
 * An annual rate restated over a shorter span — the inverse of `annualized`.
 *
 * A money-weighted return is annual by construction, which is unhelpful over a
 * quarter: a good three months annualizes into a figure nobody should quote.
 * Below a year both returns are shown over the window instead, and this is
 * what brings the annual one down to it.
 */
export function overMonths(annualPct: number, months: number): number | null {
  if (months <= 0) return null;
  const growth = 1 + annualPct / 100;
  if (growth <= 0) return null;
  return (Math.pow(growth, months / 12) - 1) * 100;
}

/**
 * Group stored positions by ticker.
 *
 * Cost basis is summed rather than averaged: the share-weighted average cost
 * falls out of dividing the pooled basis by the pooled share count, which is
 * the only way to combine two lots bought at different prices without
 * distorting either. MWRR then composes for free, since it is computed from
 * the pooled basis, value and dividends.
 */
export function consolidateHoldings(
  holdings: Holding[],
  asOf: string = todayISO(),
): HoldingRow[] {
  const groups = new Map<string, Holding[]>();
  for (const h of holdings) {
    const key = h.ticker.trim().toUpperCase();
    const bucket = groups.get(key);
    if (bucket) bucket.push(h);
    else groups.set(key, [h]);
  }

  const rows = [...groups.values()].map((lots) => {
    const shares = lots.reduce((sum, h) => sum + h.shares, 0);
    const costBasis = roundMoney(
      lots.reduce((sum, h) => sum + h.shares * (h.avgCostCAD ?? h.avgCost), 0),
    );
    const totalDividends = roundMoney(
      lots.reduce((sum, h) => sum + (h.dividendsReceivedCAD ?? h.dividendsReceived ?? 0), 0),
    );
    // Same security, so the price is the same wherever it is held; the lots
    // only disagree when one has never been priced.
    const priced = lots.find((h) => (h.priceCAD ?? h.price) > 0) ?? lots[0];
    const priceCAD = priced.priceCAD ?? priced.price;
    const hist = priced.historyCAD ?? priced.history;
    const prev = hist.length > 1 ? hist[hist.length - 2] : priceCAD;

    const marketValue = roundMoney(shares * priceCAD);
    const gain = subtractMoney(marketValue, costBasis);

    const openLots = lots.filter((h) => h.shares > 0);
    /*
     * Realized gain and the money-weighted return both come from the flows,
     * pooled across accounts so the row answers "how has this security done for
     * me" rather than "how has this tax wrapper done".
     */
    const flows = lots.flatMap((h) => h.flows ?? []);
    const realizedGain = roundMoney(
      lots.reduce((sum, h) => sum + replayFlows(h.flows ?? []).realizedGainCAD, 0),
    );
    return {
      lots,
      /*
       * Tag only the accounts that still hold it, so a position closed in one
       * account stops claiming to be there. When every lot is closed there is
       * nothing left to tag, so the row keeps its full history instead.
       */
      accountIds: [
        ...new Set((openLots.length > 0 ? openLots : lots).map((h) => h.accountId)),
      ],
      closed: shares <= 0,
      ticker: priced.ticker,
      name: priced.name,
      currency: priced.currency,
      shares: Math.round(shares * 1e8) / 1e8,
      avgCostCAD: shares > 0 ? costBasis / shares : 0,
      priceCAD,
      marketValue,
      costBasis,
      gain,
      realizedGain,
      totalDividends,
      totalReturn: roundMoney(gain + realizedGain + totalDividends),
      mwrr: computeMwrr(flows, marketValue, asOf),
      weightPct: 0,
      change1mPct: prev > 0 ? ((priceCAD - prev) / prev) * 100 : 0,
    };
  });

  const totalValue = sumMoney(rows.map((r) => r.marketValue));
  for (const r of rows) {
    r.weightPct = totalValue > 0 ? (r.marketValue / totalValue) * 100 : 0;
  }
  return rows.sort((a, b) => b.marketValue - a.marketValue);
}

export function holdingRows(holdings: Holding[]): HoldingRow[] {
  return consolidateHoldings(holdings);
}

/** The columns the holdings table can be ordered by. */
export type SortKey =
  | "name"
  | "shares"
  | "avgCostCAD"
  | "priceCAD"
  | "marketValue"
  | "totalDividends"
  | "totalReturn"
  | "mwrr"
  | "weightPct";

/**
 * Order rows by one column.
 *
 * The name column sorts on the security's name, since that is what the table
 * now leads with, and falls back to the ticker for anything unnamed. Ties break
 * on market value so the order is stable and predictable rather than depending
 * on which lot happened to be stored first.
 */
export function sortHoldingRows(
  rows: HoldingRow[],
  key: SortKey,
  dir: "asc" | "desc",
): HoldingRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === "mwrr") {
      // Positions with no measurable return sort last in either direction,
      // rather than being treated as zero.
      const av = a.mwrr;
      const bv = b.mwrr;
      if (av === null && bv === null) return b.marketValue - a.marketValue;
      if (av === null) return 1;
      if (bv === null) return -1;
      return av !== bv ? (av - bv) * sign : b.marketValue - a.marketValue;
    }
    if (key === "name") {
      const cmp = (a.name || a.ticker).localeCompare(b.name || b.ticker, undefined, {
        sensitivity: "base",
      });
      return cmp !== 0 ? cmp * sign : b.marketValue - a.marketValue;
    }
    const diff = a[key as Exclude<SortKey, "name" | "mwrr">] - b[key as Exclude<SortKey, "name" | "mwrr">];
    return diff !== 0 ? diff * sign : b.marketValue - a.marketValue;
  });
}

export interface BudgetRow {
  category: string;
  limit: number;
  spent: number;
  remaining: number;
  pct: number;
}

export function budgetRows(
  budgets: Budget[],
  transactions: Transaction[],
  monthKey = currentMonthKey(),
): BudgetRow[] {
  return budgets
    .map((b) => {
      const spent = sumMoney(
        transactions
          .filter(
            (t) =>
              t.type === "expense" &&
              t.category === b.category &&
              monthKeyOf(t.date) === monthKey,
          )
          .map((t) => t.amount),
      );
      return {
        category: b.category,
        limit: b.limit,
        spent,
        remaining: subtractMoney(b.limit, spent),
        pct: b.limit > 0 ? (spent / b.limit) * 100 : 0,
      };
    })
    .sort((a, b) => b.pct - a.pct);
}

export interface MonthTotals {
  income: number;
  expenses: number;
  net: number;
  savingsRate: number;
}

export function monthTotals(
  transactions: Transaction[],
  monthKey = currentMonthKey(),
): MonthTotals {
  let incomeCents = 0;
  let expenseCents = 0;
  for (const t of transactions) {
    if (monthKeyOf(t.date) !== monthKey) continue;
    if (t.type === "income") incomeCents += toCents(t.amount);
    else if (t.type === "expense") expenseCents += toCents(t.amount);
  }
  const income = fromCents(incomeCents);
  const expenses = fromCents(expenseCents);
  return {
    income,
    expenses,
    net: fromCents(incomeCents - expenseCents),
    savingsRate:
      incomeCents > 0
        ? ((incomeCents - expenseCents) / incomeCents) * 100
        : 0,
  };
}

/* ── Monthly averages ── */

/** Money the holdings made, as opposed to money the job made. */
export const PASSIVE_INCOME_CATEGORIES = new Set(["Dividends", "Interest"]);

/**
 * Income that does not arrive as money you can spend.
 *
 * Each for its own reason. A pension contribution never reaches an account
 * that can be drawn on. A dividend lands in the brokerage it was earned in,
 * not in chequing — it is return on the portfolio rather than money to live
 * on, and counting it would say the month had more in it than the month had.
 * A loan drawn down does arrive, but it is somebody else's money passing
 * through, and treating borrowing as cash flow flatters every figure it
 * touches.
 *
 * Interest is not here, and neither is cashback: both land in the account and
 * are recorded together under Interest.
 */
export const NON_SPENDABLE_INCOME = new Set([
  "RSP / Pension",
  "Loan Proceeds",
  "Dividends",
]);

export interface AverageMonth {
  /** How many months were averaged; fewer than asked for when the record is short. */
  months: number;
  income: number;
  expenses: number;
  passive: number;
  /**
   * Uncommitted liquid cash flow: what landed and stayed.
   *
   * Everything that arrived in an account you can spend from — pay, interest
   * and cashback, and anything else that turned up — less everything that was
   * spent. What is left is uncommitted: free to invest, to save, or to do
   * nothing with.
   *
   * It once subtracted only the *committed* costs, so a month's dining,
   * travel and shopping were reported as still available when they had
   * already been spent — about $1,550 a month too much on this record.
   */
  uncommittedLiquid: number;
}

export interface MonthlyAverage extends AverageMonth {
  from: string;
  to: string;
  /**
   * The same averages over the twelve months before those, for comparison.
   *
   * Null when nothing was recorded then, which is the difference between "no
   * change" and "no answer" — a record that starts inside the window would
   * otherwise report a rise from nothing as infinite improvement.
   */
  previous: AverageMonth | null;
  /** Per-month figures, oldest first, for the sparklines. */
  series: {
    key: string;
    income: number;
    expenses: number;
    passive: number;
    uncommittedLiquid: number;
  }[];
}

/**
 * The last `months` complete months, averaged.
 *
 * The month in progress is left out. A partial month drags every average down
 * by however much of it has not happened yet, which on the first of the month
 * would read as a collapse in income.
 */
export function monthlyAverages(
  transactions: Transaction[],
  months = 12,
  end = lastCompleteMonthKey(),
): MonthlyAverage {
  /*
   * Two windows of the same length, back to back: the twelve months being
   * reported and the twelve before them. Equal lengths is what makes them
   * comparable — each contains one of every month, so a December of presents
   * or a summer of travel falls on both sides and cancels.
   */
  const all = lastMonthKeys(months * 2, end);
  const keys = all.slice(months);
  const priorKeys = all.slice(0, months);

  const series = keys.map((key) => {
    let income = 0;
    let expenses = 0;
    let passive = 0;
    let liquidIncome = 0;
    for (const t of transactions) {
      if (monthKeyOf(t.date) !== key) continue;
      const cents = toCents(t.amount);
      if (t.type === "income") {
        income += cents;
        if (PASSIVE_INCOME_CATEGORIES.has(t.category)) passive += cents;
        if (!NON_SPENDABLE_INCOME.has(t.category)) liquidIncome += cents;
      } else if (t.type === "expense") {
        expenses += cents;
      }
    }
    return {
      key,
      income: fromCents(income),
      expenses: fromCents(expenses),
      passive: fromCents(passive),
      // Transfers are neither, which is what makes this the right figure for
      // "available to invest": moving money into a brokerage does not spend it.
      uncommittedLiquid: fromCents(liquidIncome - expenses),
    };
  });

  /*
   * Months before the record starts are not zero-income months, they are
   * months that did not happen, and averaging over them halves the answer.
   */
  const active = series.filter(
    (m) => m.income !== 0 || m.expenses !== 0,
  );
  const n = active.length;
  const mean = (pick: (m: (typeof series)[number]) => number) =>
    n === 0 ? 0 : roundMoney(active.reduce((sum, m) => sum + pick(m), 0) / n);

  const prior = averageOver(transactions, priorKeys);

  return {
    months: n,
    income: mean((m) => m.income),
    expenses: mean((m) => m.expenses),
    passive: mean((m) => m.passive),
    uncommittedLiquid: mean((m) => m.uncommittedLiquid),
    from: active[0]?.key ?? "",
    to: active[active.length - 1]?.key ?? "",
    previous: prior.months > 0 ? prior : null,
    series,
  };
}

/** The same four averages over an arbitrary set of months. */
function averageOver(transactions: Transaction[], keys: string[]): AverageMonth {
  const wanted = new Set(keys);
  const byMonth = new Map<
    string,
    { income: number; expenses: number; passive: number; uncommittedLiquid: number }
  >();
  for (const t of transactions) {
    const key = monthKeyOf(t.date);
    if (!wanted.has(key)) continue;
    const slot =
      byMonth.get(key) ??
      { income: 0, expenses: 0, passive: 0, uncommittedLiquid: 0 };
    const cents = toCents(t.amount);
    if (t.type === "income") {
      slot.income += cents;
      if (PASSIVE_INCOME_CATEGORIES.has(t.category)) slot.passive += cents;
      if (!NON_SPENDABLE_INCOME.has(t.category)) slot.uncommittedLiquid += cents;
    } else if (t.type === "expense") {
      slot.expenses += cents;
      slot.uncommittedLiquid -= cents;
    }
    byMonth.set(key, slot);
  }
  const active = [...byMonth.values()].filter(
    (m) => m.income !== 0 || m.expenses !== 0,
  );
  const n = active.length;
  const mean = (pick: (m: (typeof active)[number]) => number) =>
    n === 0 ? 0 : roundMoney(fromCents(active.reduce((sum, m) => sum + pick(m), 0)) / n);
  return {
    months: n,
    income: mean((m) => m.income),
    expenses: mean((m) => m.expenses),
    passive: mean((m) => m.passive),
    uncommittedLiquid: mean((m) => m.uncommittedLiquid),
  };
}

/* ── All-time portfolio series ── */

/**
 * Monthly closing prices in CAD, by ticker then month key, as served by
 * `/api/prices/history`.
 */
export type CloseHistory = Record<string, Record<string, number>>;

/** The month of the earliest recorded trade, or null if nothing is recorded. */
export function firstFlowMonth(holdings: Holding[]): string | null {
  let earliest: string | null = null;
  for (const h of holdings) {
    for (const f of h.flows) {
      const key = monthKeyOf(f.date);
      if (earliest === null || key < earliest) earliest = key;
    }
  }
  return earliest;
}

/** Month keys from `start` through the current month, oldest first. */
export function monthsSince(start: string, end = currentMonthKey()): string[] {
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  const count = (ey - sy) * 12 + (em - sm) + 1;
  if (!Number.isFinite(count) || count < 1) return [end];
  return lastMonthKeys(count, end);
}

interface MonthlyPosition {
  /** Shares held at the end of each month, and the book cost of them. */
  shares: Map<string, number>;
  cost: Map<string, number>;
}

/**
 * Walk one position's flows forward, recording where it stood each month end.
 *
 * The same average-cost arithmetic as `replayFlows`, stopped at every month
 * boundary instead of only at the end: a buy adds what was paid, a sell
 * disposes of its proportional share of the basis, and a dividend touches
 * neither. Kept beside it rather than folded into it because the two answer
 * different questions — one totals a position, this one traces it.
 */
function walkPositionByMonth(flows: CashFlow[], months: string[]): MonthlyPosition {
  const ordered = [...flows].sort((a, b) => a.date.localeCompare(b.date));
  const shares = new Map<string, number>();
  const cost = new Map<string, number>();
  let held = 0;
  let basis = 0;
  let i = 0;
  for (const month of months) {
    while (i < ordered.length && monthKeyOf(ordered[i].date) <= month) {
      const f = ordered[i++];
      if (f.kind === "buy") {
        held += f.shares;
        basis += f.amount;
      } else if (f.kind === "sell") {
        const sold = Math.min(Math.abs(f.shares), held);
        basis -= held > 0 ? basis * (sold / held) : 0;
        held -= sold;
      }
    }
    // Floating dust: a position sold out should read as exactly empty.
    shares.set(month, held < 1e-9 ? 0 : held);
    cost.set(month, held < 1e-9 ? 0 : basis);
  }
  return { shares, cost };
}

/**
 * The price to value a ticker at in a given month.
 *
 * Falls back to the nearest month on record — carrying the first known price
 * backwards and the last known price forwards — because a gap in the series is
 * a gap in what the provider carries, not a month the position was worthless.
 * A ticker with no history at all is valued at its book cost, which is the one
 * figure that is certainly true of it.
 */
function closeFor(
  closes: Record<string, number> | undefined,
  month: string,
): number | null {
  if (!closes) return null;
  const exact = closes[month];
  if (exact !== undefined) return exact;
  let below: string | null = null;
  let above: string | null = null;
  for (const m of Object.keys(closes)) {
    if (m <= month) {
      if (below === null || m > below) below = m;
    } else if (above === null || m < above) above = m;
  }
  const pick = below ?? above;
  return pick === null ? null : closes[pick];
}

/** Month-end portfolio values, by month then ticker, in CAD. */
export type SnapshotHistory = Record<string, Record<string, number>>;

export interface AllTimeSeries {
  points: PortfolioPoint[];
  /** Tickers valued at book cost because nothing better could be found. */
  unpriced: string[];
  /** Months whose value came entirely from recorded snapshots. */
  snapshotMonths: number;
}

/**
 * Market value and invested cost for every month since the record begins.
 *
 * Value prefers the user's own month-end record. That figure is what the
 * position was actually worth; anything else here is a reconstruction — a
 * price fetched later, multiplied by a share count replayed from the trades —
 * and where the two disagree the record is right. Prices fill the months it
 * does not cover, which in practice means the current month, since it is only
 * snapshotted once it ends.
 *
 * Cost always comes from the trades, never from a snapshot: it is exact there,
 * and the spreadsheet's own cost basis is not.
 *
 * The current month is the one month that is never snapshotted — it is only
 * recorded once it ends — so it falls back to the live price rather than to a
 * fetched close. Today's price is right for today and wrong for every earlier
 * month, which is why the fallback is confined to the last point.
 *
 * Both sides are pooled per ticker rather than per lot, because a snapshot is
 * recorded for a security rather than for each account holding it.
 */
export function allTimeSeries(
  holdings: Holding[],
  closes: CloseHistory,
  months: string[],
  snapshots: SnapshotHistory = {},
): AllTimeSeries {
  const unpriced = new Set<string>();
  const points = months.map((month) => ({
    key: month,
    label: labelMonth(month),
    value: 0,
    cost: 0,
  }));

  // Pool the lots: one share count and one book cost per ticker per month.
  const byTicker = new Map<string, { shares: Map<string, number>; cost: Map<string, number> }>();
  const currentPrice = new Map<string, number>();
  const lastMonth = months[months.length - 1];
  /*
   * The live price comes from a lot that is still open. A ticker held in
   * several accounts has a row per account, and a closed one keeps whatever
   * price it last had — often years stale — so taking whichever row happened
   * to come last valued the whole position at a price nobody holds it at.
   */
  const closedPrice = new Map<string, number>();
  for (const h of holdings) {
    const px = h.priceCAD ?? h.price;
    if (!Number.isFinite(px) || px <= 0) continue;
    const key = h.ticker.toUpperCase();
    if (h.shares > 0) currentPrice.set(key, px);
    else if (!closedPrice.has(key)) closedPrice.set(key, px);
  }
  for (const [ticker, px] of closedPrice) {
    if (!currentPrice.has(ticker)) currentPrice.set(ticker, px);
  }

  for (const h of holdings) {
    const ticker = h.ticker.toUpperCase();
    const walked = walkPositionByMonth(h.flows, months);
    const entry = byTicker.get(ticker);
    if (!entry) {
      byTicker.set(ticker, walked);
      continue;
    }
    for (const month of months) {
      entry.shares.set(month, (entry.shares.get(month) ?? 0) + (walked.shares.get(month) ?? 0));
      entry.cost.set(month, (entry.cost.get(month) ?? 0) + (walked.cost.get(month) ?? 0));
    }
  }

  let snapshotMonths = 0;
  for (let i = 0; i < months.length; i++) {
    const month = months[i];
    const recorded = snapshots[month] ?? {};
    let fromSnapshot = 0;
    let fromPrice = 0;

    // A ticker recorded that month, whether or not it is still held — a
    // position sold years ago was still worth something while it was open.
    for (const value of Object.values(recorded)) fromSnapshot += value;

    for (const [ticker, { shares, cost }] of byTicker) {
      points[i].cost += cost.get(month) ?? 0;
      if (recorded[ticker] !== undefined) continue; // already counted
      const held = shares.get(month) ?? 0;
      if (held <= 0) continue;
      const px =
        month === lastMonth
          ? (currentPrice.get(ticker) ?? closeFor(closes[ticker], month))
          : closeFor(closes[ticker], month);
      if (px === null) {
        unpriced.add(ticker);
        fromPrice += cost.get(month) ?? 0; // book cost: nothing better exists
      } else {
        fromPrice += held * px;
      }
    }

    if (fromSnapshot > 0 && fromPrice === 0) snapshotMonths++;
    points[i].value = fromSnapshot + fromPrice;
  }

  for (const p of points) {
    p.value = roundMoney(p.value);
    p.cost = roundMoney(p.cost);
  }
  return { points, unpriced: [...unpriced].sort(), snapshotMonths };
}

/* ── Net worth by asset class ── */

export const NET_WORTH_CLASSES = [
  "Cash",
  "Bonds",
  "Stocks",
  "Crypto",
  "Pension",
] as const;

export type NetWorthClass = (typeof NET_WORTH_CLASSES)[number];

export interface ClassPoint {
  key: string;
  label: string;
  Cash: number;
  Bonds: number;
  Stocks: number;
  Crypto: number;
  Pension: number;
  /** Debts, positive. Kept beside the bands rather than in them. */
  liabilities: number;
  net: number;
}

/**
 * Which band a holding's asset class belongs to.
 *
 * Two equity classes collapse into one band: the split between US and
 * international is a question about the stocks, and this chart is a question
 * about the mix. Anything unrecognised counts as stocks rather than being
 * dropped, since a missing band is worse than a coarse one.
 */
function bandFor(assetClass: AssetClass): NetWorthClass {
  if (assetClass === "Crypto") return "Crypto";
  if (assetClass === "Bonds") return "Bonds";
  return "Stocks";
}

/**
 * What net worth was made of, month by month.
 *
 * The same month-end values that drive the all-time chart, but kept apart by
 * what they are rather than summed: a line says net worth doubled, and this
 * says the doubling was crypto. The portfolio is split by the asset class on
 * each holding, and the account side supplies cash and the pension, which are
 * bands in their own right and not securities at all.
 *
 * A ticker recorded in a month but no longer held keeps its class, because the
 * class travels with the holding row rather than with the snapshot — a
 * position sold in 2022 was still bonds while it was open.
 */
export function netWorthByClass(
  accounts: Account[],
  holdings: Holding[],
  closes: CloseHistory,
  months: string[],
  snapshots: SnapshotHistory = {},
  usdCadRate = 1,
): ClassPoint[] {
  const classOf = new Map<string, NetWorthClass>();
  const currentPrice = new Map<string, number>();
  const closedPrice = new Map<string, number>();
  const walked = new Map<string, MonthlyPosition>();

  for (const h of holdings) {
    const ticker = h.ticker.toUpperCase();
    classOf.set(ticker, bandFor(h.assetClass));
    const px = h.priceCAD ?? h.price;
    if (Number.isFinite(px) && px > 0) {
      if (h.shares > 0) currentPrice.set(ticker, px);
      else if (!closedPrice.has(ticker)) closedPrice.set(ticker, px);
    }
    const position = walkPositionByMonth(h.flows, months);
    const existing = walked.get(ticker);
    if (!existing) {
      walked.set(ticker, position);
      continue;
    }
    for (const month of months) {
      existing.shares.set(month, (existing.shares.get(month) ?? 0) + (position.shares.get(month) ?? 0));
      existing.cost.set(month, (existing.cost.get(month) ?? 0) + (position.cost.get(month) ?? 0));
    }
  }
  for (const [ticker, px] of closedPrice) {
    if (!currentPrice.has(ticker)) currentPrice.set(ticker, px);
  }

  const lastMonth = months[months.length - 1];

  return months.map((month) => {
    const bands: Record<NetWorthClass, number> = {
      Cash: 0,
      Bonds: 0,
      Stocks: 0,
      Crypto: 0,
      Pension: 0,
    };
    let liabilityCents = 0;

    for (const acc of accounts) {
      const begins = acc.history[0]?.month;
      if (begins && month < begins) continue;
      const usd = month === lastMonth ? (acc.balanceUSD ?? 0) * usdCadRate : 0;
      const value = accountValueAt(acc, month) + usd;
      if (isLiability(acc.kind)) liabilityCents += toCents(value);
      else if (isPension(acc.kind)) bands.Pension += value;
      else bands.Cash += value;
    }

    const recorded = snapshots[month] ?? {};
    for (const [ticker, value] of Object.entries(recorded)) {
      bands[classOf.get(ticker) ?? "Stocks"] += value;
    }
    for (const [ticker, position] of walked) {
      if (recorded[ticker] !== undefined) continue; // already counted
      const held = position.shares.get(month) ?? 0;
      if (held <= 0) continue;
      const px =
        month === lastMonth
          ? (currentPrice.get(ticker) ?? closeFor(closes[ticker], month))
          : closeFor(closes[ticker], month);
      const band = classOf.get(ticker) ?? "Stocks";
      // Book cost when nothing better exists, as the all-time series does.
      bands[band] += px === null ? (position.cost.get(month) ?? 0) : held * px;
    }

    const liabilities = fromCents(liabilityCents);
    const assets = NET_WORTH_CLASSES.reduce((sum, c) => sum + toCents(bands[c]), 0);
    return {
      key: month,
      label: labelMonth(month),
      Cash: roundMoney(bands.Cash),
      Bonds: roundMoney(bands.Bonds),
      Stocks: roundMoney(bands.Stocks),
      Crypto: roundMoney(bands.Crypto),
      Pension: roundMoney(bands.Pension),
      liabilities,
      net: fromCents(assets - liabilityCents),
    };
  });
}

/* ── Time-weighted return ── */

/**
 * Net external cash flow per month: money put in, less money taken out.
 *
 * Buys are money arriving, sells are money leaving, and a rotation from one
 * holding into another nets to nothing — which is right, since moving between
 * positions is not a contribution.
 *
 * A dividend counts as money leaving, which reads oddly until you notice that
 * portfolio value here is holdings only: the cash a dividend pays out is not a
 * tracked position, so it has left the measured portfolio exactly as a
 * withdrawal would. Recording it that way is what gives the portfolio credit
 * for having earned it — value stayed flat while $50 walked out, so the month
 * returned $50.
 *
 * It also fixes reinvestment. A DRIP is a dividend out and a purchase back in;
 * excluding the dividend left the purchase looking like fresh capital, which
 * cancelled exactly the value it added and erased the distribution from the
 * return. As a pair they net to zero, and the reinvested value shows up as the
 * gain it is.
 */
export function netExternalFlows(holdings: Holding[]): Record<string, number> {
  const byMonth: Record<string, number> = {};
  for (const h of holdings) {
    for (const f of h.flows) {
      const month = monthKeyOf(f.date);
      const signed = f.kind === "buy" ? f.amount : -f.amount;
      byMonth[month] = (byMonth[month] ?? 0) + signed;
    }
  }
  return byMonth;
}

/**
 * Cumulative time-weighted return, in percent, one figure per month.
 *
 * The chart used to divide the latest portfolio value by the earliest one,
 * which answers a different question: it counts every deposit as though the
 * market had produced it. On a portfolio funded steadily over years that can
 * overstate the return by an order of magnitude — and it was being set beside
 * a benchmark that *is* time-weighted, so the alpha compared two unlike
 * things.
 *
 * Each month's return is measured by Modified Dietz — the gain net of that
 * month's flows, over the capital that was actually at work, counting a flow
 * as present for half the month since the day it landed is not recorded. The
 * monthly returns are then chained, which is what makes the result independent
 * of when money arrived and comparable to an index.
 */
export function chainedReturns(
  points: readonly PortfolioPoint[],
  flows: Readonly<Record<string, number>>,
): number[] {
  const out: number[] = [0];
  let chain = 1;
  for (let i = 1; i < points.length; i++) {
    const start = points[i - 1].value;
    const end = points[i].value;
    const flow = flows[points[i].key] ?? 0;
    // Average capital at work. A month that began empty and was funded
    // mid-way has no meaningful denominator, so it contributes no return
    // rather than an arbitrarily large one.
    const base = start + flow / 2;
    if (base > 0) chain *= 1 + (end - start - flow) / base;
    out.push(roundMoney((chain - 1) * 100));
  }
  return out;
}
