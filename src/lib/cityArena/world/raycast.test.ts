import { describe, expect, it } from "vitest";
import { boundsOf } from "../mapBuild/geometry";
import { createCollisionGrid } from "./collisionGrid";
import type { DecodedTile } from "./decode";
import type { Point } from "./projection";
import { firstBuildingHit, firstRingHit, segmentIntersection } from "./raycast";

const square: Point[] = [
  [10, -5],
  [20, -5],
  [20, 5],
  [10, 5],
];
const pond: Point[] = [
  [0, 95],
  [30, 95],
  [30, 105],
];

function tileWith(buildings: Point[][], water: Point[][] = []): DecodedTile {
  return {
    x: 0,
    y: 0,
    rect: { minX: -100, minY: -100, maxX: 1900, maxY: 1900 },
    roads: [],
    buildings: buildings.map((ring) => ({
      ring,
      bounds: boundsOf(ring),
      levels: 2,
    })),
    ground: [],
    water: water.map((ring) => ({ ring, bounds: boundsOf(ring) })),
  };
}

describe("raycast", () => {
  it("intersects crossing segments and rejects parallel or disjoint ones", () => {
    expect(segmentIntersection([0, 0], [10, 0], [5, -5], [5, 5])).toEqual([
      5, 0,
    ]);
    expect(segmentIntersection([0, 0], [10, 0], [0, 1], [10, 1])).toBeNull();
    expect(segmentIntersection([0, 0], [10, 0], [15, -5], [15, 5])).toBeNull();
  });

  it("returns the ring crossing nearest to the start", () => {
    expect(firstRingHit([0, 0], [30, 0], square)).toEqual([10, 0]);
    expect(firstRingHit([30, 0], [0, 0], square)).toEqual([20, 0]);
    expect(firstRingHit([0, 10], [30, 10], square)).toBeNull();
  });

  it("finds the first building through the collision grid and lets bullets cross water", () => {
    const grid = createCollisionGrid();
    grid.insertTile(tileWith([square], [pond]));
    expect(firstBuildingHit(grid, [0, 0], [30, 0])).toEqual([10, 0]);
    expect(firstBuildingHit(grid, [0, 100], [30, 100])).toBeNull();
  });
});
