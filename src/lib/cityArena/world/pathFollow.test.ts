import { describe, expect, it } from "vitest";
import { moveToward, nextWaypoint, pathTo } from "./pathFollow";
import { decodeRoadGraph } from "./roadGraph";

const graph = decodeRoadGraph({
  nodes: [0, 0, 400, 0, 400, 400, 0, 400],
  edges: [
    0, 1, 0, -1, 0, 400, 1, 2, 0, -1, 0, 400, 2, 3, 0, -1, 0, 400, 3, 0, 0, -1,
    0, 400,
  ],
  classes: ["residential"],
  names: [],
});

describe("pathFollow", () => {
  it("drops reached nodes and targets the next one", () => {
    expect(nextWaypoint(graph, [0, 1, 2], [1, 0], 2)).toEqual({
      path: [1, 2],
      target: [100, 0],
    });
    expect(nextWaypoint(graph, [0], [0, 0], 2)).toEqual({
      path: [],
      target: null,
    });
    expect(nextWaypoint(graph, [], [0, 0], 2)).toEqual({
      path: [],
      target: null,
    });
  });

  it("routes between the nodes nearest two points", () => {
    const path = pathTo(graph, [1, 1], [99, 101], 60);
    expect(path).toHaveLength(3);
    expect(path?.[0]).toBe(0);
    expect(path?.at(-1)).toBe(2);
    expect(pathTo(graph, [500, 500], [0, 0], 60)).toBeNull();
  });

  it("steps toward a target without overshooting", () => {
    expect(moveToward([0, 0], [10, 0], 3)).toEqual([3, 0]);
    expect(moveToward([0, 0], [1, 0], 3)).toEqual([1, 0]);
    expect(moveToward([4, 4], [4, 4], 3)).toEqual([4, 4]);
  });
});
