import type { GroundKind, MapBounds, MapTile } from "../world/mapTypes";
import {
  MAP_BBOX,
  projectLonLat,
  toUnits,
  type Point,
} from "../world/projection";
import {
  boundsOf,
  clipPolygonToRect,
  clipPolylineToRect,
  rectsIntersect,
  type Rect,
} from "./geometry";
import type { RenderRoad } from "./roads";

/** Tile edge length in metres. */
export const TILE_SIZE_M = 2000;

/** Geometry is clipped to tiles expanded by this margin so seams never show. */
export const TILE_OVERLAP_M = 20;

/** Grid coordinate of a tile (0-based from the north-west corner of the bounds). */
export type TileCoord = { x: number; y: number };

/** Building footprint in metres with its render attributes. */
export type ProjectedBuilding = {
  ring: Point[];
  levels: number;
  landmark?: string;
};

/** Ground polygon in metres. */
export type ProjectedGround = {
  ring: Point[];
  kind: Exclude<GroundKind, "urban">;
};

/** Water polygon in metres. */
export type ProjectedWater = { ring: Point[] };

/** Region bounds in metres derived from the bbox corners (north is the smaller y). */
export function regionBoundsMetres(): Rect {
  const [minX] = projectLonLat(MAP_BBOX.west, MAP_BBOX.south);
  const [maxX] = projectLonLat(MAP_BBOX.east, MAP_BBOX.south);
  const [, minY] = projectLonLat(MAP_BBOX.west, MAP_BBOX.north);
  const [, maxY] = projectLonLat(MAP_BBOX.west, MAP_BBOX.south);
  return { minX, minY, maxX, maxY };
}

/** Converts metre bounds to asset units. */
export function boundsToUnits(bounds: Rect): MapBounds {
  return {
    minX: toUnits(bounds.minX),
    minY: toUnits(bounds.minY),
    maxX: toUnits(bounds.maxX),
    maxY: toUnits(bounds.maxY),
  };
}

/** Tile containing a point. */
export function tileCoordFor(point: Point, bounds: Rect): TileCoord {
  return {
    x: Math.floor((point[0] - bounds.minX) / TILE_SIZE_M),
    y: Math.floor((point[1] - bounds.minY) / TILE_SIZE_M),
  };
}

/** Rectangle of a tile expanded by the overlap margin. */
export function tileRect(
  coord: TileCoord,
  bounds: Rect,
  overlapMetres = TILE_OVERLAP_M,
): Rect {
  const minX = bounds.minX + coord.x * TILE_SIZE_M;
  const minY = bounds.minY + coord.y * TILE_SIZE_M;
  return {
    minX: minX - overlapMetres,
    minY: minY - overlapMetres,
    maxX: minX + TILE_SIZE_M + overlapMetres,
    maxY: minY + TILE_SIZE_M + overlapMetres,
  };
}

/** All tiles whose expanded rectangle intersects `rect`, row-major. */
export function tilesCovering(rect: Rect, bounds: Rect): TileCoord[] {
  const first = tileCoordFor(
    [rect.minX - TILE_OVERLAP_M, rect.minY - TILE_OVERLAP_M],
    bounds,
  );
  const last = tileCoordFor(
    [rect.maxX + TILE_OVERLAP_M, rect.maxY + TILE_OVERLAP_M],
    bounds,
  );
  const coords: TileCoord[] = [];
  for (let y = Math.max(0, first.y - 1); y <= last.y; y++) {
    for (let x = Math.max(0, first.x - 1); x <= last.x; x++) {
      const coord = { x, y };
      if (rectsIntersect(rect, tileRect(coord, bounds))) coords.push(coord);
    }
  }
  return coords;
}

/** File name of a tile inside the asset directory. */
export function tileFileName(coord: TileCoord): string {
  return `tile_${coord.x}_${coord.y}.json`;
}

/** Flattens points to `[x0, y0, x1, y1, …]` in integer units. */
export function flattenUnits(points: Point[]): number[] {
  const flat: number[] = [];
  for (const [x, y] of points) flat.push(toUnits(x), toUnits(y));
  return flat;
}

/**
 * Helper to clip a polygon ring to each tile it touches and visit the clipped result.
 */
function forEachClippedRing(
  ring: Point[],
  bounds: Rect,
  visit: (coord: TileCoord, clipped: Point[]) => void,
): void {
  for (const coord of tilesCovering(boundsOf(ring), bounds)) {
    const clipped = clipPolygonToRect(ring, tileRect(coord, bounds));
    if (clipped.length > 0) visit(coord, clipped);
  }
}

/** Distributes all geometry into non-empty tiles, clipping to each tile's expanded rectangle. */
export function buildTiles(
  bounds: Rect,
  roads: RenderRoad[],
  buildings: ProjectedBuilding[],
  ground: ProjectedGround[],
  water: ProjectedWater[],
): MapTile[] {
  const tiles = new Map<string, MapTile>();
  const tileFor = (coord: TileCoord): MapTile => {
    const key = `${coord.x}:${coord.y}`;
    const existing = tiles.get(key);
    if (existing) return existing;
    const created: MapTile = {
      x: coord.x,
      y: coord.y,
      roads: [],
      buildings: [],
      ground: [],
      water: [],
    };
    tiles.set(key, created);
    return created;
  };

  for (const road of roads) {
    if (road.points.length < 2) continue;
    for (const coord of tilesCovering(boundsOf(road.points), bounds)) {
      for (const piece of clipPolylineToRect(
        road.points,
        tileRect(coord, bounds),
      )) {
        tileFor(coord).roads.push({
          points: flattenUnits(piece),
          roadClass: road.roadClass,
          name: road.name,
        });
      }
    }
  }
  for (const building of buildings) {
    forEachClippedRing(building.ring, bounds, (coord, clipped) => {
      tileFor(coord).buildings.push({
        points: flattenUnits(clipped),
        levels: building.levels,
        ...(building.landmark ? { landmark: building.landmark } : {}),
      });
    });
  }
  for (const area of ground) {
    forEachClippedRing(area.ring, bounds, (coord, clipped) => {
      tileFor(coord).ground.push({
        points: flattenUnits(clipped),
        kind: area.kind,
      });
    });
  }
  for (const area of water) {
    forEachClippedRing(area.ring, bounds, (coord, clipped) => {
      tileFor(coord).water.push({ points: flattenUnits(clipped) });
    });
  }

  return [...tiles.values()].sort(
    (left, right) => left.y - right.y || left.x - right.x,
  );
}
