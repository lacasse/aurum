/**
 * Editing the trade history of a position, one flow at a time.
 *
 * `planTrades` builds flows forward from a batch of new trades. This is the
 * other direction: a flow already recorded is corrected or removed, and the
 * position's share count, cost base and dividend total have to end up where
 * they would have been had the trade always read that way.
 *
 * The arithmetic is a replay rather than a patch. Undoing one buy out of the
 * middle of a history cannot be done by subtracting it — average cost depends
 * on the order every purchase happened in, and a sale between two buys has
 * already been priced against the average at that moment. Replaying from the
 * first flow is the only thing that gets a corrected history right, and it is
 * cheap: a position with a hundred trades is a hundred multiplications.
 */

import type { CashFlow, Holding } from "./types";
import { roundMoney } from "./money";

/** What a position's own numbers work out to, given its flows. */
export interface ReplayResult {
  shares: number;
  /** Average cost per share, in the same units `planTrades` writes. */
  avgCost: number;
  /** Every dividend and priced reward, totalled. */
  dividends: number;
}

/**
 * Recompute a position from its flows, oldest first.
 *
 * Sorted by date here rather than trusting the stored order: a trade entered
 * late — a statement that arrived a month after the fact — is appended to the
 * array but belongs earlier in the history, and average cost is order-dependent
 * enough that reading them as stored would price every later sale wrongly.
 *
 * A sale takes shares off at the average of the moment and leaves that average
 * where it is, which is what an average-cost base means: the cost that leaves
 * with the shares is their share of the pool, so the price of what remains is
 * unchanged. That mirrors `planTrades`, and the two must agree — a position
 * built by importing trades and the same position replayed here should hold
 * the same numbers.
 */
export function replayFlows(flows: CashFlow[]): ReplayResult {
  const ordered = [...flows].sort((a, b) => a.date.localeCompare(b.date));
  let shares = 0;
  let avgCost = 0;
  let dividends = 0;

  for (const f of ordered) {
    if (f.kind === "dividend") {
      dividends += f.amount;
      continue;
    }
    if (f.kind === "buy") {
      const qty = f.shares;
      if (qty <= 0) continue;
      const next = shares + qty;
      avgCost = shares > 0 ? (shares * avgCost + f.amount) / next : f.amount / qty;
      shares = next;
      continue;
    }
    /*
     * Sells carry a negative share count, which is how they are stored. Clamped
     * at zero because a history that oversells is a history with a mistake in
     * it, and a negative share count would spread that mistake into every
     * valuation on every page rather than leaving it where it happened.
     */
    shares = Math.max(0, shares - Math.abs(f.shares));
  }

  return {
    shares: Math.round(shares * 1e8) / 1e8,
    avgCost: Math.round(avgCost * 10000) / 10000,
    dividends: roundMoney(dividends),
  };
}

/**
 * A flow's place in the record: which position it belongs to, and where in
 * that position's array it sits.
 *
 * Flows have no identity of their own — they are plain objects in an array —
 * so a row on screen has to remember its index to be able to change it later.
 * Which means an edit is only safe against the array it was read from; the
 * store is the single source both come from, so within one render they agree.
 */
export interface FlowRef {
  holdingId: string;
  index: number;
}

/**
 * The position as it would be after `edit` replaces the flow at `index`, or
 * removes it when `edit` is null.
 *
 * Returns the fields to hand to `updateHolding`, or null when the reference
 * does not point at a flow — a stale row from a list rendered before the
 * position changed underneath it.
 */
export function holdingAfterFlowEdit(
  holding: Holding,
  index: number,
  edit: CashFlow | null,
): { flows: CashFlow[] } & ReplayResult | null {
  const flows = holding.flows ?? [];
  if (index < 0 || index >= flows.length) return null;
  const next = flows.slice();
  if (edit === null) next.splice(index, 1);
  else next[index] = edit;
  return { flows: next, ...replayFlows(next) };
}

/** One trade, flattened out of the position it belongs to. */
export interface TradeRecord {
  holdingId: string;
  index: number;
  ticker: string;
  name: string;
  accountId: string;
  date: string;
  kind: CashFlow["kind"];
  /** CAD, unsigned — the way flows store it. */
  amount: number;
  /** Signed: positive on a buy, negative on a sell, zero on a dividend. */
  shares: number;
  awaitingPrice: boolean;
}

/**
 * Every trade across every position, newest first.
 *
 * Flattened so the transactions page can list trades beside the transactions
 * it already lists. The index is kept because it is the only way back to the
 * flow it came from.
 */
export function allTrades(holdings: Holding[]): TradeRecord[] {
  const out: TradeRecord[] = [];
  for (const h of holdings) {
    (h.flows ?? []).forEach((f, index) => {
      out.push({
        holdingId: h.id,
        index,
        ticker: h.ticker,
        name: h.name,
        accountId: h.accountId,
        date: f.date,
        kind: f.kind,
        amount: f.amount,
        shares: f.shares,
        awaitingPrice: f.awaitingPrice === true,
      });
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
