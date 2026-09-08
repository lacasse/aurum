import type { Account, Registration, Transaction } from "./types";

/**
 * The three registered plans that carry contribution room you can run out of.
 *
 * A pension is left out on purpose: its room is not something you choose to
 * use, and a non-registered account has none to track.
 */
export type RegisteredPlan = "TFSA" | "RRSP" | "FHSA";

export const REGISTERED_PLANS: RegisteredPlan[] = ["TFSA", "RRSP", "FHSA"];

export function isRegisteredPlan(r: Registration | undefined): r is RegisteredPlan {
  return r === "TFSA" || r === "RRSP" || r === "FHSA";
}

/**
 * Room per plan per calendar year, as the CRA states it.
 *
 * Kept by year rather than as a single current figure because room is a fact
 * about a year: last year's is not superseded when this year's is announced,
 * and a year already closed should not change because a new number arrived.
 *
 * Entered by hand, because none of it can be derived. Room depends on income,
 * on unused room carried forward, and on withdrawals made years ago — all of
 * it on a notice of assessment the app has never seen. Guessing would produce
 * a plausible number, which is the one thing worse than no number.
 */
export type ContributionLimits = Record<string, Partial<Record<RegisteredPlan, number>>>;

export interface PlanRoom {
  plan: RegisteredPlan;
  /** Null when nobody has entered the year's room yet. */
  limit: number | null;
  contributed: number;
  /** Null without a limit. Negative when over-contributed. */
  remaining: number | null;
  /** Percentage of the room used, or null without one. Can exceed 100. */
  used: number | null;
  over: boolean;
  /** Whether any account of this registration exists at all. */
  held: boolean;
}

const YEAR = /^(\d{4})/;

function yearOf(date: string): string {
  return YEAR.exec(date)?.[1] ?? "";
}

/**
 * What was paid into a plan during a calendar year.
 *
 * Counted as money arriving from outside the plan: a transfer whose
 * destination is an account of that registration. Gross, not net of
 * withdrawals — taking money out does not give the room back in the year you
 * took it, so netting it off would report room that does not exist. For a TFSA
 * the withdrawal returns as room on 1 January of the *following* year, which is
 * a fact about next year's limit and belongs in next year's figure.
 *
 * A transfer between two accounts of the same registration is movement inside
 * the plan, not a contribution, and is ignored.
 */
export function contributedIn(
  year: string,
  plan: RegisteredPlan,
  transactions: Transaction[],
  accounts: Account[],
): number {
  const inPlan = new Set(
    accounts.filter((a) => a.registration === plan).map((a) => a.id),
  );
  if (inPlan.size === 0) return 0;

  let total = 0;
  for (const t of transactions) {
    if (t.type !== "transfer") continue;
    if (yearOf(t.date) !== year) continue;
    if (!t.destinationAccountId || !inPlan.has(t.destinationAccountId)) continue;
    // Moving between two accounts of the same plan is not new money.
    if (t.sourceAccountId && inPlan.has(t.sourceAccountId)) continue;
    total += t.amount;
  }
  return Math.round(total * 100) / 100;
}

/** Every plan's room for a year, in a fixed order so the gauges never reorder. */
export function contributionRoom(
  year: string,
  transactions: Transaction[],
  accounts: Account[],
  limits: ContributionLimits,
): PlanRoom[] {
  const forYear = limits[year] ?? {};
  return REGISTERED_PLANS.map((plan) => {
    const limit = forYear[plan] ?? null;
    const contributed = contributedIn(year, plan, transactions, accounts);
    const held = accounts.some((a) => a.registration === plan);
    return {
      plan,
      limit,
      contributed,
      remaining: limit === null ? null : Math.round((limit - contributed) * 100) / 100,
      used: limit === null || limit <= 0 ? null : (contributed / limit) * 100,
      over: limit !== null && contributed > limit,
      held,
    };
  });
}

/**
 * A month a plan's room was asked about and put off, per plan per year.
 *
 * Stored because the answer is often "not yet" — the notice of assessment has
 * not arrived, or the new limit has not been announced — and an app that asks
 * again the following month is useful where one that gives up until next
 * December is not.
 */
