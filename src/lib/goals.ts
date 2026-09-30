import type { Account, Transaction } from "./types";
import {
  PASSIVE_INCOME_CATEGORIES,
  chainedReturns,
  type NetWorthPoint,
  type PortfolioPoint,
} from "./analytics";
import { countedAs, spendableCashAt } from "./year";
import {
  contributedIn,
  REGISTERED_PLANS,
  type ContributionLimits,
  type RegisteredPlan,
} from "./contributions";
import { DONATIONS_CATEGORY, groupOf, type SpendGroup } from "./expenses";
import { coverage } from "./story";
import { fromCents, roundMoney, toCents } from "./money";

/**
 * A year's financial goals, and how far along each one is.
 *
 * Every figure a goal can be set against is one the app already measures, and
 * each is measured here by the rule that measures it everywhere else: saving
 * and spending by `countedAs`, the Year page's own classifier; contributions by
 * `contributedIn`, which the room gauges use; a portfolio's return by
 * `chainedReturns`, as the Year page chains it; passive income's reach by the
 * Overview's `coverage`; net worth, the portfolio and debt from the month-end
 * series the Overview draws. A goal that disagreed with the page it is about
 * would be worse than no goal at all.
 */

export type GoalMetric =
  | "netWorth"
  | "portfolio"
  | "cash"
  | "debt"
  | "saved"
  | "invested"
  | "passive"
  | "contribution"
  | "spending"
  | "donations"
  /** A goal of the owner's own, which nothing measures and they check off by hand. */
  | "custom";

/** Every goal can be set as an amount, or as the percentage that suits it. */
export type GoalBasis = "amount" | "percent";

/**
 * How a goal is decided.
 *
 * `reach` and `reduceTo` are met the moment the record shows them met, at any
 * point in the window — a net worth that touched the target in May met the
 * goal in May, whatever it did after. The other three are about the whole
 * window — a cap on spending, a share of income — so they cannot be met until
 * it is over and its last month has been closed.
 */
export type GoalJudge = "reach" | "reduceTo" | "stayUnder" | "rateAtLeast" | "rateAtMost";

/** One way of setting a goal on a measure: as an amount, or as a percentage. */
interface Reading {
  unit: "cad" | "pct";
  /** A balance read month by month, or a sum over the months. */
  shape: "level" | "flow";
  judge: GoalJudge;
  /** What the "Set as" dropdown calls it. */
  option: string;
  /** What the target box is called. */
  field: string;
  /** Where the figure comes from, shown under the dropdown. */
  source: string;
  /** The largest target that means anything, for a percentage. */
  max?: number;
}

interface MetricDef {
  metric: GoalMetric;
  /** What the dropdown calls it. */
  label: string;
  /** Checked off by hand rather than measured. */
  manual?: boolean;
  amount: Reading;
  percent: Reading;
}

/** A measure as one goal reads it. */
export interface MetricSpec extends Reading {
  metric: GoalMetric;
  label: string;
  basis: GoalBasis;
}

const OF_INCOME = "over the months the goal covers, as the Year page counts income";

