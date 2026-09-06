import { describe, expect, it } from "vitest";
import type { MapRoads } from "./mapTypes";
import { decodeRoadGraph, findPath, pathLength } from "./roadGraph";

// Square of four nodes (0..3) with a detour node 4 far away: 0-1-2-3-0 plus 1-4.
const roads: MapRoads = {
  nodes: [0, 0, 400, 0, 400, 400, 0, 400, 400, -4000],
  edges: [
    0, 1, 0, 0, 0, 400, 1, 2, 0, 0, 0, 400, 2, 3, 0, -1, 0, 400, 3, 0, 0, -1, 0,
    400, 1, 4, 1, -1, 1, 4000,
  ],
  classes: ["residential", "service"],
  names: ["Dorpsstraat"],
};

describe("decodeRoadGraph", () => {
  it("decodes nodes to metres and edges with adjacency", () => {
    const graph = decodeRoadGraph(roads);
    expect(graph.nodes).toHaveLength(5);
    expect(graph.nodes[1]).toEqual([100, 0]);
    expect(graph.edges[0]).toEqual({
      a: 0,
      b: 1,
      roadClass: "residential",
      name: "Dorpsstraat",
      oneway: false,
      length: 100,
    });
    expect(graph.edges[2].name).toBeUndefined();
    expect(graph.adjacency[1]).toEqual([0, 1, 4]);
  });

  it("rejects a malformed edge array", () => {
    expect(() =>
      decodeRoadGraph({ ...roads, edges: roads.edges.slice(0, 5) }),
    ).toThrow(/stride/);
    expect(() =>
      decodeRoadGraph({ ...roads, edges: [0, 9, 0, 0, 0, 1] }),
    ).toThrow(/node index/);
  });

  it("rejects an out-of-range nameIndex", () => {
    expect(() =>
      decodeRoadGraph({
        ...roads,
        edges: [0, 1, 0, 1, 0, 400],
        names: ["Dorpsstraat"],
      }),
    ).toThrow(/name index/);
  });

  it("rejects an odd-length node array", () => {
    expect(() =>
      decodeRoadGraph({ ...roads, nodes: roads.nodes.slice(0, -1) }),
    ).toThrow(/nodes/);
  });

  it("finds the nearest node within a distance limit", () => {
    const graph = decodeRoadGraph(roads);
    expect(graph.nearestNode([98, 3])).toBe(1);
    expect(graph.nearestNode([5000, 5000], 100)).toBeNull();
  });
});

describe("findPath", () => {
  it("returns the shortest node sequence and its length", () => {
    const graph = decodeRoadGraph(roads);
    const path = findPath(graph, 0, 2);
    expect(path).toEqual([0, 1, 2]);
    expect(pathLength(graph, path ?? [])).toBe(200);
  });

  it("returns a trivial path for the same node and null when unreachable", () => {
    const graph = decodeRoadGraph({ ...roads, edges: roads.edges.slice(0, 6) });
    expect(findPath(graph, 1, 1)).toEqual([1]);
    expect(findPath(graph, 0, 3)).toBeNull();
  });

  it("respects one-way edges when respectOneway is true", () => {
    const onewayRoads: MapRoads = {
      nodes: [0, 0, 100, 0],
      edges: [0, 1, 0, -1, 1, 100],
      classes: ["residential"],
      names: [],
    };
    const graph = decodeRoadGraph(onewayRoads);
    // Default: one-way edge can be traversed both ways
    expect(findPath(graph, 1, 0)).toEqual([1, 0]);
    expect(findPath(graph, 0, 1)).toEqual([0, 1]);
    // With respectOneway: 0→1 works, 1→0 fails
    expect(findPath(graph, 0, 1, { respectOneway: true })).toEqual([0, 1]);
    expect(findPath(graph, 1, 0, { respectOneway: true })).toBeNull();
  });

  it("finds a shortest lattice path with the heap open set", () => {
    const size = 20;
    const nodes: number[] = [];
    const edges: number[] = [];
    for (let row = 0; row < size; row++)
      for (let column = 0; column < size; column++) {
        nodes.push(column * 40, row * 40);
        const index = row * size + column;
        if (column + 1 < size) edges.push(index, index + 1, 0, -1, 0, 40);
        if (row + 1 < size) edges.push(index, index + size, 0, -1, 0, 40);
      }
    const lattice = decodeRoadGraph({
      nodes,
      edges,
      classes: ["residential"],
      names: [],
    });
    const path = findPath(lattice, 0, size * size - 1);
    expect(path).toHaveLength(2 * size - 1);
    expect(path?.[0]).toBe(0);
    expect(path?.at(-1)).toBe(size * size - 1);
    expect(pathLength(lattice, path ?? [])).toBe(380);
  });

  it("skips edges rejected by allowEdge", () => {
    const graph = decodeRoadGraph(roads);
    expect(findPath(graph, 0, 4)).toEqual([0, 1, 4]);
    expect(
      findPath(graph, 0, 4, {
        allowEdge: (edge) => edge.roadClass !== "service",
      }),
    ).toBeNull();
  });

  it("prefers three short hops over one long declared edge", () => {
    const detour = decodeRoadGraph({
      nodes: [0, 0, 200, 0, 400, 0, 600, 0],
      edges: [
        0, 1, 0, -1, 0, 200, 1, 2, 0, -1, 0, 200, 2, 3, 0, -1, 0, 200, 0, 2, 0,
        -1, 0, 1200,
      ],
      classes: ["residential"],
      names: [],
    });
    const path = findPath(detour, 0, 3);
    expect(path).toEqual([0, 1, 2, 3]);
  });
});

describe("pathLength", () => {
  it("returns 0 for paths shorter than two nodes", () => {
    const graph = decodeRoadGraph(roads);
    expect(pathLength(graph, [])).toBe(0);
    expect(pathLength(graph, [1])).toBe(0);
  });

  it("uses shortest edge when multiple parallel edges exist", () => {
    const parallelRoads: MapRoads = {
      nodes: [0, 0, 100, 0],
      edges: [0, 1, 0, -1, 0, 100, 0, 1, 0, -1, 0, 50],
      classes: ["residential"],
      names: [],
    };
    const graph = decodeRoadGraph(parallelRoads);
    const path = [0, 1];
    // Should use the shortest edge (50 units = 50/4 meters = 12.5m)
    expect(pathLength(graph, path)).toBe(12.5);
  });
});
