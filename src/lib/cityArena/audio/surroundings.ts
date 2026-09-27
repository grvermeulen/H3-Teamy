/**
 * What surrounds the listener, as the ambience hears it (immersion spec §6): road and traffic
 * within 80 m, people within 30 m, trees and the kind of ground within 60 m. A pure read of the
 * loaded map tiles and the live scene; the ambience turns it into loop levels.
 */

import {
  pointInPolygon,
  rectsIntersect,
  type Rect,
} from "../mapBuild/geometry";
import type { DecodedRoad, DecodedTile } from "../world/decode";
import type { RoadClass } from "../world/mapTypes";
import type { Point } from "../world/projection";
import type { SoundPoint } from "./eventVoices";
import type { Listener } from "./spatial";
import type { TrafficSource } from "./trafficVoices";

/** What surrounds the listener. */
export type Surroundings = {
  /** Road length within {@link TRAFFIC_RADIUS_M}, metres, weighted by how busy its class runs. */
  roadM: number;
  /** Moving cars within {@link TRAFFIC_RADIUS_M}. */
  movingCars: number;
  /** People within {@link PEDS_RADIUS_M}. */
  peds: number;
  /** Trees within {@link GROUND_RADIUS_M}. */
  trees: number;
  /** Shares of the ground within {@link GROUND_RADIUS_M}, each 0…1. */
  greenShare: number;
  fieldShare: number;
  waterShare: number;
  buildingShare: number;
  /** The nearest point on a road within {@link TRAFFIC_RADIUS_M}, or `null` without one. */
  nearestRoad: SoundPoint | null;
};

/** Nothing around: the surroundings before the first read. */
export const EMPTY_SURROUNDINGS: Surroundings = {
  roadM: 0,
  movingCars: 0,
  peds: 0,
  trees: 0,
  greenShare: 0,
  fieldShare: 0,
  waterShare: 0,
  buildingShare: 0,
  nearestRoad: null,
};

/** How far roads and traffic are heard, metres. */
export const TRAFFIC_RADIUS_M = 80;
/** How far a crowd is heard, metres. */
export const PEDS_RADIUS_M = 30;
/** How far trees and the ground count, metres. */
export const GROUND_RADIUS_M = 60;
/** Spacing of the ground samples, metres: a 9 × 9 grid over the 120 m square. */
export const GROUND_SAMPLE_STEP_M = 15;
/** Below this speed a car is parked, m/s. */
const MOVING_MPS = 0.5;
/** How far a tile's geometry reaches past its own rectangle (`world/decode.ts`), metres. */
const TILE_OVERLAP_M = 20;

/** How much traffic a road of each class carries, relative to an ordinary through road. */
const ROAD_TRAFFIC_WEIGHT: Readonly<Record<RoadClass, number>> = {
  motorway: 3,
  trunk: 2.5,
  primary: 2,
  secondary: 1.6,
  tertiary: 1.3,
  unclassified: 0.6,
  residential: 0.5,
  living_street: 0.3,
  pedestrian: 0.1,
  service: 0.3,
};

/**
 * True when the tile owns `point`: its rectangle, half-open so a point on the border between two
 * tiles belongs to exactly one. Tiles carry a margin of their neighbours' geometry, and anything
 * counted must be counted once.
 */
function owns(tileRect: Rect, [x, y]: Point): boolean {
  return (
    x >= tileRect.minX &&
    x < tileRect.maxX &&
    y >= tileRect.minY &&
    y < tileRect.maxY
  );
}

/** The square around a point, `half` metres each way. */
function squareAround(x: number, y: number, half: number): Rect {
  return { minX: x - half, minY: y - half, maxX: x + half, maxY: y + half };
}

/** How many points lie within `radius` of the listener. */
function countWithin(
  points: readonly SoundPoint[],
  listener: Listener,
  radius: number,
): number {
  return points.filter(
    (point) => Math.hypot(point.x - listener.x, point.y - listener.y) <= radius,
  ).length;
}

/** The part of segment a–b inside the circle, metres. */
function lengthInCircle(
  a: Point,
  b: Point,
  centre: Point,
  radius: number,
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const fx = a[0] - centre[0];
  const fy = a[1] - centre[1];
  const lengthSquared = dx * dx + dy * dy;
  const half = fx * dx + fy * dy;
  const offset = fx * fx + fy * fy - radius * radius;
  const discriminant = half * half - lengthSquared * offset;
  if (lengthSquared === 0 || discriminant <= 0) return 0;
  const root = Math.sqrt(discriminant);
  const enter = Math.max(0, (-half - root) / lengthSquared);
  const leave = Math.min(1, (-half + root) / lengthSquared);
  return Math.max(0, leave - enter) * Math.sqrt(lengthSquared);
}

/** The point of segment a–b nearest to `point`. */
function nearestOnSegment(point: Point, a: Point, b: Point): Point {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const along =
    lengthSquared === 0
      ? 0
      : ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared;
  const clamped = Math.max(0, Math.min(1, along));
  return [a[0] + clamped * dx, a[1] + clamped * dy];
}

/** Road metres counted so far, and the nearest road point found so far. */
type RoadTally = { roadM: number; nearest: Point | null; nearestM: number };

/** Adds one road's segments to the tally. */
function tallyRoad(
  tally: RoadTally,
  road: DecodedRoad,
  tileRect: Rect,
  centre: Point,
): void {
  const weight = ROAD_TRAFFIC_WEIGHT[road.roadClass];
  for (let index = 1; index < road.points.length; index++) {
    const start = road.points[index - 1]!;
    const end = road.points[index]!;
    const middle: Point = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
    if (owns(tileRect, middle))
      tally.roadM +=
        weight * lengthInCircle(start, end, centre, TRAFFIC_RADIUS_M);
    const closest = nearestOnSegment(centre, start, end);
    const closestM = Math.hypot(closest[0] - centre[0], closest[1] - centre[1]);
    if (closestM > tally.nearestM) continue;
    tally.nearestM = closestM;
    tally.nearest = closest;
  }
}