export const METRICS: readonly MetricDef[] = [
  {
    metric: "netWorth",
    label: "Net worth",
    amount: {
      unit: "cad",
      shape: "level",
      judge: "reach",
      option: "Dollar amount",
      field: "Target net worth",
      source: "Everything you own less everything you owe, at each month end, as on the Overview.",
    },
    percent: {
      unit: "pct",
      shape: "level",
      judge: "reach",
      option: "% growth",
      field: "Growth over the year (%)",
      source:
        "How far net worth has grown since the December before, at each month end. Needs a net worth above zero to grow from.",
      max: 1000,
    },
  },
  {
    metric: "portfolio",
    label: "Portfolio",
    amount: {
      unit: "cad",
      shape: "level",
      judge: "reach",
      option: "Dollar amount",
      field: "Target value",
      source: "What your holdings are worth at each month end, as on Investments.",
    },
    percent: {
      unit: "pct",
      shape: "level",
      judge: "reach",
      option: "% return",
      field: "Return (%)",
      source:
        "The portfolio's time-weighted return since the December before — money added or taken out does not count, as on the Year page.",
      max: 1000,
    },
  },
  {
    metric: "cash",
    label: "Cash on hand",
    amount: {
      unit: "cad",
      shape: "level",
      judge: "reach",
      option: "Dollar amount",
      field: "At least",
      source: "Chequing and savings less what the cards owe — the cash the Year page's flow closes on.",
    },
    percent: {
      unit: "pct",
      shape: "level",
      judge: "reach",
      option: "% of net worth",
      field: "Share of net worth (%)",
      source: "That same cash as a share of net worth, at each month end.",
    },
  },
  {
    metric: "debt",
    label: "Debt",
    amount: {
      unit: "cad",
      shape: "level",
      judge: "reduceTo",
      option: "Dollar amount",
      field: "Pay down to",
      source: "Every loan and card balance at each month end.",
    },
    percent: {
      unit: "pct",
      shape: "level",
      judge: "reach",
      option: "% paid down",
      field: "Paid down by (%)",
      source: "How much of what was owed the December before has been paid off, at each month end.",
    },
  },
  {
    metric: "saved",
    label: "Money saved",
    amount: {
      unit: "cad",
      shape: "flow",
      judge: "reach",
      option: "Dollar amount",
      field: "Target amount",
      source: "Income less spending, counted the way the Year page counts it.",
    },
    percent: {
      unit: "pct",
      shape: "flow",
      judge: "rateAtLeast",
      option: "% of income",
      field: "Savings rate (%)",
      source: `The share of income not spent — the savings rate — ${OF_INCOME}.`,
    },
  },
  {
    metric: "invested",
    label: "Money invested",
    amount: {
      unit: "cad",
      shape: "flow",
      judge: "reach",
      option: "Dollar amount",
      field: "Target amount",
      source: "Money put into holdings, less money taken out of them.",
    },
    percent: {
      unit: "pct",
      shape: "flow",
      judge: "rateAtLeast",
      option: "% of income",
      field: "Share of income (%)",
      source: `Money put into holdings less money taken out, as a share of income ${OF_INCOME}.`,
    },
  },
  {
    metric: "passive",
    label: "Passive income",
    amount: {
      unit: "cad",
      shape: "flow",
      judge: "reach",
      option: "Dollar amount",
      field: "Target amount",
      source: "Interest, cashback and dividends, as the Income page counts them.",
    },
    percent: {
      unit: "pct",
      shape: "flow",
      judge: "rateAtLeast",
      option: "% of spending covered",
      field: "Spending covered (%)",
      source:
        "How much of the months' spending passive income would pay for — the Overview's coverage figure.",
    },
  },
  {
    metric: "contribution",
    label: "Plan contributions",
    amount: {
      unit: "cad",
      shape: "flow",
      judge: "reach",
      option: "Dollar amount",
      field: "Target amount",
      source: "Money paid into a plan from outside it, as the contribution-room gauges count it.",
    },
    percent: {
      unit: "pct",
      shape: "flow",
      judge: "reach",
      option: "% of room",
      field: "Share of room (%)",
      source:
        "Contributions as a share of the year's room, as the Year page's room gauges show it. Counts only plans whose room has been entered.",
    },
  },
  {
    metric: "spending",
    label: "Spending",
    amount: {
      unit: "cad",
      shape: "flow",
      judge: "stayUnder",
      option: "Dollar amount",
      field: "Spend no more than",
      source: "Spending as the Expenses page counts it. Paying down a loan is not spending.",
    },
    percent: {
      unit: "pct",
      shape: "flow",
      judge: "rateAtMost",
      option: "% of income",
      field: "At most (% of income)",
      source: `Spending as the Expenses page counts it, as a share of income ${OF_INCOME}.`,
    },
  },
  {
    metric: "donations",
    label: "Charitable giving",
    amount: {
      unit: "cad",
      shape: "flow",
      judge: "reach",
      option: "Dollar amount",
      field: "Target amount",
      source: `Spending recorded under ${DONATIONS_CATEGORY}, counted the way the Expenses page counts it.`,
    },
    percent: {
      unit: "pct",
      shape: "flow",
      judge: "rateAtLeast",
      option: "% of income",
      field: "Share of income (%)",
      source: `Spending recorded under ${DONATIONS_CATEGORY}, as a share of income ${OF_INCOME}.`,
    },
  },
];

