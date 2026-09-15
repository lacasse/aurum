import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { columnsOf, crossingsIn, layoutFlow, seatColumns } from "./flow-layout";

/* ALL-FIXTURES-INVENTED */

const graph = (nodes: number, edges: [number, number][]) => ({
  nodes: Array.from({ length: nodes }, (_, i) => ({ name: `n${i}` })),
  links: edges.map(([source, target]) => ({ source, target })),
});
const seated = (g: ReturnType<typeof graph>) => crossingsIn(g, seatColumns(g));

describe("which column a node stands in", () => {
  test("the longest path from a source, not the shortest", () => {
    // 0 reaches 2 directly and also through 1, so 2 stands past both.
    const at = columnsOf(graph(3, [[0, 1], [1, 2], [0, 2]]));
    assert.deepEqual(at, [0, 1, 2]);
  });

  test("a node with nothing leaving it is drawn at the far edge", () => {
    /*
     * The endings line up, so what looks like the end of the chart is the end
     * of it. The band that then has to cross the columns between is given a
     * slot in each of them, and the ordering keeps it clear of anything wide.
     */
    const at = columnsOf(graph(5, [[0, 1], [1, 2], [2, 3], [1, 4]]));
    assert.equal(at[4], 3, "one hop from the second column, drawn at the end");
    assert.equal(at[3], 3);
  });
});

describe("counting the ribbons that cross", () => {
  test("ends in the same order cross nothing", () => {
    assert.equal(crossingsIn(graph(4, [[0, 2], [1, 3]])), 0);
  });

  test("ends in the opposite order cross once", () => {
    assert.equal(crossingsIn(graph(4, [[0, 3], [1, 2]])), 1);
  });

  test("every pair counts, so a full reversal is every pair", () => {
    // Three ribbons reversed: three pairs, all crossing.
    assert.equal(crossingsIn(graph(6, [[0, 5], [1, 4], [2, 3]])), 3);
  });
});

describe("seating the columns", () => {
  test("an order that crosses is straightened out", () => {
    const g = graph(4, [[0, 3], [1, 2]]);
    assert.equal(crossingsIn(g), 1, "as given");
    assert.equal(seated(g), 0, "as seated");
  });

  test("a wholly reversed column is reversed back", () => {
    const g = graph(6, [[0, 5], [1, 4], [2, 3]]);
    assert.equal(crossingsIn(g), 3);
    assert.equal(seated(g), 0);
  });

  test("it holds an order that was already right", () => {
    /*
     * The order the caller gave is the tie-break, so a chart nobody has
     * complained about does not get rearranged for nothing.
     */
    const g = graph(4, [[0, 2], [1, 3]]);
    assert.deepEqual(seatColumns(g), [0, 1, 2, 3]);
  });

  test("every node is returned exactly once", () => {
    const g = graph(6, [[0, 3], [1, 4], [2, 5], [0, 4]]);
    const order = seatColumns(g);
    assert.deepEqual([...order].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5]);
  });

  test("a node nothing points at keeps its place rather than drifting", () => {
    const g = graph(4, [[0, 2], [1, 2]]);
    assert.equal(seated(g), 0);
    assert.equal(seatColumns(g).length, 4, "the unattached node is still there");
  });

  test("three columns are settled against each other, not just in pairs", () => {
    const g = graph(6, [[0, 3], [1, 2], [2, 5], [3, 4]]);
    assert.ok(seated(g) <= crossingsIn(g));
    assert.equal(seated(g), 0);
  });
});

/*
 * The shapes a real year makes. Each of these crossed before the ordering was
 * done this way, and each was fixed once by a rule that the next shape undid.
 */
describe("the shapes that kept coming back", () => {
  test("a source that pays into two different bars", () => {
    // Income landing in cash and in a plan, which has to cross what stands between.
    const g = graph(5, [[0, 2], [1, 2], [0, 3], [2, 3], [3, 4]]);
    assert.equal(seated(g), 0);
  });

  test("several accounts, one of them holding what was left over", () => {
    const g = graph(8, [
      [0, 4], [1, 5], [1, 6], [1, 7], [4, 2], [5, 2], [6, 2], [7, 2], [4, 3],
    ]);
    assert.equal(seated(g), 0);
  });

  test("a tangle that needs two columns to move at once", () => {
    /*
     * A band into a reserved slot crossing the band into the bar beside it.
     * Swapping the pair in either column alone leaves the crossing exactly
     * where it was, so a search that only takes improvements stops one step
     * short: the first move has to be free before the second can be good.
     */
    const g = {
      nodes: Array.from({ length: 8 }, (_, i) => ({ name: `n${i}` })),
      links: [
        { source: 0, target: 3, value: 21 },
        { source: 0, target: 5, value: 11 },
        { source: 1, target: 4, value: 19 },
        { source: 2, target: 5, value: 93 },
        { source: 3, target: 6, value: 21 },
        { source: 4, target: 6, value: 19 },
        { source: 5, target: 7, value: 104 },
      ],
    };
    assert.equal(crossingsIn(g), 1, "as given");
    assert.equal(crossingsIn(g, seatColumns(g)), 0, "as seated");
  });

  test("a band that skips the column between its ends", () => {
    const g = graph(5, [[0, 1], [1, 2], [2, 3], [1, 4]]);
    assert.equal(seated(g), 0);
  });
});

