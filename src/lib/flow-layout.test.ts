import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { columnsOf, crossingsIn, seatColumns } from "./flow-layout";

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
     * Otherwise what the reader sees as the end of the chart is not the end of
     * the chart, and a ribbon reaching it looks like it skips a column.
     */
    const at = columnsOf(graph(4, [[0, 1], [1, 2], [2, 3], [0, 3]]));
    assert.equal(at[3], 3, "reached in one hop, but drawn where it is drawn");
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

  test("a band that skips the column between its ends", () => {
    const g = graph(5, [[0, 1], [1, 2], [2, 3], [1, 4]]);
    assert.equal(seated(g), 0);
  });
});