/**
 * A goal the record cannot measure — read a book on investing, write a will,
 * open the FHSA — set as words and checked off by hand. It has the shape of
 * the others so that it sits in the same list, is due by a month like them and
 * is celebrated the same way; it simply never has a figure.
 */
const MANUAL: Reading = {
  unit: "cad",
  shape: "flow",
  judge: "reach",
  option: "Checked off by hand",
  field: "What will you do?",
  source: "A goal of your own. Nothing measures it: check it off on the Goals page when it is done.",
};

export const CUSTOM: MetricDef = {
  metric: "custom",
  label: "Custom goal",
  manual: true,
  amount: MANUAL,
  percent: MANUAL,
};

export function specOf(metric: GoalMetric, basis: GoalBasis = "amount"): MetricSpec {
  if (metric === "custom") return { metric, label: CUSTOM.label, basis: "amount", ...MANUAL };
  const def = METRICS.find((m) => m.metric === metric) ?? METRICS[0];
  return { metric: def.metric, label: def.label, basis, ...def[basis] };
}

/** A target measured over the whole window, judged only once it has closed. */
export function isWholeWindow(judge: GoalJudge): boolean {
  return judge === "stayUnder" || judge === "rateAtLeast" || judge === "rateAtMost";
}

export interface Goal {
  id: string;
  /** The calendar year the goal belongs to. */
  year: string;
  metric: GoalMetric;
  /** An amount, or the percentage the metric's percent reading describes. */
  basis: GoalBasis;
  target: number;
  /** The last month the goal counts, YYYY-MM, inside `year`. */
  by: string;
  /** One plan, for a contribution goal; absent means every plan. */
  plan?: RegisteredPlan;
  /** What a custom goal is, in the owner's words. */
  title?: string;
  /** One category, for a spending goal; absent means all spending. */
  category?: string;
  /** Why it matters, in the owner's words. */
  why?: string;
  createdAt: string;
  /**
   * The day the goal was first seen met.
   *
   * Recorded once, when it is celebrated, and never cleared: a goal met in May
   * stays met in June whatever the figure does, and is never celebrated twice.
   */
  metOn?: string;
}

/* ── Measuring ── */

export interface GoalInputs {
  /** With dividend income included, as every income page reads them. */
  transactions: readonly Transaction[];
  accounts: readonly Account[];
  /** The month-end series, as the Overview and Year pages build it. */
  netWorth: readonly NetWorthPoint[];
  /** The portfolio's month-end values, which the net-worth series is built on. */
  portfolio: readonly PortfolioPoint[];
  /** Money into holdings less money out, by month. */
  flowsByMonth: Readonly<Record<string, number>>;
  /** Contribution room as entered, per year per plan. */
  limits: ContributionLimits;
  spendGroup?: (category: string) => SpendGroup;
  /**
   * Whether a month has been closed through the checklist. A goal judged over
   * a whole window waits for this, because the last month's spending is
   * usually entered after the month has ended.
   */
  isClosed: (month: string) => boolean;
  /** YYYY-MM-DD. */
  today: string;
}

/** The months a goal counts, clipped to today. Null for a year not yet begun. */
function windowOf(year: string, by: string, today: string): { from: string; to: string } | null {
  const from = `${year}-01`;
  const now = today.slice(0, 7);
  if (now < from) return null;
  return { from, to: now < by ? now : by };
}

const inWindow = (month: string, w: { from: string; to: string }) =>
  month >= w.from && month <= w.to;

const oneDecimal = (n: number) => Math.round(n * 10) / 10;

/**
 * Sums over the window's transactions, in cents, by the same classifier the
 * Year page uses.
 */
