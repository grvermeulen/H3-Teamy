/**
 * What a cell's detail builders ask about its surroundings — the nearest road to a wall, whether
 * a spot is on a carriageway or inside a building, where the landmarks stand — answered from the
 * map tiles through small grids, so a dense cell's hundreds of questions stay cheap. Built once per
 * cell build, and only when the cell is built with full detail.
 */
import {
  pointInPolygon,
  pointInRect,
  rectsIntersect,
  type Rect,
} from "../mapBuild/geometry";
import { ROAD_WIDTH_M } from "../render/palette";
import type {
  DecodedBuilding,
  DecodedGround,
  DecodedRoad,
  DecodedTile,
} from "../world/decode";
import type { GroundKind } from "../world/mapTypes";
import type { Point } from "../world/projection";
import {
  createBucketGrid,
  grownRect,
  insertItem,
  visitNear,
  type BucketGrid,
} from "./bucketGrid";
import { addArm } from "./roadArms";
import { tileBuildingsIn, tileGroundIn, tileRoadsIn } from "./tileIndex";

/** Side of a grid bucket, metres. */
const BUCKET_M = 16;
/** Side of a ground polygon bucket, metres: the polygons are few and large. */
const GROUND_BUCKET_M = 32;
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

/** The widest carriageway's half width, metres: the farthest a carriageway reaches from its centre line. */
const MAX_HALF_ROAD_M = Math.max(...Object.values(ROAD_WIDTH_M)) / 2;

/**
 * The squared distance from a point to segment a–b: the context's questions compare it against a
 * squared reach, which skips a square root and an allocation per segment.
 */
function segmentDistanceSquared(point: Point, a: Point, b: Point): number {
  const [sx, sy] = [b[0] - a[0], b[1] - a[1]];
  const [px, py] = [point[0] - a[0], point[1] - a[1]];
  const lengthSquared = sx * sx + sy * sy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, (px * sx + py * sy) / lengthSquared));
  const [dx, dy] = [px - t * sx, py - t * sy];
  return dx * dx + dy * dy;
}

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
  /**
   * Whether a point lies on a carriageway, grown by `margin` metres; only roads passing `accept`
   * count when it is given.
   */
  onCarriageway(
    point: Point,
    margin: number,
    accept?: (road: DecodedRoad) => boolean,
  ): boolean;
  /** The ground a point lies on — the topmost fields, grass or wood polygon — or null (urban). */
  groundAt(point: Point): GroundKind | null;
  /** Whether a point lies inside a building footprint, or within `margin` metres of one. */
  inFootprint(point: Point, margin: number): boolean;
  /** Centres of the landmark buildings in reach. */
  landmarks: readonly Point[];
  /**
   * How many distinct ways roads leave a point: every road centre line within `radius` adds the
   * directions it runs away from it — one for a road ending there, two for one passing through —
   * with copies of the same road (tile overlaps, tile seams) counted once. A dead end has one.
   */
  armsAt(point: Point, radius: number): number;
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
    const distance = Math.sqrt(
      segmentDistanceSquared(point, segment.a, segment.b),
    );
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
    if (segmentDistanceSquared(point, ring[index], next) < margin * margin)
      return true;
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

/** How the ground kinds stack, bottom first, as the 2D map paints them. */
const GROUND_STACK: readonly GroundKind[] = ["field", "grass", "forest"];

/** The ground polygons of the tiles over an area, bucketed. */
function groundGrid(
  tiles: readonly DecodedTile[],
  area: Rect,
): BucketGrid<DecodedGround> {
  const grid = createBucketGrid<DecodedGround>(area, GROUND_BUCKET_M);
  for (const tile of tiles)
    for (const polygon of tileGroundIn(tile, area))
      insertItem(grid, polygon, polygon.bounds);
  return grid;
}

/** The topmost ground kind under a point, or null. */
function groundIn(
  grid: BucketGrid<DecodedGround>,
  point: Point,
): GroundKind | null {
  let best = -1;
  visitNear(grid, point, 0, (polygon) => {
    const rank = GROUND_STACK.indexOf(polygon.kind);
    if (rank <= best || !pointInRect(point, polygon.bounds)) return;
    if (pointInPolygon(point, polygon.ring)) best = rank;
  });
  return best < 0 ? null : GROUND_STACK[best];
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
  const ground = groundGrid(tiles, area);
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
    onCarriageway: (point, margin, accept) => {
      let on = false;
      visitNear(grid, point, MAX_HALF_ROAD_M + margin, (segment) => {
        if (on || (accept && !accept(segment.road))) return;
        const reach = segment.halfWidth + margin;
        on =
          segmentDistanceSquared(point, segment.a, segment.b) < reach * reach;
      });
      return on;
    },
    groundAt: (point) => groundIn(ground, point),
    inFootprint: (point, margin) => footprintAt(footprints, point, margin),
    armsAt: (point, radius) => armsIn(grid, point, radius),
  };
}

/** The squared distance between two points. */
function distanceSquared(p: Point, q: Point): number {
  return (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
}

/** See {@link CellContext.armsAt}. */
function armsIn(
  grid: BucketGrid<RoadSegment>,
  point: Point,
  radius: number,
): number {
  const reach = radius * radius;
  const arms: Point[] = [];
  visitNear(grid, point, radius, ({ a, b }) => {
    if (segmentDistanceSquared(point, a, b) > reach) return;
    if (distanceSquared(point, a) > reach) addArm(arms, point, a);
    if (distanceSquared(point, b) > reach) addArm(arms, point, b);
  });
  return arms.length;
}
