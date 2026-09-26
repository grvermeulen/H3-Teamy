import { describe, expect, it } from "vitest";
import { withoutStructures } from "./collisionView";
import { createCollisionGrid, type CollisionGrid } from "./collisionGrid";
import type { DecodedTile } from "./decode";
import type { Point } from "./projection";
import { structureIdOf } from "./structureId";

/** A 10x10 m building at the origin, tagged as the tile's first structure. */
const square: Point[] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

function tileWith(buildings: Point[][]): DecodedTile {
  const bounds = (ring: Point[]) => ({
    minX: Math.min(...ring.map((p) => p[0])),
    minY: Math.min(...ring.map((p) => p[1])),
    maxX: Math.max(...ring.map((p) => p[0])),
    maxY: Math.max(...ring.map((p) => p[1])),
  });
  return {
    x: 0,
    y: 0,
    rect: { minX: 0, minY: 0, maxX: 2000, maxY: 2000 },
    trees: [],
    furniture: [],
    roads: [],
    buildings: buildings.map((ring, index) => ({
      structureId: structureIdOf(0, 0, index),
      ring,
      bounds: bounds(ring),
      levels: 2,
    })),
    ground: [],
    water: [],
  };
}

describe("withoutStructures", () => {
  it("returns the grid itself when nothing is destroyed", () => {
    const grid = createCollisionGrid();
    expect(withoutStructures(grid, new Set())).toBe(grid);
  });

  it("hides a destroyed building from queries and lets a circle pass through it", () => {
    const grid = createCollisionGrid();
    grid.insertTile(tileWith([square]));
    const id = structureIdOf(0, 0, 0);
    const view = withoutStructures(grid, new Set([id]));

    expect(view.query({ minX: 0, minY: 0, maxX: 10, maxY: 10 })).toEqual([]);
    expect(view.resolveCircle([5, 5], 0.4)).toEqual([5, 5]);

    // The raw grid still treats the building as solid.
    const pushedByRawGrid = grid.resolveCircle([5, 5], 0.4);
    expect(pushedByRawGrid).not.toEqual([5, 5]);
  });

  it("passes resolveCircle through unchanged when the collision lacks resolveCircleSkipping", () => {
    const fake: Pick<CollisionGrid, "query" | "resolveCircle"> = {
      query: () => [],
      resolveCircle: (centre) => centre,
    };
    const view = withoutStructures(fake, new Set([structureIdOf(0, 0, 0)]));
    expect(view.resolveCircle([5, 5], 0.4)).toEqual([5, 5]);
  });
});