function flowTotals(
  goal: Pick<Goal, "category">,
  w: { from: string; to: string },
  inputs: GoalInputs,
) {
  const spendGroup = inputs.spendGroup ?? ((c: string) => groupOf(c));
  let income = 0;
  let expenses = 0;
  let passive = 0;
  let spending = 0;
  let donations = 0;
  for (const t of inputs.transactions) {
    if (!inWindow(t.date.slice(0, 7), w)) continue;
    const kind = countedAs(t, spendGroup);
    const cents = toCents(t.amount);
    if (kind === "income") {
      income += cents;
      if (PASSIVE_INCOME_CATEGORIES.has(t.category)) passive += cents;
    } else if (kind === "expense") {
      expenses += cents;
      if (!goal.category || t.category === goal.category) spending += cents;
      if (t.category === DONATIONS_CATEGORY) donations += cents;
    }
  }
  return { income, expenses, passive, spending, donations };
}

/** A month-end balance for one metric, in dollars. */
function levelAt(metric: GoalMetric, point: NetWorthPoint, accounts: readonly Account[]): number {
  switch (metric) {
    case "portfolio":
      return point.portfolio;
    case "debt":
      return point.liabilities;
    case "cash":
      return spendableCashAt(accounts, point.key);
    default:
      return point.net;
  }
}

/**
 * A percentage goal's figures in dollars: what the percentage is made of.
 *
 * A share means little without the money it is a share of — "18% growth" says
 * less than a net worth that has to reach a figure — so every percentage keeps
 * the two amounts it was worked out from. The target in dollars follows from
 * these and the goal's own percentage, in `dollarsOf`.
 */
export interface Dollars {
  /** The dollars the percentage measures: saved, paid off, net worth now. */
  amount: number;
  /** What it is a share of: income so far, last December's balance, the room. */
  base: number;
  /**
   * How the base reads beside its amount: "of" $… "income so far", "from" $…
   * "last December". Words only, so the page formats the money its own way.
   */
  lead: "of" | "from" | "on";
  noun: string;
  /**
   * Growth is measured on top of its base — a net worth that must reach the
   * base plus the percentage — where every other share is a part of it.
   */
  growth?: boolean;
  /**
   * The figure is an approximation, and says so. A time-weighted return does
   * not convert exactly to dollars: the dollars depend on when money arrived,
   * which is precisely what the return is built to ignore.
   */
  approx?: boolean;
}

export interface Measure {
  /** The figure as it stands. Null when the record has nothing to measure. */
  value: number | null;
  /**
   * The best the window has reached: the highest month for a `reach` level,
   * the lowest for debt paid down to an amount. For a sum it is the sum.
   */
  best: number | null;
  /** Where a level started the window, for pacing it. */
  start: number | null;
  /** A percentage goal's figures in dollars. Null for a goal set in dollars. */
  dollars: Dollars | null;
}

const NOTHING: Measure = { value: null, best: null, start: null, dollars: null };

