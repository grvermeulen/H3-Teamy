import type { MapRoads } from "../world/mapTypes";
import { fromUnits, type Point } from "../world/projection";
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
  const result: Array<readonly [Point, Point]> = [];
  for (let index = 0; index + 5 < roads.edges.length; index += 6) {
    const start = nodes[roads.edges[index]];
    const end = nodes[roads.edges[index + 1]];
    if (!start || !end || distanceToSegment(centre, start, end) > rangeM)
      continue;
    result.push([start, end]);
  }
  return result;
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
