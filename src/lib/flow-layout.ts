/**
 * Where the bars of a flow chart sit, and in what order.
 *
 * Kept apart from the chart that draws them because it is arithmetic, not
 * rendering: given the nodes and the ribbons between them it decides which
 * column each node stands in and how the columns are ordered, and it can be
 * checked without a browser. That matters more here than elsewhere. The order
 * used to be a set of hand-written rules in the data layer — sources ranked by
 * the bar they reached, the account holding the remainder pushed to the foot,
 * the pooled category kept last — each written to settle one crossing somebody
 * had noticed, each working on the shape it was written for, and each defeated
 * by the next kind of node the chart learned to draw.
 */

export interface FlowGraph {
  nodes: unknown[];
  links: { source: number; target: number; value?: number }[];
}

/**
 * The column each node is drawn in.
 *
 * The longest path from a source, and then the layout's own last rule: a node
 * with nothing leaving it is pushed to the far column however short its path
 * was, so what a reader sees as the end of the chart is the end of the chart.
 */
export function columnsOf({ nodes, links }: FlowGraph): number[] {
  const at = nodes.map(() => 0);
  for (let pass = 0; pass < nodes.length; pass++) {
    let moved = false;
    for (const l of links) {
      if (at[l.target] < at[l.source] + 1) {
        at[l.target] = at[l.source] + 1;
        moved = true;
      }
    }
    if (!moved) break;
  }
  const end = Math.max(0, ...at);
  const leaves = new Set(links.map((l) => l.source));
  nodes.forEach((_, i) => {
    if (!leaves.has(i)) at[i] = end;
  });
  return at;
}

/** The columns, each listing the nodes in it, top to bottom. */
function group(order: number[], at: number[]): number[][] {
  const cols: number[][] = [];
  for (const i of order) (cols[at[i]] ??= []).push(i);
  return cols.map((c) => c ?? []);
}

/**
 * How many pairs of ribbons cross, for a given ordering.
 *
 * Two ribbons between the same pair of columns cross exactly when their ends
 * are in opposite order, which is all this counts. It says nothing about
 * thickness: a hairline crossing a hairline counts the same as two wide bands,
 * and that is the right measure for deciding an order, because the order is
 * what is being chosen and not the widths.
 */
export function crossingsIn(graph: FlowGraph, order?: number[]): number {
  const at = columnsOf(graph);
  const cols = group(order ?? graph.nodes.map((_, i) => i), at);
  const after = new Map<number, number[]>();
  for (const l of graph.links) {
    const to = after.get(l.source);
    if (to) to.push(l.target);
    else after.set(l.source, [l.target]);
  }
  let total = 0;
  for (let i = 0; i + 1 < cols.length; i++) {
    const seat = new Map(cols[i + 1].map((n, k) => [n, k]));
    const ends: number[][] = [];
    cols[i].forEach((u, ui) => {
      for (const v of after.get(u) ?? []) {
        const vi = seat.get(v);
        if (vi !== undefined) ends.push([ui, vi]);
      }
    });
    ends.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (let a = 0; a < ends.length; a++) {
      for (let b = a + 1; b < ends.length; b++) if (ends[a][1] > ends[b][1]) total++;
    }
  }
  return total;
}

/**
 * The same count, with each crossing weighed by the two bands that make it.
 *
 * Counting pairs decides an order; it does not decide which order *looks*
 * settled. Two hairlines crossing is a detail nobody sees, and a salary
 * crossing a year of rent is the thing being complained about — counted the
 * same, an arrangement that tucks away four hairlines wins over one that
 * untangles the two widest bands on the chart. So the objective is the product
 * of the widths, which is what a reader's eye is actually totting up.
 */