/** The levels in the window, with the one they are measured from. */
function levels(
  goal: Pick<Goal, "metric" | "basis" | "year">,
  w: { from: string; to: string },
  inputs: GoalInputs,
): Measure {
  const spec = specOf(goal.metric, goal.basis);
  const decKey = `${Number(goal.year) - 1}-12`;

  /*
   * The return is chained exactly as the Year page chains a year's: from the
   * December before, month by month, with the flows taken out. Its dollars are
   * the market's part of the change — what the holdings are worth, less what
   * they were worth in December, less the money put in since.
   */
  if (goal.metric === "portfolio" && goal.basis === "percent") {
    const points = inputs.portfolio.filter((p) => inWindow(p.key, w) || p.key === decKey);
    if (points.length < 2) return NOTHING;
    const returns = chainedReturns(points, inputs.flowsByMonth).slice(1).map(oneDecimal);
    let flowCents = 0;
    for (const p of points.slice(1)) flowCents += toCents(inputs.flowsByMonth[p.key] ?? 0);
    const first = points[0].value;
    const last = points[points.length - 1].value;
    return {
      value: returns[returns.length - 1],
      best: Math.max(...returns),
      start: 0,
      dollars: {
        amount: fromCents(toCents(last) - toCents(first) - flowCents),
        base: first,
        lead: "on",
        noun: points[0].key === decKey ? "last December" : "at the start",
        approx: true,
      },
    };
  }

  const points = inputs.netWorth.filter((p) => inWindow(p.key, w));
  if (points.length === 0) return NOTHING;
  const before = inputs.netWorth.find((p) => p.key === decKey) ?? null;
  const raw = (p: NetWorthPoint) => levelAt(goal.metric, p, inputs.accounts);
  const latest = points[points.length - 1];

  let values: number[];
  let start: number;
  let dollars: Dollars | null = null;
  if (goal.basis === "amount") {
    values = points.map(raw);
    start = before ? raw(before) : values[0];
  } else if (goal.metric === "cash") {
    // A share of a net worth at or below zero is no share of anything.
    const share = (p: NetWorthPoint) => (p.net > 0 ? oneDecimal((raw(p) / p.net) * 100) : null);
    values = points.map(share).filter((v): v is number => v !== null);
    if (values.length === 0) return NOTHING;
    start = (before && share(before)) ?? values[0];
    // The target moves with net worth, so it is stated against today's.
    if (latest.net > 0) {
      dollars = { amount: raw(latest), base: latest.net, lead: "of", noun: "net worth now" };
    }
  } else {
    // Growth, or debt paid down: measured against the December before.
    const base = before ? raw(before) : raw(points[0]);
    if (base <= 0) return NOTHING;
    values = points.map((p) =>
      oneDecimal(goal.metric === "debt" ? ((base - raw(p)) / base) * 100 : ((raw(p) - base) / base) * 100),
    );
    start = 0;
    const when = before ? "last December" : "at the start";
    dollars =
      goal.metric === "debt"
        ? { amount: roundMoney(base - raw(latest)), base, lead: "of", noun: `owed ${when}` }
        : { amount: raw(latest), base, lead: "from", noun: when, growth: true };
  }
  const best = spec.judge === "reduceTo" ? Math.min(...values) : Math.max(...values);
  return { value: values[values.length - 1], best, start, dollars };
}

/**
 * What a goal's figure is, over its window.
 *
 * Exported for the composer, which measures a goal before it exists — the
 * figure so far this year and the one last year are what make a target
 * achievable rather than a guess.
 */
export function measure(
  goal: Pick<Goal, "metric" | "basis" | "year" | "by" | "plan" | "category">,
  inputs: GoalInputs,
): Measure {
  const w = windowOf(goal.year, goal.by, inputs.today);
  if (!w || goal.metric === "custom") return NOTHING;
  const spec = specOf(goal.metric, goal.basis);
  if (spec.shape === "level") return levels(goal, w, inputs);

  const pct = goal.basis === "percent";
  const within = () =>
    inputs.transactions.filter((t) => inWindow(t.date.slice(0, 7), w)) as Transaction[];
  const totals = flowTotals(goal, w, inputs);
  const flat = (value: number | null, dollars: Dollars | null = null): Measure => ({
    value,
    best: value,
    start: null,
    dollars: value === null ? null : dollars,
  });
  /** A sum as a share of the income so far, with its dollars. */
  const ofIncome = (cents: number): Measure =>
    flat(totals.income > 0 ? oneDecimal((cents / totals.income) * 100) : null, {
      amount: fromCents(cents),
      base: fromCents(totals.income),
      lead: "of",
      noun: "income so far",
    });

  switch (goal.metric) {
    case "invested": {
      let cents = 0;
      for (const [month, amount] of Object.entries(inputs.flowsByMonth)) {
        if (inWindow(month, w)) cents += toCents(amount);
      }
      return pct ? ofIncome(cents) : flat(fromCents(cents));
    }
    case "contribution": {
      /*
       * `contributedIn` is the rule the room gauges use, and it counts a whole
       * year. Handing it only the window's transactions bounds it by month
       * without a second copy of what a contribution is.
       */
      const plans = goal.plan ? [goal.plan] : REGISTERED_PLANS;
      const paid = (plan: RegisteredPlan) =>
        contributedIn(goal.year, plan, within(), inputs.accounts as Account[]);
      if (!pct) return flat(roundMoney(plans.reduce((sum, p) => sum + paid(p), 0)));
      // A share of room needs the room: only plans whose room was entered count.
      const room = inputs.limits[goal.year] ?? {};
      const measured = plans.filter((p) => (room[p] ?? 0) > 0);
      if (measured.length === 0) return NOTHING;
      const limit = measured.reduce((sum, p) => sum + (room[p] ?? 0), 0);
      const used = roundMoney(measured.reduce((sum, p) => sum + paid(p), 0));
      return flat(oneDecimal((used / limit) * 100), {
        amount: used,
        base: limit,
        lead: "of",
        noun: "room",
      });
    }
    case "passive": {
      if (!pct) return flat(fromCents(totals.passive));
      const covered = coverage(totals.passive, totals.expenses);
      return flat(covered === null ? null : oneDecimal(covered), {
        amount: fromCents(totals.passive),
        base: fromCents(totals.expenses),
        lead: "of",
        noun: "spending so far",
      });
    }
    case "spending":
      return pct ? ofIncome(totals.spending) : flat(fromCents(totals.spending));
    case "donations":
      return pct ? ofIncome(totals.donations) : flat(fromCents(totals.donations));
    default:
      return pct
        ? ofIncome(totals.income - totals.expenses)
        : flat(fromCents(totals.income - totals.expenses));
  }
}

