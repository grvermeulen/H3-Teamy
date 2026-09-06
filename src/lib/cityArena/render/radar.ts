import type { MapRoads } from "../world/mapTypes";
import { fromUnits, type Point } from "../world/projection";
import type { RoadGraph } from "../world/roadGraph";
import type { PickupKind } from "../sim/types";
import {
  PICKUP_HEALTH,
  PICKUP_SHOTGUN,
  PICKUP_UZI,
  RADAR_BACKGROUND,
  RADAR_PLAYER,
  RADAR_POLICE,
  RADAR_ROAD,
  RADAR_ZONE,
} from "./palette";
import type { RasterContext } from "./canvasTypes";

/** CSS size of the arena radar. */
export const RADAR_SIZE_PX = 90;
/** World radius represented by the radar. */
export const RADAR_RANGE_M = 150;
/** Empty radar projection used while the arena is loading. */
export const EMPTY_RADAR_SNAPSHOT: RadarSnapshot = {
  player: [0, 0],
  roads: [],
  pickups: [],
  police: [],
  zoneCentre: null,
  zoneRadiusM: null,
};

/** Immutable render data for the north-up radar. */
export type RadarSnapshot = {
  player: Point;
  roads: Array<readonly [Point, Point]>;
  pickups: Array<{ point: Point; kind: PickupKind }>;
  police: Array<Point>;
  zoneCentre: Point | null;
  zoneRadiusM: number | null;
};

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0)
    return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared,
    ),
  );
  return Math.hypot(
    point[0] - (start[0] + t * dx),
    point[1] - (start[1] + t * dy),
  );
}

const RADAR_BUCKET_M = RADAR_RANGE_M;

/** Cached spatial index for graph segments used by the small radar. */
export type RadarRoadIndex = {
  segments: Array<readonly [Point, Point]>;
  buckets: Map<string, number[]>;
};

function radarBucket(value: number): number {
  return Math.floor(value / RADAR_BUCKET_M);
}

function radarBucketKey(x: number, y: number): string {
  return `${x}:${y}`;
}

/** Builds the radar's one-time segment index instead of rescanning the full road graph per tick. */
export function createRadarRoadIndex(
  nodes: readonly Point[],
  edges: readonly Pick<RoadGraph["edges"][number], "a" | "b">[],
): RadarRoadIndex {
  const segments: Array<readonly [Point, Point]> = [];
  const buckets = new Map<string, number[]>();
  for (const edge of edges) {
    const start = nodes[edge.a];
    const end = nodes[edge.b];
    if (!start || !end) continue;
    const segmentIndex = segments.push([start, end]) - 1;
    const minX = radarBucket(Math.min(start[0], end[0]));
    const maxX = radarBucket(Math.max(start[0], end[0]));
    const minY = radarBucket(Math.min(start[1], end[1]));
    const maxY = radarBucket(Math.max(start[1], end[1]));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const key = radarBucketKey(x, y);
        const bucket = buckets.get(key) ?? [];
        bucket.push(segmentIndex);
        buckets.set(key, bucket);
      }
    }
  }
  return { segments, buckets };
}

/** Returns only indexed road segments that intersect the radar range. */
export function nearbyRadarRoads(
  index: RadarRoadIndex,
  centre: Point,
  rangeM: number,
): Array<readonly [Point, Point]> {
  const candidates = new Set<number>();
  const minX = radarBucket(centre[0] - rangeM);
  const maxX = radarBucket(centre[0] + rangeM);
  const minY = radarBucket(centre[1] - rangeM);
  const maxY = radarBucket(centre[1] + rangeM);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      for (const segment of index.buckets.get(radarBucketKey(x, y)) ?? [])
        candidates.add(segment);
    }
  }
  return [...candidates]
    .map((segment) => index.segments[segment])
    .filter(
      (segment): segment is readonly [Point, Point] =>
        segment !== undefined &&
        distanceToSegment(centre, segment[0], segment[1]) <= rangeM,
    );
}

