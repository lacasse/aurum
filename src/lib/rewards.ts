import { CashFlow, Holding } from "./types";
import { roundMoney } from "./money";

/**
 * Staking rewards: tokens that arrive without being bought.
 *
 * They are not a free acquisition, however they look on a statement. A reward
 * is income equal to what the tokens were worth on the day they landed, and an
 * acquisition of those tokens at that same value — one event with two halves,
 * and the second half is the one that keeps the cost base honest. The amount
 * counts as income once; because it is also the cost, it is not counted again
 * as a capital gain when the tokens are eventually sold.
 *
 * Recorded at nothing, as they were, the income disappears and the whole
 * future disposal becomes a gain: 94 SOL on this record carried no cost at
 * all, so every dollar they ever fetch reads as profit.
 *
 * The pair is written as a dividend of the value and a buy of the units for
 * that value, which is the shape the app already uses for a reinvested
 * distribution. As external flows the two cancel, so a reward is credited to
 * the position's return as something it earned rather than as capital put in.
 *
 * No cash moves. A reward is paid in kind, so unlike a distribution there is
 * nothing arriving in the account's balance to record.
 */

/** The two flows one reward becomes. `value` is CAD; zero means not yet known. */
export function rewardFlows(
  date: string,
  units: number,
  value: number,
): CashFlow[] {
  const amount = roundMoney(Math.max(value, 0));
  const acquisition: CashFlow = {
    date,
    kind: "buy",
    amount,
    shares: units,
    ...(amount > 0 ? {} : { awaitingPrice: true }),
  };
  // No income flow until there is a figure for it: a dividend of zero would
  // claim the reward was worth nothing rather than that nobody has said yet.
  return amount > 0
    ? [{ date, kind: "dividend", amount, shares: 0 }, acquisition]
    : [acquisition];
}

export interface PendingReward {
  holdingId: string;
  ticker: string;
  name: string;
  date: string;
  units: number;
}

/** Every reward still missing the value it arrived at, oldest first. */
export function awaitingPrice(holdings: Holding[]): PendingReward[] {
  const out: PendingReward[] = [];
  for (const h of holdings) {
    for (const f of h.flows) {
      if (!f.awaitingPrice) continue;
      out.push({
        holdingId: h.id,
        ticker: h.ticker,
        name: h.name,
        date: f.date,
        units: f.shares,
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker));
}

/**
 * Fill in what a reward was worth, once the price for that day is known.
 *
 * Matched on date and quantity rather than on position in the array, since two
 * rewards can land on the same day and the flows get sorted on the way through
 * the store.
 */
export function priceReward(
  flows: CashFlow[],
  date: string,
  units: number,
  value: number,
): CashFlow[] {
  const amount = roundMoney(value);
  if (!(amount > 0)) return flows;
  let done = false;
  const out: CashFlow[] = [];
  for (const f of flows) {
    if (!done && f.awaitingPrice && f.date === date && f.shares === units) {
      done = true;
      out.push({ date, kind: "dividend", amount, shares: 0 });
      out.push({ date, kind: "buy", amount, shares: units });
      continue;
    }
    out.push(f);
  }
  return out;
}