/**
 * A percentage goal as dollars: what the record shows, and what the target
 * comes to at today's base. Null for a goal set in dollars, or with nothing to
 * measure yet.
 *
 * The target is worked out, not stored: a share of income so far grows as the
 * income does, so "20% of income" is a different number of dollars in March
 * than in December, and the page says which it is by naming the base.
 */
export function dollarsOf(
  goal: Pick<Goal, "target">,
  m: Measure,
): { amount: number; target: number; base: number; lead: string; noun: string; approx: boolean } | null {
  const d = m.dollars;
  if (!d) return null;
  const share = d.base * (goal.target / 100);
  return {
    amount: d.amount,
    target: roundMoney(d.growth ? d.base + share : share),
    base: d.base,
    lead: d.lead,
    noun: d.noun,
    approx: d.approx ?? false,
  };
}

/* ── Progress ── */

export type GoalStatus =
  | "met"
  | "on-track"
  | "behind"
  | "missed"
  /** A whole-window goal whose window is over, waiting for its last month to be closed. */
  | "awaiting"
  | "upcoming"
  | "no-data"
  /** A custom goal still to be checked off. */
  | "open";

export interface GoalProgress {
  goal: Goal;
  spec: MetricSpec;
  measure: Measure;
  /** Nought to one, for the bar. */
  fraction: number;
  status: GoalStatus;
  /**
   * The record shows the goal met now. Separate from `status`, which is also
   * "met" for a goal met earlier and already celebrated.
   */
  metNow: boolean;
}

const DAY = 86_400_000;

/** The last day of a YYYY-MM month, as a UTC timestamp. */
function monthEndUTC(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return Date.UTC(y, m, 0);
}

