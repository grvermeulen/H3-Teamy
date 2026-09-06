import { describe, expect, it } from "vitest";
import type { Point } from "./projection";
import type { DecodedTile } from "./decode";
import {
  createCollisionGrid,
  nearestPointOnRing,
  nearestPointOnSegment,
  pushCircleOutOfRing,
} from "./collisionGrid";
import { HULL_CIRCLE_OFFSET_M, HULL_CIRCLE_RADIUS_M } from "../sim/vehicle";
import { createRoadCorridors } from "./roadCorridor";
import type { RoadGraph } from "./roadGraph";

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

  it("indexes and resolves obstacles across negative cell boundaries", () => {
    const negativeSquare: Point[] = [
      [-40, -40],
      [-30, -40],
      [-30, -30],
      [-40, -30],
    ];
    const grid = createCollisionGrid();
    grid.insertTile(tileWith([negativeSquare], [], -1, -1));
    expect(
      grid
        .query({ minX: -50, minY: -50, maxX: -25, maxY: -25 })
        .map((o) => o.kind),
    ).toEqual(["building"]);
    const pushed = grid.resolveCircle([-29.8, -35], 0.4);
    expect(pushed[0]).toBeCloseTo(-29.6);
    expect(pushed[1]).toBeCloseTo(-35);
  });

  it("safely no-ops removing a tile that was never inserted, twice, leaving other tiles intact", () => {
    const grid = createCollisionGrid();
    grid.insertTile(tileWith([square]));
    expect(() => grid.removeTile(9, 9)).not.toThrow();
    grid.removeTile(9, 9);
    expect(grid.obstacleCount()).toBe(1);
    expect(
      grid.query({ minX: 0, minY: 0, maxX: 30, maxY: 30 }).map((o) => o.kind),
    ).toEqual(["building"]);
  });

  it("keeps insertTile idempotent when the same tile is inserted twice", () => {
    const grid = createCollisionGrid();
    grid.insertTile(tileWith([square]));
    grid.insertTile(tileWith([square]));
    expect(grid.obstacleCount()).toBe(1);
    expect(
      grid.query({ minX: 0, minY: 0, maxX: 30, maxY: 30 }).map((o) => o.kind),
    ).toEqual(["building"]);
  });

  it.each([0, -1, NaN, Infinity])(
    "throws a descriptive error for cellMetres = %s",
    (invalidCellMetres) => {
      expect(() => createCollisionGrid(invalidCellMetres)).toThrow(
        /cellMetres/,
      );
    },
  );
});

/** A river band y ∈ [−6, 6] spanning x ∈ [−100, 100]. */
const RIVER: Point[] = [
  [-100, -6],
  [100, -6],
  [100, 6],
  [-100, 6],
];

/** A hut inside the bridge's corridor, to prove buildings are never exempted. */
const HUT: Point[] = [
  [2, -30],
  [4, -30],
  [4, -28],
  [2, -28],
];

/**
 * A residential bridge running north–south along x = 0 across the river, and a residential quay
 * along y = 9 whose southern kerb (9 − 3 = 6) sits exactly on the north bank.
 */
function bridgeGraph(): Pick<RoadGraph, "nodes" | "edges"> {
  return {
    nodes: [
      [0, -40],
      [0, 40],
      [20, 9],
      [90, 9],
    ],
    edges: [
      { a: 0, b: 1, roadClass: "residential", oneway: false, length: 80 },
      { a: 2, b: 3, roadClass: "residential", oneway: false, length: 70 },
    ],
  };
}

describe("collision grid road corridors", () => {
  it("still blocks water on a bridge when no corridors are installed", () => {
    const grid = createCollisionGrid();
    grid.insertTile(tileWith([], [RIVER]));
    const pushed = grid.resolveCircle([0, 2], 0.4);
    expect(pushed[0]).toBeCloseTo(0);
    expect(pushed[1]).toBeCloseTo(6.4);
  });

  it("lets a walker cross the bridge and pushes them out beside it", () => {
    const grid = createCollisionGrid();
    grid.setRoadCorridors(createRoadCorridors(bridgeGraph()));
    grid.insertTile(tileWith([], [RIVER]));
    expect(grid.resolveCircle([0, 2], 0.4)).toEqual([0, 2]);
    const beside = grid.resolveCircle([5.6, 2], 0.4);
    expect(beside[0]).toBeCloseTo(5.6);
    expect(beside[1]).toBeCloseTo(6.4);
  });

  it("carries both car hull circles across and stops the one that leaves the deck", () => {
    const grid = createCollisionGrid();
    grid.setRoadCorridors(createRoadCorridors(bridgeGraph()));
    grid.insertTile(tileWith([], [RIVER]));
    // Heading south: both circles sit on the centre line.
    for (const offset of [HULL_CIRCLE_OFFSET_M, -HULL_CIRCLE_OFFSET_M]) {
      expect(grid.resolveCircle([0, offset], HULL_CIRCLE_RADIUS_M)).toEqual([
        0,
        offset,
      ]);
    }
    // Heading east, centred 6.5 m off the deck: the rear circle is still on it.
    expect(grid.resolveCircle([5.4, 2], HULL_CIRCLE_RADIUS_M)).toEqual([
      5.4, 2,
    ]);
    const front = grid.resolveCircle([7.6, 2], HULL_CIRCLE_RADIUS_M);
    expect(front[0]).toBeCloseTo(7.6);
    expect(front[1]).toBeCloseTo(6.95);
  });

  it("still pushes a swimmer out of open water away from every road", () => {
    const grid = createCollisionGrid();
    grid.setRoadCorridors(createRoadCorridors(bridgeGraph()));
    grid.insertTile(tileWith([], [RIVER]));
    const pushed = grid.resolveCircle([-60, 2], 0.4);
    expect(pushed[0]).toBeCloseTo(-60);
    expect(pushed[1]).toBeCloseTo(6.4);
  });

  it("lets a quay road reach two metres into the water and no further", () => {
    const grid = createCollisionGrid();
    grid.setRoadCorridors(createRoadCorridors(bridgeGraph()));
    grid.insertTile(tileWith([], [RIVER]));
    expect(grid.resolveCircle([60, 5], 0.4)).toEqual([60, 5]);
    const pushed = grid.resolveCircle([60, 3.5], 0.4);
    expect(pushed[0]).toBeCloseTo(60);
    expect(pushed[1]).toBeCloseTo(6.4);
  });

  it("keeps buildings solid inside a road corridor", () => {
    const grid = createCollisionGrid();
    grid.setRoadCorridors(createRoadCorridors(bridgeGraph()));
    grid.insertTile(tileWith([HUT], [RIVER]));
    const pushed = grid.resolveCircle([1.8, -29], 0.4);
    expect(pushed[0]).toBeCloseTo(1.6);
    expect(pushed[1]).toBeCloseTo(-29);
  });
});
