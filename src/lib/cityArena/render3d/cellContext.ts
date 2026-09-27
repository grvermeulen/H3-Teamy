/**
 * What a cell's detail builders ask about its surroundings — the nearest road to a wall, whether
 * a spot is on a carriageway or inside a building, where the landmarks stand — answered from the
 * map tiles through small grids, so a dense cell's hundreds of questions stay cheap. Built once per
 * cell build, and only when the cell is built with full detail.
 */
import {
  distancePointToSegment,
  pointInPolygon,
  type Rect,
} from "../mapBuild/geometry";
import { ROAD_WIDTH_M } from "../render/palette";
import type {
  DecodedBuilding,
  DecodedRoad,
  DecodedTile,
} from "../world/decode";
import type { Point } from "../world/projection";
import {
  createBucketGrid,
  grownRect,
  insertItem,
  visitNear,
  type BucketGrid,
} from "./bucketGrid";
import { tileBuildingsIn, tileRoadsIn } from "./tileIndex";

/** Side of a grid bucket, metres. */
const BUCKET_M = 16;
/** How far past the cell the context reaches, metres: the widest question asked. */
export const CONTEXT_MARGIN_M = 48;

/** One straight piece of a road's centre line. */
export type RoadSegment = {
  a: Point;
  b: Point;
  road: DecodedRoad;
  /** Half the carriageway's width, metres. */
  halfWidth: number;
};

/** The nearest point of a road to a query. */
export type RoadHit = {
  segment: RoadSegment;
  distance: number;
  /** The closest point on the centre line. */
  closest: Point;
};

/** The bounds of a segment. */
function segmentBounds(a: Point, b: Point): Rect {
  return {
    minX: Math.min(a[0], b[0]),
    minY: Math.min(a[1], b[1]),
    maxX: Math.max(a[0], b[0]),
    maxY: Math.max(a[1], b[1]),
  };
}

/**
 * The point of segment a–b closest to a point.
 *
 * @param point - The point.
 * @param a - One end of the segment.
 * @param b - The other end.
 * @returns The closest point on the segment.
 */
export function closestOnSegment(point: Point, a: Point, b: Point): Point {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared;
  const clamped = Math.max(0, Math.min(1, t));
  return [a[0] + clamped * dx, a[1] + clamped * dy];
}

/** The answers a cell's detail builders get about its surroundings. */
export type CellContext = {
  /** Every road that reaches the context's area (the tiles' own lists, deduplicated). */
  roads: readonly DecodedRoad[];
  /** The nearest road within `radius` passing `accept`, or null. */
  nearestRoad(
    point: Point,
    radius: number,
    accept?: (road: DecodedRoad) => boolean,
  ): RoadHit | null;
  /** Whether a point lies on a carriageway, grown by `margin` metres. */
  onCarriageway(point: Point, margin: number): boolean;
  /** Whether a point lies inside a building footprint, or within `margin` metres of one. */
  inFootprint(point: Point, margin: number): boolean;
  /** Centres of the landmark buildings in reach. */
  landmarks: readonly Point[];
};

/** The road segment grid over the context's area. */
function roadGrid(
  roads: readonly DecodedRoad[],
  area: Rect,
): BucketGrid<RoadSegment> {
  const grid = createBucketGrid<RoadSegment>(area, BUCKET_M);
  for (const road of roads) {
    const halfWidth = ROAD_WIDTH_M[road.roadClass] / 2;
    for (let index = 0; index + 1 < road.points.length; index++) {
      const [a, b] = [road.points[index], road.points[index + 1]];
      insertItem(grid, { a, b, road, halfWidth }, segmentBounds(a, b));
    }
  }
  return grid;
}

/** The nearest accepted segment within `radius`. */
function nearestIn(
  grid: BucketGrid<RoadSegment>,
  point: Point,
  radius: number,
  accept: ((road: DecodedRoad) => boolean) | undefined,
): RoadHit | null {
  let best: RoadHit | null = null;
  visitNear(grid, point, radius, (segment) => {
    if (accept && !accept(segment.road)) return;
    const distance = distancePointToSegment(point, segment.a, segment.b);
    if (distance > radius || (best && distance >= best.distance)) return;
    best = {
      segment,
      distance,
      closest: closestOnSegment(point, segment.a, segment.b),
    };
  });
  return best;
}

/** Whether a point is within `margin` of a footprint's edge. */
function nearEdge(
  point: Point,
  ring: readonly Point[],
  margin: number,
): boolean {
  for (let index = 0; index < ring.length; index++) {
    const next = ring[(index + 1) % ring.length];
    if (distancePointToSegment(point, ring[index], next) < margin) return true;
  }
  return false;
}

/** Whether a point lies in, or within `margin` of, any footprint in the grid. */
function footprintAt(
  grid: BucketGrid<DecodedBuilding>,
  point: Point,
  margin: number,
): boolean {
  let hit = false;
  visitNear(grid, point, margin, (building) => {
    if (hit) return;
    const b = building.bounds;
    if (point[0] < b.minX - margin || point[0] > b.maxX + margin) return;
    if (point[1] < b.minY - margin || point[1] > b.maxY + margin) return;
    hit =
      pointInPolygon(point, building.ring) ||
      (margin > 0 && nearEdge(point, building.ring, margin));
  });
  return hit;
}

/** Every distinct road and building of the tiles that reaches an area. */
function gather(
  tiles: readonly DecodedTile[],
  area: Rect,
): { roads: DecodedRoad[]; buildings: DecodedBuilding[] } {
  const roads = new Set<DecodedRoad>();
  const buildings = new Set<DecodedBuilding>();
  for (const tile of tiles) {
    for (const road of tileRoadsIn(tile, area)) roads.add(road);
    for (const building of tileBuildingsIn(tile, area)) buildings.add(building);
  }
  return { roads: [...roads], buildings: [...buildings] };
}

/**
 * The context of a cell: roads and buildings of the tiles within {@link CONTEXT_MARGIN_M} of it.
 *
 * @param bounds - The cell's rectangle, world metres.
 * @param tiles - The tiles the cell is built from.
 * @param destroyed - Structure ids of fallen buildings, which no longer block anything.
 * @returns The context.
 */
export function createCellContext(
  bounds: Rect,
  tiles: readonly DecodedTile[],
  destroyed: ReadonlySet<number>,
): CellContext {
  const area = grownRect(bounds, CONTEXT_MARGIN_M);
  const { roads, buildings } = gather(tiles, area);
  const grid = roadGrid(roads, area);
  const footprints = createBucketGrid<DecodedBuilding>(area, BUCKET_M);
  for (const building of buildings) {
    if (!destroyed.has(building.structureId))
      insertItem(footprints, building, building.bounds);
  }
  const landmarks = buildings
    .filter((building) => building.landmark)
    .map(({ bounds: b }): Point => [
      (b.minX + b.maxX) / 2,
      (b.minY + b.maxY) / 2,
    ]);
  return {
    roads,
    landmarks,
    nearestRoad: (point, radius, accept) =>
      nearestIn(grid, point, radius, accept),
    onCarriageway: (point, margin) => {
      let on = false;
      visitNear(grid, point, BUCKET_M, (segment) => {
        if (on) return;
        const reach = segment.halfWidth + margin;
        on = distancePointToSegment(point, segment.a, segment.b) < reach;
      });
      return on;
    },
    inFootprint: (point, margin) => footprintAt(footprints, point, margin),
  };
}