function weighedCrossings(graph: FlowGraph, order?: number[]): number {
  const at = columnsOf(graph);
  const cols = group(order ?? graph.nodes.map((_, i) => i), at);
  const out = new Map<number, { to: number; w: number }[]>();
  for (const l of graph.links) {
    const w = l.value ?? 1;
    const to = out.get(l.source);
    if (to) to.push({ to: l.target, w });
    else out.set(l.source, [{ to: l.target, w }]);
  }
  let total = 0;
  for (let i = 0; i + 1 < cols.length; i++) {
    const seat = new Map(cols[i + 1].map((n, k) => [n, k]));
    const ends: { from: number; to: number; w: number }[] = [];
    cols[i].forEach((u, ui) => {
      for (const e of out.get(u) ?? []) {
        const vi = seat.get(e.to);
        if (vi !== undefined) ends.push({ from: ui, to: vi, w: e.w });
      }
    });
    for (let a = 0; a < ends.length; a++) {
      for (let b = a + 1; b < ends.length; b++) {
        const first = ends[a].from <= ends[b].from ? ends[a] : ends[b];
        const second = first === ends[a] ? ends[b] : ends[a];
        if (first.from < second.from && first.to > second.to) total += first.w * second.w;
        else if (first.from === second.from) continue;
      }
    }
  }
  return total;
}

/**
 * An order for the nodes that draws as few crossings as it can find.
 *
 * The standard answer to an old problem, rather than another rule about
 * salaries: put every node at the average height of the nodes it joins in the
 * column beside it, sweep forward and back until it settles, and keep whichever
 * pass crossed least. It knows nothing about what any node means, which is the
 * point — a node added next year is ordered on the same terms as every node
 * already here.
 *
 * The order the graph arrives in is both the starting point and the tie-break,
 * so where two arrangements cross equally the one the caller asked for is the
 * one returned, and a node with nothing to be drawn toward keeps its place.
 */
export function seatColumns(graph: FlowGraph, passes = 8): number[] {
  const at = columnsOf(graph);
  const after = new Map<number, number[]>();
  const before = new Map<number, number[]>();
  for (const l of graph.links) {
    (after.get(l.source) ?? after.set(l.source, []).get(l.source)!).push(l.target);
    (before.get(l.target) ?? before.set(l.target, []).get(l.target)!).push(l.source);
  }

  const sweep = (cols: number[][], towards: Map<number, number[]>, forward: boolean) => {
    const out = cols.map((c) => [...c]);
    const from = forward ? 1 : out.length - 2;
    const step = forward ? 1 : -1;
    for (let i = from; i >= 0 && i < out.length; i += step) {
      const neighbour = out[i - step];
      if (!neighbour) continue;
      const seat = new Map(neighbour.map((n, k) => [n, k]));
      const held = new Map(out[i].map((n, k) => [n, k]));
      const pull = (u: number) => {
        const seats = (towards.get(u) ?? [])
          .map((v) => seat.get(v))
          .filter((k): k is number => k !== undefined);
        return seats.length === 0
          ? held.get(u)!
          : seats.reduce((x, y) => x + y, 0) / seats.length;
      };
      out[i].sort((a, b) => pull(a) - pull(b) || held.get(a)! - held.get(b)!);
    }
    return out;
  };

  /*
   * Crossings weighed by width, with the plain count as the tie-break. Two
   * arrangements that tangle the same amount of ribbon are separated by which
   * one crosses fewer times, and only then by the order the caller gave.
   */
  const cost = (order: number[]): [number, number] => [
    weighedCrossings(graph, order),
    crossingsIn(graph, order),
  ];
  const better = (a: [number, number], b: [number, number]) =>
    a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

  const start = graph.nodes.map((_, i) => i);
  let best = group(start, at);
  let fewest = cost(best.flat());
  let cols = best;
  for (let pass = 0; pass < passes && fewest[0] > 0; pass++) {
    cols = sweep(cols, before, true);
    cols = sweep(cols, after, false);
    const n = cost(cols.flat());
    if (better(n, fewest)) {
      fewest = n;
      best = cols.map((c) => [...c]);
    }
  }

  /*
   * Then swap neighbours while it helps.
   *
   * Averaging heights settles a chart quickly and then stops: every node is
   * already at the middle of what it joins, and the two bands still crossing
   * would each have to move for either to improve, which no single average
   * will do. Trying each neighbouring pair in turn is what gets out of that —
   * it is slower, but a year's chart is tens of nodes, not thousands, and it
   * is the difference between "nearly untangled" and untangled.
   */
  let improved = true;
  for (let round = 0; improved && round < passes && fewest[0] > 0; round++) {
    improved = false;
    for (const col of best) {
      for (let i = 0; i + 1 < col.length; i++) {
        [col[i], col[i + 1]] = [col[i + 1], col[i]];
        const n = cost(best.flat());
        if (better(n, fewest)) {
          fewest = n;
          improved = true;
        } else {
          [col[i], col[i + 1]] = [col[i + 1], col[i]];
        }
      }
    }
  }
  return best.flat();
}

