import { describe, expect, it } from "vitest";
import type { Point } from "./projection";
import type { RoadGraph } from "./roadGraph";
import {
  CORRIDOR_CELL_M,
  CORRIDOR_MARGIN_M,
  createRoadCorridors,
} from "./roadCorridor";

/** Two roads: a 6 m residential bar east along y = 0 and a 9 m primary bar south along x = 200. */
function graphFixture(): Pick<RoadGraph, "nodes" | "edges"> {
  const nodes: Point[] = [
    [0, 0],
    [100, 0],
    [200, 0],
    [200, 400],
  ];
  return {
    nodes,
    edges: [
      { a: 0, b: 1, roadClass: "residential", oneway: false, length: 100 },
      { a: 1, b: 2, roadClass: "residential", oneway: false, length: 100 },
      { a: 2, b: 3, roadClass: "primary", oneway: false, length: 400 },
    ],
  };
}

describe("createRoadCorridors", () => {
  it("matches the collision grid's cell size and the pavement margin", () => {
    expect(CORRIDOR_CELL_M).toBe(16);
    expect(CORRIDOR_MARGIN_M).toBe(2);
  });

  it("covers the carriageway plus its pavements and nothing beyond", () => {
    const corridors = createRoadCorridors(graphFixture());
    expect(corridors.corridorCount()).toBe(3);
    // residential: 6 m wide → half-width 3 m + 2 m margin = 5 m for a point radius of 0.
    expect(corridors.isOnRoad([50, 0], 0)).toBe(true);
    expect(corridors.isOnRoad([50, 4.9], 0)).toBe(true);
    expect(corridors.isOnRoad([50, 5.1], 0)).toBe(false);
    // primary: 9 m wide → half-width 4.5 m + 2 m margin = 6.5 m.
    expect(corridors.isOnRoad([206.4, 200], 0)).toBe(true);
    expect(corridors.isOnRoad([206.6, 200], 0)).toBe(false);
  });

  it("adds the query radius to the corridor half-width", () => {
    const corridors = createRoadCorridors(graphFixture());
    // 5 m half-width + 0.95 m car hull radius = 5.95 m of reach.
    expect(corridors.isOnRoad([50, 5.9], 0.95)).toBe(true);
    expect(corridors.isOnRoad([50, 6.0], 0.95)).toBe(false);
  });

  it("finds corridors bucketed in a neighbouring cell", () => {
    const corridors = createRoadCorridors(graphFixture());
    // y = 5.4 sits in cell row 0 while the segment's own centre line is on the row
    // boundary; the query box must still reach it. 5 m + 0.5 m radius = 5.5 m.
    expect(corridors.isOnRoad([CORRIDOR_CELL_M * 3 + 1, 5.4], 0.5)).toBe(true);
    expect(corridors.isOnRoad([CORRIDOR_CELL_M * 3 + 1, 5.6], 0.5)).toBe(false);
  });

  it("reports no road far from every segment and off the ends", () => {
    const corridors = createRoadCorridors(graphFixture());
    expect(corridors.isOnRoad([50, 40], 0.4)).toBe(false);
    expect(corridors.isOnRoad([-20, 0], 0.4)).toBe(false);
    expect(corridors.isOnRoad([2000, 2000], 0.4)).toBe(false);
  });

  it("skips edges whose endpoints are missing and still indexes the rest", () => {
    const broken: Pick<RoadGraph, "nodes" | "edges"> = {
      nodes: [
        [0, 0],
        [100, 0],
      ],
      edges: [
        { a: 0, b: 1, roadClass: "residential", oneway: false, length: 100 },
        { a: 0, b: 9, roadClass: "residential", oneway: false, length: 100 },
      ],
    };
    const corridors = createRoadCorridors(broken);
    expect(corridors.corridorCount()).toBe(1);
    expect(corridors.isOnRoad([50, 0], 0)).toBe(true);
  });

  it("returns false for an empty graph", () => {
    const corridors = createRoadCorridors({ nodes: [], edges: [] });
    expect(corridors.corridorCount()).toBe(0);
    expect(corridors.isOnRoad([0, 0], 1)).toBe(false);
  });
});
