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
  links: { source: number; target: number }[];
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

  const start = graph.nodes.map((_, i) => i);
  let best = group(start, at);
  let fewest = crossingsIn(graph, best.flat());
  let cols = best;
  for (let pass = 0; pass < passes && fewest > 0; pass++) {
    cols = sweep(cols, before, true);
    cols = sweep(cols, after, false);
    const n = crossingsIn(graph, cols.flat());
    if (n < fewest) {
      fewest = n;
      best = cols.map((c) => [...c]);
    }
  }
  return best.flat();
}
