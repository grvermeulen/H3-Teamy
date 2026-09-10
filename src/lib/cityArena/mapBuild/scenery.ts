import { ROAD_WIDTH_M } from "../render/palette";
import type { MapTile, TileFurniture, TileTree } from "../world/mapTypes";
import { projectLonLat, toUnits, type Point } from "../world/projection";
import {
  alignToRoad,
  furnitureKindOf,
  type ProjectedFurniture,
  type RoadSegment,
} from "./furniture";
import {
  boundsOf,
  distance,
  distancePointToSegment,
  pointInPolygon,
  type Rect,
} from "./geometry";
import { createGridIndex, type GridIndex } from "./gridIndex";
import { indexNodes, type OverpassJson } from "./osmTypes";
import type { RenderRoad } from "./roads";
import {
  createEmptyTile,
  tileCoordFor,
  tileGridSize,
  type ProjectedGround,
} from "./tiles";
import {
  LARGE_TREE_SHARE,
  scatterTrees,
  thinTrees,
  treeRow,
  treeSizeAt,
  type ProjectedTree,
} from "./vegetation";

/** The most trees one tile carries; past it the mapped ones and those nearest a zone stay. */
export const MAX_TREES_PER_TILE = 4000;
/** The most pieces of furniture one tile carries, ranked the same way. */
export const MAX_FURNITURE_PER_TILE = 1500;
/** A scattered tree keeps this far from a road's edge: the pavement and a little more. */
export const TREE_ROAD_CLEARANCE_M = 3;
/** Cell size of the build's obstacle indices, metres. */
const OBSTACLE_CELL_M = 64;

/** What the build hands the tiler: trees and furniture in priority order, and where to keep them. */
export type ProjectedScenery = {
  trees: ProjectedTree[];
  furniture: ProjectedFurniture[];
  /** How many trees OpenStreetMap mapped itself, for the report. */
  mappedTrees: number;
};

/** What scenery keeps clear of: the roads with their widths, and the solid polygons. */
export type SceneryObstacles = {
  roads: GridIndex<RoadSegment>;
  solids: GridIndex<Point[]>;
};

/** What {@link buildScenery} works from. */
export type SceneryInput = {
  /** The scenery query's response: tree nodes, tree rows, furniture nodes. */
  osm: OverpassJson;
  /** Ground polygons in metres; the ones with a bed grow trees. */
  ground: ProjectedGround[];
  /** Road centre lines in metres. */
  roads: RenderRoad[];
  /** Building and water rings in metres; nothing stands inside them. */
  solids: Point[][];
  /** Points the caps keep scenery close to: the zone centres. */
  keepNear: Point[];
};

/** Indexes the roads (as segments with their half-widths) and the solids for clearance tests. */
export function indexObstacles(
  roads: RenderRoad[],
  solids: Point[][],
): SceneryObstacles {
  const roadIndex = createGridIndex<RoadSegment>(OBSTACLE_CELL_M);
  for (const road of roads) {
    const halfWidth = ROAD_WIDTH_M[road.roadClass] / 2;
    for (let index = 1; index < road.points.length; index++) {
      const a = road.points[index - 1];
      const b = road.points[index];
      roadIndex.insert(boundsOf([a, b]), { a, b, halfWidth });
    }
  }
  const solidIndex = createGridIndex<Point[]>(OBSTACLE_CELL_M);
  for (const ring of solids) solidIndex.insert(boundsOf(ring), ring);
  return { roads: roadIndex, solids: solidIndex };
}

/** True when the point is on a road's surface, or within `clearance` of its edge. */
export function onRoad(
  obstacles: SceneryObstacles,
  point: Point,
  clearance: number,
): boolean {
  const reach = clearance + ROAD_WIDTH_M.motorway / 2;
  return obstacles.roads
    .near(point, reach)
    .some(
      (segment) =>
        distancePointToSegment(point, segment.a, segment.b) <
        segment.halfWidth + clearance,
    );
}

/** True when the point lies inside a building or on water. */
export function inSolid(obstacles: SceneryObstacles, point: Point): boolean {
  return obstacles.solids
    .near(point, 0)
    .some((ring) => pointInPolygon(point, ring));
}

/** The trees OpenStreetMap mapped: single trees as nodes, rows as ways. */
function mappedTrees(osm: OverpassJson): ProjectedTree[] {
  const nodes = indexNodes(osm);
  const trees: ProjectedTree[] = [];
  const add = (point: Point): void => {
    trees.push({
      point,
      size: treeSizeAt(point, LARGE_TREE_SHARE),
      mapped: true,
    });
  };
  for (const element of osm.elements) {
    if (element.type === "node" && element.tags?.natural === "tree")
      add(projectLonLat(element.lon, element.lat));
    if (element.type === "way" && element.tags?.natural === "tree_row") {
      const line: Point[] = [];
      for (const id of element.nodes) {
        const node = nodes.get(id);
        if (node) line.push(projectLonLat(node.lon, node.lat));
      }
      for (const point of treeRow(line)) add(point);
    }
  }
  return trees;
}

