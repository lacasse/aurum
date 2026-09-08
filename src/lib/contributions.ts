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
 * Which plans should be asked about when closing a given month.
 *
 * Keyed off the month being closed, never off today's date: closing January
 * asks about the TFSA and FHSA whenever you get to it, and closing March asks
 * about the RRSP whenever you get to it. A checklist run late is still the
 * January checklist, and the question is still owed.
 *
 * Those two months because that is when each figure becomes knowable — the
 * checklist for a month is run in the month after it. The TFSA and FHSA limits for a year apply from 1 January
 * and are known by then; RRSP room comes off the notice of assessment, which
 * arrives after the return is filed.
 *
 * Returns the plans, and the year whose room is being set — the closed month's
 * own year in both cases.
 */
export function plansDueForUpdate(month: string): RegisteredPlan[] {
  const m = month.slice(5, 7);
  if (m === "01") return ["TFSA", "FHSA"];
  if (m === "03") return ["RRSP"];
  return [];
}

/** Whether a year's room has been entered for every plan being asked about. */
export function roomEntered(
  year: string,
  plans: RegisteredPlan[],
  limits: ContributionLimits,
): boolean {
  const forYear = limits[year] ?? {};
  return plans.every((p) => typeof forYear[p] === "number");
}
