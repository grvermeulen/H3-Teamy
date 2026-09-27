/**
 * A bucket index over each decoded tile's buildings, roads and ground, made the first time a cell asks
 * and kept as long as the tile object lives, so a cell finds the few hundred footprints near it
 * without scanning the tile's thousands. Results come back in the tile's own order, so a cell
 * builds exactly as it would from a full scan.
 */
import { rectsIntersect, type Rect } from "../mapBuild/geometry";
import type {
  DecodedBuilding,
  DecodedGround,
  DecodedRoad,
  DecodedTile,
} from "../world/decode";
import {
  createBucketGrid,
  grownRect,
  insertItem,
  visitArea,
  type BucketGrid,
} from "./bucketGrid";

/** Side of a bucket, metres. */
const TILE_BUCKET_M = 64;
/** How far past its own rectangle a tile's grid reaches: its data's overlap and then some. */
const TILE_GRID_MARGIN_M = 64;

/** A tile's items by position in its lists, bucketed. */
type TileIndex = {
  buildings: BucketGrid<number>;
  roads: BucketGrid<number>;
  ground: BucketGrid<number>;
};

/** Every indexed tile. */
const INDEXES = new WeakMap<DecodedTile, TileIndex>();

/** Buckets a list's positions by each item's bounds. */
function indexList<T extends { bounds: Rect }>(
  items: readonly T[],
  rect: Rect,
): BucketGrid<number> {
  const grid = createBucketGrid<number>(rect, TILE_BUCKET_M);
  items.forEach((item, position) => insertItem(grid, position, item.bounds));
  return grid;
}

/** A tile's index, made on first use. */
function indexOf(tile: DecodedTile): TileIndex {
  const cached = INDEXES.get(tile);
  if (cached) return cached;
  const rect = grownRect(tile.rect, TILE_GRID_MARGIN_M);
  const index = {
    buildings: indexList(tile.buildings, rect),
    roads: indexList(tile.roads, rect),
    ground: indexList(tile.ground, rect),
  };
  INDEXES.set(tile, index);
  return index;
}

/** The items of a list whose bounds meet an area, in list order. */
function inArea<T extends { bounds: Rect }>(
  items: readonly T[],
  grid: BucketGrid<number>,
  area: Rect,
): T[] {
  const found = new Set<number>();
  visitArea(grid, area, (position) => {
    if (rectsIntersect(items[position].bounds, area)) found.add(position);
  });
  return [...found].sort((a, b) => a - b).map((position) => items[position]);
}

/**
 * A tile's buildings whose bounds meet an area, in the tile's order.
 *
 * @param tile - The tile.
 * @param area - The area, world metres.
 * @returns The buildings.
 */
export function tileBuildingsIn(
  tile: DecodedTile,
  area: Rect,
): DecodedBuilding[] {
  return inArea(tile.buildings, indexOf(tile).buildings, area);
}

/**
 * A tile's roads whose bounds meet an area, in the tile's order.
 *
 * @param tile - The tile.
 * @param area - The area, world metres.
 * @returns The roads.
 */
export function tileRoadsIn(tile: DecodedTile, area: Rect): DecodedRoad[] {
  return inArea(tile.roads, indexOf(tile).roads, area);
}

/**
 * A tile's ground polygons whose bounds meet an area, in the tile's order.
 *
 * @param tile - The tile.
 * @param area - The area, world metres.
 * @returns The ground polygons.
 */
export function tileGroundIn(tile: DecodedTile, area: Rect): DecodedGround[] {
  return inArea(tile.ground, indexOf(tile).ground, area);
}
