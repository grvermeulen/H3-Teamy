import { describe, expect, it } from "vitest";
import type { MapTile } from "../world/mapTypes";
import { unprojectXY, type Point } from "../world/projection";
import type { ProjectedFurniture } from "./furniture";
import type { OverpassJson } from "./osmTypes";
import {
  MAX_FURNITURE_PER_TILE,
  MAX_TREES_PER_TILE,
  buildScenery,
  indexObstacles,
  inSolid,
  onRoad,
  placeScenery,
} from "./scenery";
import { createEmptyTile } from "./tiles";
import { FOREST_TREE_AREA_M2, type ProjectedTree } from "./vegetation";

/** A square of `side` metres with its corner at (x, y). */
function square(x: number, y: number, side: number): Point[] {
  return [
    [x, y],
    [x + side, y],
    [x + side, y + side],
    [x, y + side],
  ];
}

/** An Overpass node at a metre position. */
function nodeAt(
  id: number,
  point: Point,
  tags: Record<string, string>,
): OverpassJson["elements"][number] {
  const { lat, lon } = unprojectXY(point[0], point[1]);
  return { type: "node", id, lat, lon, tags };
}

const road = {
  points: [
    [-10, 50],
    [110, 50],
  ] as Point[],
  roadClass: "residential" as const,
};
const hut = square(10, 10, 20);

describe("obstacles", () => {
  const obstacles = indexObstacles([road], [hut]);

  it("knows the road surface, its clearance and the solids", () => {
    expect(onRoad(obstacles, [50, 50], 0)).toBe(true);
    expect(onRoad(obstacles, [50, 54], 0)).toBe(false);
    expect(onRoad(obstacles, [50, 54], 3)).toBe(true);
    expect(onRoad(obstacles, [50, 57], 3)).toBe(false);
    expect(inSolid(obstacles, [20, 20])).toBe(true);
    expect(inSolid(obstacles, [40, 20])).toBe(false);
  });
});

describe("buildScenery", () => {
  const osm: OverpassJson = {
    elements: [
      nodeAt(1, [70, 20], { natural: "tree" }),
      nodeAt(2, [20, 20], { natural: "tree" }),
      nodeAt(3, [50, 50], { natural: "tree" }),
      nodeAt(4, [70, 45], { highway: "street_lamp" }),
      nodeAt(5, [20, 20], { amenity: "bench" }),
      nodeAt(6, [90, 80], { amenity: "bench" }),
      { type: "node", id: 10, lat: 51.98, lon: 5.625 },
      { type: "node", id: 11, ...unprojectXY(24, 0) },
      { type: "way", id: 20, nodes: [10, 11], tags: { natural: "tree_row" } },
    ],
  };
  const scenery = buildScenery({
    osm,
    ground: [
      {
        ring: square(0, 0, 100),
        kind: "forest",
        bed: { areaPerTreeM2: FOREST_TREE_AREA_M2, largeShare: 0.5 },
      },
      { ring: square(200, 200, 50), kind: "grass" },
    ],
    roads: [road],
    solids: [hut],
    keepNear: [[0, 0]],
  });

  it("keeps the mapped trees first, off the road and out of the hut, then the scattered ones ranked by distance", () => {
    const mapped = scenery.trees.filter((tree) => tree.mapped);
    expect(mapped.length).toBe(scenery.mappedTrees);
    expect(scenery.trees.slice(0, mapped.length)).toEqual(mapped);
    expect(
      mapped.some(
        (tree) => Math.hypot(tree.point[0] - 70, tree.point[1] - 20) < 0.01,
      ),
    ).toBe(true);
    expect(
      mapped.some(
        (tree) => Math.hypot(tree.point[0] - 20, tree.point[1] - 20) < 0.01,
      ),
    ).toBe(false);
    expect(
      mapped.some(
        (tree) => Math.hypot(tree.point[0] - 50, tree.point[1] - 50) < 0.01,
      ),
    ).toBe(false);
    // The row from the origin to (24, 0): four trees eight metres apart.
    expect(mapped.length).toBe(5);
    const scattered = scenery.trees.filter((tree) => !tree.mapped);
    expect(scattered.length).toBeGreaterThan(60);
    expect(scattered.every((tree) => Math.abs(tree.point[1] - 50) >= 6)).toBe(
      true,
    );
    expect(
      scattered.every(
        (tree) =>
          !(
            tree.point[0] > 10 &&
            tree.point[0] < 30 &&
            tree.point[1] > 10 &&
            tree.point[1] < 30
          ),
      ),
    ).toBe(true);
    const distances = scattered.map((tree) => Math.hypot(...tree.point));
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
  });

  it("keeps the furniture off the solids, turned along its street", () => {
    expect(
      scenery.furniture.map((piece) => ({
        ...piece,
        point: piece.point.map(Math.round),
      })),
    ).toEqual([
      { point: [70, 45], kind: "lamp", headingDeg: 0 },
      { point: [90, 80], kind: "bench", headingDeg: 0 },
    ]);
  });
});

describe("placeScenery", () => {
  const bounds = { minX: 0, minY: 0, maxX: 4000, maxY: 2000 };

  it("files each item in its home tile, caps the tile in the order given, and drops what falls outside", () => {
    const trees: ProjectedTree[] = [];
    for (let index = 0; index < MAX_TREES_PER_TILE + 100; index++)
      trees.push({
        point: [(index % 400) * 4 + 2, Math.floor(index / 400) * 4 + 2],
        size: 0,
        mapped: index < 2,
      });
    trees.push({ point: [2500, 100], size: 1, mapped: false });
    trees.push({ point: [-10, 100], size: 1, mapped: false });
    const furniture: ProjectedFurniture[] = [
      { point: [3000, 1000], kind: "busStop", headingDeg: 45 },
    ];
    const tiles: MapTile[] = [createEmptyTile({ x: 0, y: 0 })];
    placeScenery(tiles, bounds, { trees, furniture, mappedTrees: 2 });
    expect(tiles.map((tile) => [tile.x, tile.y])).toEqual([
      [0, 0],
      [1, 0],
    ]);
    expect(tiles[0].trees).toHaveLength(MAX_TREES_PER_TILE);
    expect(tiles[0].trees?.[0]).toEqual([8, 8, 0]);
    expect(tiles[0].furniture).toEqual([]);
    expect(tiles[1].trees).toEqual([[10000, 400, 1]]);
    expect(tiles[1].furniture).toEqual([[12000, 4000, "busStop", 45]]);
    expect(MAX_FURNITURE_PER_TILE).toBeGreaterThan(0);
  });
});