/** Weighted road metres within the traffic radius, and the nearest road point. */
function readRoads(
  tiles: readonly DecodedTile[],
  listener: Listener,
): Pick<Surroundings, "roadM" | "nearestRoad"> {
  const centre: Point = [listener.x, listener.y];
  const area = squareAround(listener.x, listener.y, TRAFFIC_RADIUS_M);
  const tally: RoadTally = {
    roadM: 0,
    nearest: null,
    nearestM: TRAFFIC_RADIUS_M,
  };
  for (const tile of tiles)
    for (const road of tile.roads)
      if (rectsIntersect(road.bounds, area))
        tallyRoad(tally, road, tile.rect, centre);
  const { nearest } = tally;
  return {
    roadM: tally.roadM,
    nearestRoad: nearest ? { x: nearest[0], y: nearest[1] } : null,
  };
}

/** Trees within the ground radius, each counted in the tile that owns it. */
function countTrees(tiles: readonly DecodedTile[], listener: Listener): number {
  let trees = 0;
  for (const tile of tiles)
    for (const tree of tile.trees) {
      const [x, y] = tree.point;
      if (!owns(tile.rect, tree.point)) continue;
      if (Math.hypot(x - listener.x, y - listener.y) <= GROUND_RADIUS_M)
        trees++;
    }
  return trees;
}

/** What covers the ground at one sample. */
type GroundSample = "water" | "building" | "green" | "field" | "other";

/** The rings near the listener, sorted by what they cover. */
type NearbyRings = {
  water: Point[][];
  buildings: Point[][];
  ground: { ring: Point[]; kind: GroundSample }[];
};

/** The water, building and ground rings whose bounds reach into `area`. */
function ringsNear(tiles: readonly DecodedTile[], area: Rect): NearbyRings {
  const near = <Shape extends { bounds: Rect }>(shapes: readonly Shape[]) =>
    shapes.filter((shape) => rectsIntersect(shape.bounds, area));
  return {
    water: tiles.flatMap((tile) => near(tile.water).map((shape) => shape.ring)),
    buildings: tiles.flatMap((tile) =>
      near(tile.buildings).map((shape) => shape.ring),
    ),
    ground: tiles.flatMap((tile) =>
      near(tile.ground).map((shape) => ({
        ring: shape.ring,
        kind: groundSampleOf(shape.kind),
      })),
    ),
  };
}

/** A ground kind as the ambience hears it. */
function groundSampleOf(
  kind: DecodedTile["ground"][number]["kind"],
): GroundSample {
  if (kind === "grass" || kind === "forest") return "green";
  return kind === "field" ? "field" : "other";
}

/** What covers the ground at `point`: water over buildings over the ground polygons. */
function sampleAt(point: Point, rings: NearbyRings): GroundSample {
  if (rings.water.some((ring) => pointInPolygon(point, ring))) return "water";
  if (rings.buildings.some((ring) => pointInPolygon(point, ring)))
    return "building";
  return (
    rings.ground.find(({ ring }) => pointInPolygon(point, ring))?.kind ??
    "other"
  );
}

/** The shares of green, field, water and building among the ground samples within 60 m. */
function readGround(
  tiles: readonly DecodedTile[],
  listener: Listener,
): Pick<
  Surroundings,
  "greenShare" | "fieldShare" | "waterShare" | "buildingShare"
> {
  const rings = ringsNear(
    tiles,
    squareAround(listener.x, listener.y, GROUND_RADIUS_M),
  );
  const counts: Record<GroundSample, number> = {
    water: 0,
    building: 0,
    green: 0,
    field: 0,
    other: 0,
  };
  const steps = Math.floor(GROUND_RADIUS_M / GROUND_SAMPLE_STEP_M);
  let samples = 0;
  for (let column = -steps; column <= steps; column++)
    for (let row = -steps; row <= steps; row++) {
      const dx = column * GROUND_SAMPLE_STEP_M;
      const dy = row * GROUND_SAMPLE_STEP_M;
      if (Math.hypot(dx, dy) > GROUND_RADIUS_M) continue;
      counts[sampleAt([listener.x + dx, listener.y + dy], rings)]++;
      samples++;
    }
  return {
    greenShare: counts.green / samples,
    fieldShare: counts.field / samples,
    waterShare: counts.water / samples,
    buildingShare: counts.building / samples,
  };
}

/**
 * Reads what surrounds the listener from the loaded tiles and the live scene.
 *
 * @param tiles - The decoded tiles around the listener.
 * @param scene - The live people and cars.
 * @param listener - Where the ears are.
 * @returns The surroundings.
 */
export function readSurroundings(
  tiles: readonly DecodedTile[],
  scene: { peds: readonly SoundPoint[]; traffic: readonly TrafficSource[] },
  listener: Listener,
): Surroundings {
  const moving = scene.traffic.filter((car) => car.speedMps >= MOVING_MPS);
  const reach = squareAround(
    listener.x,
    listener.y,
    TRAFFIC_RADIUS_M + TILE_OVERLAP_M,
  );
  const near = tiles.filter((tile) => rectsIntersect(tile.rect, reach));
  return {
    ...readRoads(near, listener),
    movingCars: countWithin(moving, listener, TRAFFIC_RADIUS_M),
    peds: countWithin(scene.peds, listener, PEDS_RADIUS_M),
    trees: countTrees(near, listener),
    ...readGround(near, listener),
  };
}