/** The furniture nodes of the response, turned to their street. */
function mappedFurniture(
  osm: OverpassJson,
  obstacles: SceneryObstacles,
): ProjectedFurniture[] {
  const furniture: ProjectedFurniture[] = [];
  for (const element of osm.elements) {
    if (element.type !== "node" || !element.tags) continue;
    const kind = furnitureKindOf(element.tags);
    if (!kind) continue;
    const point = projectLonLat(element.lon, element.lat);
    if (inSolid(obstacles, point) || onRoad(obstacles, point, 0)) continue;
    furniture.push({
      point,
      kind,
      headingDeg: alignToRoad(point, obstacles.roads),
    });
  }
  return furniture;
}

/** Distance from a point to the nearest of `targets`; infinite with none. */
function nearest(point: Point, targets: Point[]): number {
  let best = Infinity;
  for (const target of targets) best = Math.min(best, distance(point, target));
  return best;
}

/**
 * Orders scenery by priority: mapped items first, then by distance to the nearest `keepNear`
 * point, so what the caps drop is the far countryside.
 */
function rank<T extends { point: Point; mapped?: boolean }>(
  items: T[],
  keepNear: Point[],
): T[] {
  const scored = items.map((item) => ({
    item,
    score: item.mapped ? -1 : nearest(item.point, keepNear),
  }));
  scored.sort((left, right) => left.score - right.score);
  return scored.map(({ item }) => item);
}

/**
 * Everything the scenery query and the ground polygons yield, cleared of roads, buildings and
 * water, thinned to the gap, in priority order.
 *
 * @param input - The response, the ground, and what to keep clear of.
 * @returns The scenery, ready for {@link placeScenery}.
 */
export function buildScenery(input: SceneryInput): ProjectedScenery {
  const obstacles = indexObstacles(input.roads, input.solids);
  const mapped = mappedTrees(input.osm).filter(
    (tree) =>
      !inSolid(obstacles, tree.point) && !onRoad(obstacles, tree.point, 0),
  );
  const scattered = input.ground
    .flatMap((area) => (area.bed ? scatterTrees(area.ring, area.bed) : []))
    .filter(
      (tree) =>
        !inSolid(obstacles, tree.point) &&
        !onRoad(obstacles, tree.point, TREE_ROAD_CLEARANCE_M),
    );
  const trees = thinTrees([...mapped, ...rank(scattered, input.keepNear)]);
  return {
    trees,
    furniture: rank(mappedFurniture(input.osm, obstacles), input.keepNear),
    mappedTrees: trees.filter((tree) => tree.mapped).length,
  };
}

/** Groups items by the tile whose own rectangle holds them, in the order given; outside the grid is dropped. */
function byHomeTile<T extends { point: Point }>(
  items: T[],
  bounds: Rect,
): Map<string, T[]> {
  const { columns, rows } = tileGridSize(bounds);
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const coord = tileCoordFor(item.point, bounds);
    if (coord.x < 0 || coord.y < 0 || coord.x >= columns || coord.y >= rows)
      continue;
    const key = `${coord.x}:${coord.y}`;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  return groups;
}

/** Encodes a tree for the tile. */
function encodeTree(tree: ProjectedTree): TileTree {
  return [toUnits(tree.point[0]), toUnits(tree.point[1]), tree.size];
}

/** Encodes a piece of furniture for the tile. */
function encodeFurniture(piece: ProjectedFurniture): TileFurniture {
  return [
    toUnits(piece.point[0]),
    toUnits(piece.point[1]),
    piece.kind,
    piece.headingDeg,
  ];
}

/**
 * Writes the scenery into the tiles: each tree and piece of furniture into the one tile whose
 * own rectangle holds it, the first {@link MAX_TREES_PER_TILE} and
 * {@link MAX_FURNITURE_PER_TILE} of each in the order given (which {@link buildScenery} makes
 * the priority). A tile that had no geometry yet is created; every tile ends up with both fields.
 *
 * @param tiles - The tiles from `buildTiles`; changed in place and kept in row-major order.
 * @param bounds - The region bounds, metres.
 * @param scenery - The trees and furniture, in priority order.
 */
export function placeScenery(
  tiles: MapTile[],
  bounds: Rect,
  scenery: ProjectedScenery,
): void {
  const byKey = new Map(tiles.map((tile) => [`${tile.x}:${tile.y}`, tile]));
  const tileAt = (key: string): MapTile => {
    const existing = byKey.get(key);
    if (existing) return existing;
    const [x, y] = key.split(":").map(Number);
    const created = createEmptyTile({ x, y });
    byKey.set(key, created);
    tiles.push(created);
    return created;
  };
  for (const tile of tiles) {
    tile.trees = [];
    tile.furniture = [];
  }
  for (const [key, trees] of byHomeTile(scenery.trees, bounds))
    tileAt(key).trees = trees.slice(0, MAX_TREES_PER_TILE).map(encodeTree);
  for (const [key, pieces] of byHomeTile(scenery.furniture, bounds))
    tileAt(key).furniture = pieces
      .slice(0, MAX_FURNITURE_PER_TILE)
      .map(encodeFurniture);
  tiles.sort((left, right) => left.y - right.y || left.x - right.x);
}
