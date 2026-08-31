import { roundMoney } from "./money";

/**
 * What the portfolio is against what it is meant to be.
 *
 * A target is only meaningful next to the actual weight and the money between
 * them: "eight points over" is a judgement, "$38,000 over" is an instruction.
 * Both are here, and the second is the one that gets acted on.
 *
 * Targets are per security rather than per asset class. That is how they were
 * kept in the spreadsheet, and it is the finer question — two funds in the
 * same class can be one you are building and one you are leaving.
 */

export interface DriftRow {
  ticker: string;
  name: string;
  value: number;
  /** Share of the portfolio today, as a percentage. */
  actualPct: number;
  /** Share it is meant to be. Null when no target has been set for it. */
  targetPct: number | null;
  /** Actual less target, in percentage points. Null without a target. */
  driftPct: number | null;
  /** What that drift is worth: positive means holding more than intended. */
  driftValue: number | null;
}

export interface Drift {
  rows: DriftRow[];
  /** Total of every target set. Meant to be 100. */
  targetTotal: number;
  /** Securities held with no target set for them. */
  untargeted: number;
  /** Value of everything held above its target, which is what funds the rest. */
  overweight: number;
}

export function drift(
  positions: { ticker: string; name: string; marketValue: number }[],
  targets: Record<string, number>,
): Drift {
  const total = positions.reduce((sum, p) => sum + p.marketValue, 0);
  const keyed = new Map(
    Object.entries(targets).map(([ticker, pct]) => [ticker.toUpperCase(), pct]),
  );

  const rows: DriftRow[] = positions.map((p) => {
    const ticker = p.ticker.toUpperCase();
    const targetPct = keyed.has(ticker) ? (keyed.get(ticker) as number) : null;
    const actualPct = total > 0 ? (p.marketValue / total) * 100 : 0;
    return {
      ticker: p.ticker,
      name: p.name,
      value: p.marketValue,
      actualPct,
      targetPct,
      driftPct: targetPct === null ? null : actualPct - targetPct,
      driftValue:
        targetPct === null
          ? null
          : roundMoney(p.marketValue - (total * targetPct) / 100),
    };
  });

  /*
   * A target for something no longer held still counts towards the total. It
   * is a plan for the portfolio, and dropping it because the position is empty
   * would silently make the plan add up to less than all of it.
   */
  const targetTotal = [...keyed.values()].reduce((sum, pct) => sum + pct, 0);

  return {
    rows: rows.sort((a, b) => (b.driftValue ?? -Infinity) - (a.driftValue ?? -Infinity)),
    targetTotal: Math.round(targetTotal * 100) / 100,
    untargeted: rows.filter((r) => r.targetPct === null).length,
    overweight: roundMoney(
      rows.reduce((sum, r) => sum + Math.max(r.driftValue ?? 0, 0), 0),
    ),
  };
}
