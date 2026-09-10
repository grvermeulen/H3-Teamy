import { describe, expect, it } from "vitest";
import type { Point } from "../world/projection";
import {
  FOREST_TREE_AREA_M2,
  LARGE_TREE_SHARE,
  MIN_TREE_GAP_M,
  PARK_TREE_AREA_M2,
  SCRUB_TREE_AREA_M2,
  cellNoise,
  scatterTrees,
  thinTrees,
  treeBedFor,
  treeRow,
  treeSizeAt,
  type ProjectedTree,
} from "./vegetation";
import { pointInPolygon } from "./geometry";

/** A square of `side` metres with its corner at (x, y). */
function square(x: number, y: number, side: number): Point[] {
  return [
    [x, y],
    [x + side, y],
    [x + side, y + side],
    [x, y + side],
  ];
}

/** The smallest distance between any two of the trees. */
function closestPair(trees: ProjectedTree[]): number {
  let closest = Infinity;
  for (let a = 0; a < trees.length; a++)
    for (let b = a + 1; b < trees.length; b++)
      closest = Math.min(
        closest,
        Math.hypot(
          trees[a].point[0] - trees[b].point[0],
          trees[a].point[1] - trees[b].point[1],
        ),
      );
  return closest;
}

describe("treeBedFor", () => {
  it("grows forests densely, scrub small and sparse, parks sparse, and fields not at all", () => {
    expect(treeBedFor({ landuse: "forest" })).toEqual({
      areaPerTreeM2: FOREST_TREE_AREA_M2,
      largeShare: LARGE_TREE_SHARE,
    });
    expect(treeBedFor({ natural: "wood" })?.areaPerTreeM2).toBe(
      FOREST_TREE_AREA_M2,
    );
    expect(treeBedFor({ natural: "scrub" })).toEqual({
      areaPerTreeM2: SCRUB_TREE_AREA_M2,
      largeShare: 0,
    });
    expect(treeBedFor({ leisure: "park" })?.areaPerTreeM2).toBe(
      PARK_TREE_AREA_M2,
    );
    expect(treeBedFor({ landuse: "farmland" })).toBeNull();
    expect(treeBedFor({ landuse: "grass" })).toBeNull();
    expect(treeBedFor({ leisure: "pitch" })).toBeNull();
  });
});

describe("cellNoise and treeSizeAt", () => {
  it("is stable, in [0, 1), and differs by cell and salt", () => {
    expect(cellNoise(3, 4, 1)).toBe(cellNoise(3, 4, 1));
    expect(cellNoise(3, 4, 1)).not.toBe(cellNoise(3, 4, 2));
    expect(cellNoise(3, 4, 1)).not.toBe(cellNoise(4, 3, 1));
    for (let x = -50; x < 50; x++) {
      const value = cellNoise(x, -x, 1);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    expect(treeSizeAt([12.4, -7.6], 0)).toBe(0);
    expect(treeSizeAt([12.4, -7.6], 1)).toBe(1);
    expect(treeSizeAt([12.4, -7.6], 0.5)).toBe(treeSizeAt([12.4, -7.6], 0.5));
  });
});

describe("scatterTrees", () => {
  const forest = { areaPerTreeM2: FOREST_TREE_AREA_M2, largeShare: 0.5 };

  it("puts about one tree per bed area inside the polygon, none closer than the gap, deterministically", () => {
    const ring = square(100, 100, 100);
    const trees = scatterTrees(ring, forest);
    expect(trees.length).toBeGreaterThan(95);
    expect(trees.length).toBeLessThan(135);
    expect(trees.every((tree) => pointInPolygon(tree.point, ring))).toBe(true);
    expect(trees.every((tree) => !tree.mapped)).toBe(true);
    expect(closestPair(trees)).toBeGreaterThanOrEqual(MIN_TREE_GAP_M);
    expect(scatterTrees(ring, forest)).toEqual(trees);
    const large = trees.filter((tree) => tree.size === 1).length;
    expect(large).toBeGreaterThan(trees.length * 0.3);
    expect(large).toBeLessThan(trees.length * 0.7);
  });

  it("scatters a park a fifth as densely, and a polygon cut in two exactly as the whole", () => {
    const park = scatterTrees(square(0, 0, 100), {
      areaPerTreeM2: PARK_TREE_AREA_M2,
      largeShare: 0.5,
    });
    expect(park.length).toBeGreaterThan(15);
    expect(park.length).toBeLessThan(32);
    const whole = scatterTrees(square(0, 0, 100), forest);
    const halves = [
      ...scatterTrees(
        [
          [0, 0],
          [50, 0],
          [50, 100],
          [0, 100],
        ],
        forest,
      ),
      ...scatterTrees(
        [
          [50, 0],
          [100, 0],
          [100, 100],
          [50, 100],
        ],
        forest,
      ),
    ];
    const key = (tree: ProjectedTree): string => tree.point.join(",");
    expect(halves.map(key).sort()).toEqual(whole.map(key).sort());
  });
});

describe("treeRow", () => {
  it("plants a tree every eight metres from end to end, across bends too", () => {
    expect(
      treeRow([
        [0, 0],
        [40, 0],
      ]),
    ).toHaveLength(6);
    const bent = treeRow([
      [0, 0],
      [20, 0],
      [20, 20],
    ]);
    expect(bent).toHaveLength(6);
    expect(bent[3]).toEqual([20, 4]);
    expect(treeRow([])).toEqual([]);
    expect(treeRow([[3, 3]])).toEqual([[3, 3]]);
  });
});

describe("thinTrees", () => {
  it("keeps the earlier of two trees within the gap and every tree beyond it", () => {
    const trees: ProjectedTree[] = [
      { point: [0, 0], size: 1, mapped: true },
      { point: [1, 0], size: 0, mapped: false },
      { point: [MIN_TREE_GAP_M, 0], size: 0, mapped: false },
      { point: [-2.5, 0], size: 0, mapped: false },
    ];
    expect(thinTrees(trees).map((tree) => tree.point)).toEqual([
      [0, 0],
      [MIN_TREE_GAP_M, 0],
    ]);
  });
});
