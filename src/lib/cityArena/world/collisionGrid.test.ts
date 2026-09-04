import { describe, expect, it } from "vitest";
import type { Point } from "./projection";
import type { DecodedTile } from "./decode";
import {
  createCollisionGrid,
  nearestPointOnRing,
  nearestPointOnSegment,
  pushCircleOutOfRing,
} from "./collisionGrid";

const square: Point[] = [
  [10, 10],
  [20, 10],
  [20, 20],
  [10, 20],
];

function tileWith(
  buildings: Point[][],
  water: Point[][] = [],
  x = 0,
  y = 0,
): DecodedTile {
  const bounds = (ring: Point[]) => ({
    minX: Math.min(...ring.map((p) => p[0])),
    minY: Math.min(...ring.map((p) => p[1])),
    maxX: Math.max(...ring.map((p) => p[0])),
    maxY: Math.max(...ring.map((p) => p[1])),
  });
  return {
    x,
    y,
    rect: { minX: 0, minY: 0, maxX: 2000, maxY: 2000 },
    roads: [],
    buildings: buildings.map((ring) => ({
      ring,
      bounds: bounds(ring),
      levels: 2,
    })),
    ground: [],
    water: water.map((ring) => ({ ring, bounds: bounds(ring) })),
  };
}

describe("nearest point helpers", () => {
  it("projects onto a segment and clamps to its ends", () => {
    expect(nearestPointOnSegment([5, 5], [0, 0], [10, 0])).toEqual([5, 0]);
    expect(nearestPointOnSegment([-3, 5], [0, 0], [10, 0])).toEqual([0, 0]);
  });

  it("finds the nearest boundary point of a ring", () => {
    const result = nearestPointOnRing([25, 15], square);
    expect(result.point).toEqual([20, 15]);
    expect(result.distance).toBe(5);
  });
});

describe("pushCircleOutOfRing", () => {
  it("returns null when the circle does not touch the ring", () => {
    expect(pushCircleOutOfRing([30, 15], 0.4, square)).toBeNull();
  });

  it("pushes a circle overlapping an edge outward", () => {
    const moved = pushCircleOutOfRing([20.2, 15], 0.4, square);
    expect(moved?.[0]).toBeCloseTo(20.4);
    expect(moved?.[1]).toBeCloseTo(15);
  });

  it("ejects a circle whose centre is inside through the nearest edge", () => {
    const moved = pushCircleOutOfRing([19.8, 15], 0.4, square);
    expect(moved?.[0]).toBeCloseTo(20.4);
    expect(moved?.[1]).toBeCloseTo(15);
  });
});

describe("createCollisionGrid", () => {
  it("indexes obstacles by cell and queries by rectangle", () => {
    const grid = createCollisionGrid();
    grid.insertTile(
      tileWith(
        [square],
        [
          [
            [100, 100],
            [110, 100],
            [110, 110],
          ],
        ],
      ),
    );
    expect(grid.obstacleCount()).toBe(2);
    expect(
      grid.query({ minX: 0, minY: 0, maxX: 30, maxY: 30 }).map((o) => o.kind),
    ).toEqual(["building"]);
    expect(
      grid
        .query({ minX: 95, minY: 95, maxX: 120, maxY: 120 })
        .map((o) => o.kind),
    ).toEqual(["water"]);
    expect(grid.query({ minX: 500, minY: 500, maxX: 510, maxY: 510 })).toEqual(
      [],
    );
  });

  it("resolves a walking circle against buildings and water, and forgets removed tiles", () => {
    const grid = createCollisionGrid();
    grid.insertTile(tileWith([square]));
    expect(grid.resolveCircle([50, 50], 0.4)).toEqual([50, 50]);
    const pushed = grid.resolveCircle([20.1, 15], 0.4);
    expect(pushed[0]).toBeCloseTo(20.4);
    grid.removeTile(0, 0);
    expect(grid.resolveCircle([20.1, 15], 0.4)).toEqual([20.1, 15]);
  });

  it("does not list the same obstacle twice when it spans several cells", () => {
    const grid = createCollisionGrid(4);
    grid.insertTile(tileWith([square]));
    expect(grid.query({ minX: 8, minY: 8, maxX: 22, maxY: 22 })).toHaveLength(
      1,
    );
  });
});