/*
 * Slots: the invented nodes that carry a band through a column it would
 * otherwise be drawn straight across.
 */
describe("routing a band through the columns it crosses", () => {
  const weighted = (
    nodes: number,
    edges: [number, number, number][],
  ) => ({
    nodes: Array.from({ length: nodes }, (_, i) => ({ name: `n${i}` })),
    links: edges.map(([source, target, value]) => ({ source, target, value })),
  });
  const spans = (g: { nodes: unknown[]; links: { source: number; target: number }[] }) => {
    const at = columnsOf(g);
    return [...new Set(g.links.map((l) => at[l.target] - at[l.source]))].sort();
  };

  test("a band that skips one column gets a slot in it", () => {
    // 0 → 1 → 2 → 3, and 1 → 3 straight over 2.
    const g = weighted(4, [[0, 1, 100], [1, 2, 60], [2, 3, 60], [1, 3, 40]]);
    const out = layoutFlow(g.nodes, g.links);
    assert.equal(out.ghosts.size, 1);
    assert.deepEqual(spans(out), [1], "nothing is drawn across a column any more");
  });

  test("a band that skips two columns gets a slot in each of them", () => {
    /*
     * One slot was enough while the chart had a single middle column. A record
     * with named accounts, a pension and holdings sold makes longer bands than
     * that, and every column past the first went back to being drawn over.
     */
    const g = weighted(5, [
      [0, 1, 100], [1, 2, 50], [2, 3, 50], [3, 4, 50], [1, 4, 50],
    ]);
    const out = layoutFlow(g.nodes, g.links);
    assert.equal(out.ghosts.size, 2, "one for each column crossed");
    assert.deepEqual(spans(out), [1]);
  });

  test("the slots carry the colour and name of where the band ends", () => {
    const g = weighted(5, [
      [0, 1, 100], [1, 2, 50], [2, 3, 50], [3, 4, 50], [1, 4, 50],
    ]);
    const out = layoutFlow(g.nodes, g.links);
    for (const [slot, end] of out.carries) {
      assert.equal(out.nodes[slot].name, out.nodes[end].name);
      assert.ok(out.ghosts.has(slot));
    }
  });

  test("a hairline passes behind rather than parting a column", () => {
    /*
     * A slot costs the column the width of the band. Below a five-hundredth of
     * the chart there is no band to see, so the column stays closed up.
     */
    const g = weighted(4, [[0, 1, 100000], [1, 2, 99999], [2, 3, 99999], [1, 3, 1]]);
    const out = layoutFlow(g.nodes, g.links);
    assert.equal(out.ghosts.size, 0);
  });

  test("every band still carries its own value, and none is lost", () => {
    const g = weighted(5, [
      [0, 1, 100], [1, 2, 50], [2, 3, 50], [3, 4, 50], [1, 4, 50],
    ]);
    const out = layoutFlow(g.nodes, g.links);
    const into = (n: number) =>
      out.links.filter((l) => l.target === n).reduce((a, l) => a + l.value, 0);
    const end = out.nodes.findIndex((n, i) => n.name === "n4" && !out.ghosts.has(i));
    // The band routed through the slots, and the one that arrives the short way.
    assert.equal(into(end), 100);
    for (const slot of out.ghosts) assert.equal(into(slot), 50, "a slot carries one band");
  });
});

describe("which crossings matter", () => {
  test("two wide bands are untangled ahead of four hairlines", () => {
    /*
     * Counted as pairs, the arrangement that tidies away the hairlines wins.
     * It is the wrong answer: nobody sees a hairline cross, and everybody sees
     * the two widest bands on the chart cross each other.
     */
    const g = {
      nodes: Array.from({ length: 8 }, (_, i) => ({ name: `n${i}` })),
      links: [
        { source: 0, target: 5, value: 500 },
        { source: 1, target: 4, value: 500 },
        { source: 2, target: 6, value: 1 },
        { source: 2, target: 7, value: 1 },
        { source: 3, target: 6, value: 1 },
        { source: 3, target: 7, value: 1 },
      ],
    };
    const order = seatColumns(g);
    const at = columnsOf(g);
    const seat = new Map(order.map((n, k) => [n, k]));
    const rank = (n: number) => seat.get(n)!;
    assert.equal(at[0], 0);
    // The two wide bands end in the same order they start.
    assert.ok(
      rank(0) < rank(1) === rank(5) < rank(4),
      "the wide pair does not cross",
    );
  });
});