/** How much of the goal's window has passed, nought to one. */
function elapsedOf(goal: Pick<Goal, "year" | "by">, today: string): number {
  const start = Date.UTC(Number(goal.year), 0, 1);
  const end = monthEndUTC(goal.by) + DAY;
  const [ty, tm, td] = today.split("-").map(Number);
  const now = Date.UTC(ty, tm - 1, td) + DAY;
  if (end <= start) return 1;
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function progressOf(goal: Goal, inputs: GoalInputs): GoalProgress {
  const spec = specOf(goal.metric, goal.basis);
  const m = measure(goal, inputs);
  const now = inputs.today.slice(0, 7);

  /*
   * Done when the owner says so, and never before: nothing is measured, so
   * nothing can be met on its own. A month passing without a tick is missed,
   * but it can still be ticked — late is still done.
   */
  if (goal.metric === "custom") {
    const status: GoalStatus = goal.metOn
      ? "met"
      : now < `${goal.year}-01`
        ? "upcoming"
        : now > goal.by
          ? "missed"
          : "open";
    return { goal, spec, measure: m, fraction: goal.metOn ? 1 : 0, status, metNow: false };
  }

  const over = now > goal.by;
  const closed = over && inputs.isClosed(goal.by);
  const elapsed = elapsedOf(goal, inputs.today);
  const { target } = goal;

  let fraction = 0;
  let metNow = false;
  let pace: "on-track" | "behind" = "behind";

  if (m.value !== null) {
    switch (spec.judge) {
      case "reach": {
        metNow = (m.best ?? m.value) >= target;
        fraction = target > 0 ? clamp01(m.value / target) : 1;
        // A level is paced from where it started the year; a sum from nothing.
        const from = spec.shape === "level" ? (m.start ?? 0) : 0;
        pace = m.value >= from + (target - from) * elapsed ? "on-track" : "behind";
        break;
      }
      case "reduceTo": {
        metNow = (m.best ?? m.value) <= target;
        const from = m.start ?? m.value;
        fraction = from > target ? clamp01((from - m.value) / (from - target)) : 1;
        pace = m.value <= from - (from - target) * elapsed ? "on-track" : "behind";
        break;
      }
      case "stayUnder": {
        metNow = closed && m.value <= target;
        fraction = target > 0 ? clamp01(m.value / target) : 1;
        pace = elapsed > 0 && m.value / elapsed <= target ? "on-track" : "behind";
        break;
      }
      case "rateAtLeast": {
        metNow = closed && m.value >= target;
        fraction = target > 0 ? clamp01(m.value / target) : 1;
        pace = m.value >= target ? "on-track" : "behind";
        break;
      }
      case "rateAtMost": {
        metNow = closed && m.value <= target;
        fraction = target > 0 ? clamp01(m.value / target) : 1;
        pace = m.value <= target ? "on-track" : "behind";
        break;
      }
    }
  }

  let status: GoalStatus;
  if (goal.metOn || metNow) status = "met";
  else if (now < `${goal.year}-01`) status = "upcoming";
  // Spending past a dollar cap cannot come back: the goal is lost the day it is.
  else if (spec.judge === "stayUnder" && m.value !== null && m.value > target) status = "missed";
  else if (over && isWholeWindow(spec.judge)) status = closed ? "missed" : "awaiting";
  else if (over) status = "missed";
  else if (m.value === null) status = "no-data";
  else status = pace;

  return {
    goal,
    spec,
    measure: m,
    fraction: status === "met" ? 1 : fraction,
    status,
    metNow,
  };
}

/**
 * The goals the record now shows met that have never been celebrated.
 *
 * The watcher stamps `metOn` on each and celebrates them together; stamping is
 * what stops the same goal being celebrated on every page load.
 */
export function newlyMet(goals: readonly Goal[], inputs: GoalInputs): Goal[] {
  return goals.filter((g) => !g.metOn && progressOf(g, inputs).metNow);
}

/* ── Describing ── */

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function monthName(month: string): string {
  return MONTHS[Number(month.slice(5, 7)) - 1] ?? month;
}

/**
 * The goal as one sentence: "Use 100% of the TFSA's room by the end of June".
 *
 * The amount is formatted by the caller, so the sentence reads in the same
 * money format as the page around it.
 */
export function describe(
  goal: Goal,
  fmtMoney: (n: number) => string,
  /**
   * Whether to name the year. A page already showing one year's goals leaves
   * it out rather than repeat it on every card; a message on its own keeps it.
   */
  { year = true }: { year?: boolean } = {},
): string {
  const spec = specOf(goal.metric, goal.basis);
  const pct = goal.basis === "percent";
  const x = pct ? `${goal.target}%` : fmtMoney(goal.target);
  const when = goal.by.endsWith("-12")
    ? year
      ? ` in ${goal.year}`
      : ""
    : isWholeWindow(spec.judge)
      ? ` through ${monthName(goal.by)}`
      : ` by the end of ${monthName(goal.by)}`;
  const plan = goal.plan ? `the ${goal.plan}` : "registered plans";
  const spending = goal.category ? `${goal.category} spending` : "spending";

  if (goal.metric === "custom") return `${goal.title ?? "A goal of my own"}${when}`;

  const sentence: Record<Exclude<GoalMetric, "custom">, [string, string]> = {
    netWorth: [`Reach a net worth of ${x}`, `Grow net worth by ${x}`],
    portfolio: [`Grow the portfolio to ${x}`, `Earn a ${x} return on the portfolio`],
    cash: [`Hold cash of at least ${x}`, `Keep at least ${x} of net worth in cash`],
    debt: [`Pay debt down to ${x}`, `Pay debt down by ${x}`],
    saved: [`Save ${x}`, `Save ${x} of income`],
    invested: [`Invest ${x}`, `Invest ${x} of income`],
    passive: [`Earn passive income of ${x}`, `Cover ${x} of spending with passive income`],
    contribution: [
      `Contribute ${x} to ${plan}`,
      goal.plan ? `Use ${x} of the ${goal.plan}'s room` : `Use ${x} of registered plan room`,
    ],
    spending: [`Keep ${spending} under ${x}`, `Keep ${spending} under ${x} of income`],
    donations: [`Give ${x} to charity`, `Give ${x} of income to charity`],
  };
  return `${sentence[goal.metric][pct ? 1 : 0]}${when}`;
}

/* ── Checking what is stored ── */

const METRIC_KEYS = new Set<string>([...METRICS.map((m) => m.metric), CUSTOM.metric]);

/**
 * Goals as stored, with anything malformed dropped rather than trusted.
 *
 * Read from a JSON setting that a browser can also write in the demo, so every
 * field is checked: a goal with a target that is not a number would otherwise
 * draw a bar of NaN and could never be met or missed.
 */
export function cleanGoals(raw: unknown): Goal[] {
  if (!Array.isArray(raw)) return [];
  const out: Goal[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const g = item as Record<string, unknown>;
    if (typeof g.id !== "string" || !g.id) continue;
    if (typeof g.year !== "string" || !/^\d{4}$/.test(g.year)) continue;

    /*
     * Two shapes that came before every goal had a basis: a savings rate was
     * its own measure, and giving was the one goal with a share, called
     * "income". Both read as today's equivalent rather than being dropped.
     */
    let metric = g.metric;
    let basis: GoalBasis = g.basis === "percent" || g.basis === "income" ? "percent" : "amount";
    if (metric === "savingsRate") {
      metric = "saved";
      basis = "percent";
    }
    if (typeof metric !== "string" || !METRIC_KEYS.has(metric)) continue;
    // A custom goal is its words: without them there is nothing to check off.
    const title = typeof g.title === "string" ? g.title.trim().slice(0, 120) : "";
    if (metric === "custom" && !title) continue;
    if (metric === "custom") basis = "amount";

    const spec = specOf(metric as GoalMetric, basis);
    const target = Number(g.target);
    if (!Number.isFinite(target) || target < 0) continue;
    if (spec.unit === "pct" && target > (spec.max ?? 100)) continue;
    const by =
      typeof g.by === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(g.by) && g.by.startsWith(g.year)
        ? g.by
        : `${g.year}-12`;
    const goal: Goal = {
      id: g.id,
      year: g.year,
      metric: metric as GoalMetric,
      basis,
      target: spec.unit === "pct" ? oneDecimal(target) : roundMoney(target),
      by,
      createdAt: typeof g.createdAt === "string" ? g.createdAt : "",
    };
    // No plan named means every plan, as no category means all spending.
    if (metric === "contribution" && REGISTERED_PLANS.includes(g.plan as RegisteredPlan)) {
      goal.plan = g.plan as RegisteredPlan;
    }
    if (metric === "spending" && typeof g.category === "string" && g.category.trim()) {
      goal.category = g.category.trim().slice(0, 80);
    }
    if (metric === "custom") {
      goal.title = title;
      goal.target = 0;
    }
    if (typeof g.why === "string" && g.why.trim()) goal.why = g.why.trim().slice(0, 280);
    if (typeof g.metOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(g.metOn)) goal.metOn = g.metOn;
    out.push(goal);
  }
  return out;
}