export type RoomDeferrals = Record<string, Partial<Record<RegisteredPlan, string>>>;

export interface RoomAsk {
  plan: RegisteredPlan;
  /** The year whose room is being set, which is not always the month's year. */
  year: string;
}

/**
 * The months that raise the question, and the year each one is about.
 *
 * Closing **December** is the January checklist, and the TFSA and FHSA limits
 * for the year just started are known by then — so it sets the *following*
 * year's room, not the closed month's. Closing **March** is the April
 * checklist, by which point the notice of assessment carrying RRSP room has
 * arrived, and that room is for the year in progress.
 *
 * Keyed off the month being closed, never today's date: a checklist run late is
 * still that month's checklist and the question is still owed.
 */
export function triggeredAsks(month: string): RoomAsk[] {
  const m = month.slice(5, 7);
  const year = Number(month.slice(0, 4));
  if (!Number.isFinite(year)) return [];
  if (m === "12") {
    const next = String(year + 1);
    return [
      { plan: "TFSA", year: next },
      { plan: "FHSA", year: next },
    ];
  }
  if (m === "03") return [{ plan: "RRSP", year: String(year) }];
  return [];
}

/**
 * What this month's checklist should actually ask about.
 *
 * Three things have to be true. The month has to raise the question, or a
 * previous month has to have raised it and been put off. The figure must not
 * already be recorded. And **the account has to exist** — asking someone for
 * their FHSA room when they have no FHSA is a step that can only be skipped,
 * which is worse than no step at all.
 */
export function roomAsks(
  month: string,
  limits: ContributionLimits,
  deferrals: RoomDeferrals,
  accounts: Account[],
): RoomAsk[] {
  const held = new Set(
    accounts.map((a) => a.registration).filter(isRegisteredPlan),
  );

  const asks = new Map<string, RoomAsk>();
  const consider = (ask: RoomAsk) => asks.set(`${ask.year}|${ask.plan}`, ask);

  for (const ask of triggeredAsks(month)) consider(ask);

  /*
   * A deferral carries the question forward one month at a time. The month it
   * was put off in is recorded, so the ask returns on the next checklist rather
   * than immediately on the same one.
   */
  for (const [year, plans] of Object.entries(deferrals)) {
    for (const plan of REGISTERED_PLANS) {
      const deferredAt = plans[plan];
      if (typeof deferredAt === "string" && month > deferredAt) {
        consider({ plan, year });
      }
    }
  }

  return [...asks.values()]
    .filter((a) => held.has(a.plan))
    .filter((a) => typeof limits[a.year]?.[a.plan] !== "number")
    /*
     * A deferral silences its own month as well as the ones before it.
     * Otherwise December both raises the question and records that it was put
     * off, so reopening December's checklist asks again immediately — which is
     * not what "ask me next month" promised.
     */
    .filter((a) => {
      const deferredAt = deferrals[a.year]?.[a.plan];
      return typeof deferredAt !== "string" || month > deferredAt;
    })
    .sort((a, b) => a.year.localeCompare(b.year) || a.plan.localeCompare(b.plan));
}

/** Record that a set of asks was put off in this month, to return next month. */
export function deferAsks(
  month: string,
  asks: RoomAsk[],
  deferrals: RoomDeferrals,
): RoomDeferrals {
  const next: RoomDeferrals = { ...deferrals };
  for (const { plan, year } of asks) {
    next[year] = { ...(next[year] ?? {}), [plan]: month };
  }
  return next;
}

/** Drop deferrals for room that has since been entered, so they cannot linger. */
export function clearAnswered(
  limits: ContributionLimits,
  deferrals: RoomDeferrals,
): RoomDeferrals {
  const next: RoomDeferrals = {};
  for (const [year, plans] of Object.entries(deferrals)) {
    const kept: Partial<Record<RegisteredPlan, string>> = {};
    for (const plan of REGISTERED_PLANS) {
      const at = plans[plan];
      if (typeof at === "string" && typeof limits[year]?.[plan] !== "number") {
        kept[plan] = at;
      }
    }
    if (Object.keys(kept).length > 0) next[year] = kept;
  }
  return next;
}
