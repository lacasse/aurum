import { CashFlow, Holding, Registration } from "./types";
import { fromCents, roundMoney, toCents } from "./money";

/**
 * Mergers and demergers: what happens to a position when the company changes
 * shape rather than when you trade it.
 *
 * Neither is a purchase or a sale, and recording them as one gets the tax
 * wrong in a way that compounds. A spin-off is not income — nothing was
 * earned, a holding was divided — so treating the eventual sale of the new
 * shares as a dividend hides a capital gain and overstates income. And giving
 * the new shares no cost at all makes every dollar of their sale a gain, when
 * part of what they cost was paid years ago as part of the parent.
 *
 * What actually happens is that the cost follows the value. The parent's cost
 * basis is divided between what stayed and what was spun off, in whatever
 * proportion the company publishes with the distribution, and each side
 * carries its share forward. A merger is the same idea running backwards: the
 * old holding's cost moves into the new shares, and the old one closes.
 */

export type ActionKind = "demerger" | "merger";

export interface CorporateAction {
  id: string;
  kind: ActionKind;
  date: string;
  /** The holding that existed before: the parent, or the company acquired. */
  from: string;
  /** The holding that comes out of it: the spin-off, or the acquirer. */
  to: string;
  /** Shares of `to` received. */
  shares: number;
  registration: Registration | null;
  registrationRaw: string;
  /**
   * How much of the parent's cost basis moves with the spun-off shares, as a
   * percentage, from the allocation the company publishes.
   *
   * Zero is the honest default rather than a guess: it leaves the whole basis
   * with the parent, which is what the tax authorities assume when no
   * allocation is given, and it is visible in review for the figure to be
   * corrected. A merger ignores it — all of the cost moves.
   */
  allocationPct: number;
  include: boolean;
  sourceFile: string;
}

export interface AppliedAction {
  /** The parent, with its basis reduced. Absent when nothing changed. */
  parent?: { id: string; avgCostCAD: number };
  /** The new or updated holding, and the flow that records where it came from. */
  child: {
    ticker: string;
    shares: number;
    avgCostCAD: number;
    flow: CashFlow;
  };
  /** What moved, for the summary. */
  movedBasis: number;
}

/**
 * Work out the effect of one action on the holdings it touches.
 *
 * Returns the numbers rather than applying them, so the same calculation can
 * be shown in review and committed afterwards without the two drifting apart.
 */
export function applyAction(
  action: CorporateAction,
  parentHolding: Holding | undefined,
): AppliedAction | null {
  if (!parentHolding) return null;

  const parentShares = parentHolding.shares;
  const parentBasis = fromCents(
    toCents(parentShares * (parentHolding.avgCostCAD ?? parentHolding.avgCost)),
  );

  if (action.kind === "merger") {
    /*
     * Everything moves: the old holding is gone, and its cost is what the new
     * shares cost. Nothing is realized, which is the point of a rollover — the
     * gain waits until the new shares are sold.
     */
    const shares = action.shares > 0 ? action.shares : parentShares;
    return {
      parent: { id: parentHolding.id, avgCostCAD: 0 },
      child: {
        ticker: action.to,
        shares,
        avgCostCAD: shares > 0 ? roundMoney(parentBasis / shares) : 0,
        flow: {
          date: action.date,
          kind: "buy",
          amount: parentBasis,
          shares,
        },
      },
      movedBasis: parentBasis,
    };
  }

  const pct = Math.min(Math.max(action.allocationPct, 0), 100);
  const moved = roundMoney((parentBasis * pct) / 100);
  const remaining = roundMoney(parentBasis - moved);

  return {
    parent:
      parentShares > 0
        ? { id: parentHolding.id, avgCostCAD: roundMoney(remaining / parentShares) }
        : undefined,
    child: {
      ticker: action.to,
      shares: action.shares,
      avgCostCAD: action.shares > 0 ? roundMoney(moved / action.shares) : 0,
      flow: {
        date: action.date,
        kind: "buy",
        // A zero-cost flow still belongs in the record: it is how the shares
        // arrived, and without it the position has holdings with no history.
        amount: moved,
        shares: action.shares,
      },
    },
    movedBasis: moved,
  };
}

/** A short description of what an action will do, for the review screen. */
export function describeAction(action: CorporateAction, movedBasis: number): string {
  if (action.kind === "merger") {
    return `${action.from} becomes ${action.shares} ${action.to} — its whole cost basis moves across`;
  }
  return action.allocationPct > 0
    ? `${action.shares} ${action.to} out of ${action.from} — ${action.allocationPct}% of its cost basis (${movedBasis.toFixed(2)}) moves with them`
    : `${action.shares} ${action.to} out of ${action.from} — no cost basis moves, so their whole value is a gain when sold`;
}