/** A node the layout invented to carry a band through a column. */
export interface FlowSpacer {
  /** The link it belongs to, by index in the graph it was built from. */
  link: number;
  /** The column it stands in. */
  column: number;
}

/**
 * A band is only worth a slot of its own if anybody can see it: below this
 * share of everything drawn it is a hairline, and a hairline passing behind a
 * bar is not something a reader watches happen.
 */
const WORTH_A_SLOT = 0.002;

/**
 * The graph as it has to be drawn, with the bands that skip a column routed
 * through slots of their own.
 *
 * A Sankey draws a band as a single curve from one bar to another, so a band
 * whose ends are three columns apart is drawn straight over whatever stands in
 * the two columns between — and a band crossing a bar reads as money that bar
 * gave off. The fix is to give it somewhere to pass: an invented node in every
 * column it crosses, drawn as the band itself rather than as a bar. The column
 * then has to part by the width of the band, which is exactly what was missing.
 *
 * Doing this for only the first column it crossed is what this used to do, and
 * it was enough while nothing skipped more than one — an account's closing
 * balance passing the spending bars. A record with named accounts, a pension
 * and sold holdings makes longer bands than that, and each of them went back
 * to being drawn over everything past the first column.
 */
export function layoutFlow<T>(
  nodes: readonly T[],
  links: readonly { source: number; target: number; value: number }[],
): {
  nodes: T[];
  links: { source: number; target: number; value: number }[];
  /** Indexes in the returned nodes that are slots, not bars. */
  ghosts: Set<number>;
  /** Which node each slot carries the colour and name of. */
  carries: Map<number, number>;
} {
  const at = columnsOf({ nodes: [...nodes], links: [...links] });
  const drawn = links.reduce((a, l) => a + l.value, 0);
  const worthASlot = drawn * WORTH_A_SLOT;

  const out: T[] = [...nodes];
  const ghosts = new Set<number>();
  const carries = new Map<number, number>();
  const drawLinks: { source: number; target: number; value: number }[] = [];

  for (const l of links) {
    const gap = at[l.target] - at[l.source];
    if (gap <= 1 || l.value < worthASlot) {
      drawLinks.push({ source: l.source, target: l.target, value: l.value });
      continue;
    }
    /*
     * One slot per column crossed, chained end to end. Each carries the name
     * and the role of where the band is going, so the pieces read as one band
     * and the tooltip still names the real destination.
     */
    let from = l.source;
    for (let c = at[l.source] + 1; c < at[l.target]; c++) {
      const slot = out.length;
      out.push(nodes[l.target]);
      ghosts.add(slot);
      carries.set(slot, l.target);
      drawLinks.push({ source: from, target: slot, value: l.value });
      from = slot;
    }
    drawLinks.push({ source: from, target: l.target, value: l.value });
  }

  const seated = seatColumns({ nodes: out, links: drawLinks });
  if (seated.length !== out.length) return { nodes: out, links: drawLinks, ghosts, carries };
  const moved = new Map(seated.map((old, next) => [old, next]));
  const at2 = (i: number) => moved.get(i) ?? i;
  return {
    nodes: seated.map((i) => out[i]),
    links: drawLinks.map((l) => ({
      source: at2(l.source),
      target: at2(l.target),
      value: l.value,
    })),
    ghosts: new Set([...ghosts].map(at2)),
    carries: new Map([...carries].map(([slot, end]) => [at2(slot), at2(end)])),
  };
}