/** Returns road centre-line segments that intersect the radar range. */
export function radarRoads(
  roads: MapRoads,
  centre: Point,
  rangeM: number,
): Array<readonly [Point, Point]> {
  const nodes: Point[] = [];
  for (let index = 0; index + 1 < roads.nodes.length; index += 2)
    nodes.push([
      fromUnits(roads.nodes[index]),
      fromUnits(roads.nodes[index + 1]),
    ]);
  const edges = [];
  for (let index = 0; index + 5 < roads.edges.length; index += 6)
    edges.push({ a: roads.edges[index], b: roads.edges[index + 1] });
  return nearbyRadarRoads(createRadarRoadIndex(nodes, edges), centre, rangeM);
}

function pickupRadarColour(kind: PickupKind): string {
  if (kind === "health") return PICKUP_HEALTH;
  return kind === "uzi" ? PICKUP_UZI : PICKUP_SHOTGUN;
}

function radarPoint(
  point: Point,
  centre: Point,
  size: number,
  rangeM: number,
): [number, number] {
  const scale = size / (rangeM * 2);
  return [
    size / 2 + (point[0] - centre[0]) * scale,
    size / 2 + (point[1] - centre[1]) * scale,
  ];
}

/** Draws a north-up radar with roads, zone, pickups, police and the player. */
export function drawRadar(
  context: RasterContext,
  snapshot: RadarSnapshot,
  size: number,
): void {
  const radius = size / 2;
  context.save();
  context.beginPath();
  context.arc(radius, radius, radius, 0, Math.PI * 2, false);
  context.fillStyle = RADAR_BACKGROUND;
  context.fill();
  context.clip();

  context.strokeStyle = RADAR_ROAD;
  context.lineWidth = 1;
  for (const [start, end] of snapshot.roads) {
    const from = radarPoint(start, snapshot.player, size, RADAR_RANGE_M);
    const to = radarPoint(end, snapshot.player, size, RADAR_RANGE_M);
    context.beginPath();
    context.moveTo(from[0], from[1]);
    context.lineTo(to[0], to[1]);
    context.stroke();
  }

  if (snapshot.zoneCentre && snapshot.zoneRadiusM !== null) {
    const centre = radarPoint(
      snapshot.zoneCentre,
      snapshot.player,
      size,
      RADAR_RANGE_M,
    );
    context.beginPath();
    context.arc(
      centre[0],
      centre[1],
      Math.min(snapshot.zoneRadiusM * (size / (RADAR_RANGE_M * 2)), radius),
      0,
      Math.PI * 2,
      false,
    );
    context.strokeStyle = RADAR_ZONE;
    context.lineWidth = 1.5;
    context.stroke();
  }

  for (const pickup of snapshot.pickups) {
    const [x, y] = radarPoint(
      pickup.point,
      snapshot.player,
      size,
      RADAR_RANGE_M,
    );
    context.fillStyle = pickupRadarColour(pickup.kind);
    context.beginPath();
    context.moveTo(x, y - 3);
    context.lineTo(x + 3, y);
    context.lineTo(x, y + 3);
    context.lineTo(x - 3, y);
    context.closePath();
    context.fill();
  }

  context.fillStyle = RADAR_POLICE;
  for (const police of snapshot.police) {
    const [x, y] = radarPoint(police, snapshot.player, size, RADAR_RANGE_M);
    context.beginPath();
    context.arc(x, y, 2, 0, Math.PI * 2, false);
    context.fill();
  }

  const [playerX, playerY] = radarPoint(
    snapshot.player,
    snapshot.player,
    size,
    RADAR_RANGE_M,
  );
  context.fillStyle = RADAR_PLAYER;
  context.beginPath();
  context.arc(playerX, playerY, 3, 0, Math.PI * 2, false);
  context.fill();
  context.restore();
}
