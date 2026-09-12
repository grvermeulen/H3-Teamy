import { distancePointToSegment } from "../mapBuild/geometry";
import type { MapIndex, MapZone } from "../world/mapTypes";
import { fromUnits, type Point } from "../world/projection";
import {
  PARKING_ROAD_CLASSES,
  edgeLengthM,
  kerbOffsetM,
  railHeading,
  railPoint,
} from "../world/pavements";
import type { RoadGraph } from "../world/roadGraph";
import type { RoadGraphEdge } from "../world/roadGraph";
import {
  distanceToZoneEdge,
  pickSpawn,
  zoneCentreMetres,
  zoneRadiusMetres,
} from "../world/zone";
import { CAR_BODY_RADIUS_M } from "./collisions";
import { PLAYER_RADIUS_M } from "./player";
import type { RailPosition, VehicleKind, VehicleState } from "./types";
import { VEHICLE_COLOUR_COUNT, createVehicle } from "./vehicle";

/** Parked cars placed per zone at session start (scope decision 3). */
export const PARKED_CARS_PER_ZONE = 30;
/** Spacing of parking spots along a kerb. */
export const PARKING_INTERVAL_M = 40;
/** Minimum distance between two parked cars. */
export const MIN_CAR_SPACING_M = 12;
/** Minimum distance between a parked car and a point in the avoid list (the player spawn). */
export const MIN_CAR_TO_PLAYER_M = 8;
/** Extra room beyond bare contact between a respawning player and a parked car (m). */
const RESPAWN_CAR_MARGIN_M = 1;
/** Minimum distance a respawn point keeps from any intact vehicle, so players cannot respawn on a car. */
export const RESPAWN_CAR_CLEARANCE_M =
  CAR_BODY_RADIUS_M + PLAYER_RADIUS_M + RESPAWN_CAR_MARGIN_M;
/** Kinds parked cars are drawn from; police cars arrive with the cops, buses and tractors only drive. */
export const PARKED_CAR_KINDS: VehicleKind[] = [
  "compact",
  "sedan",
  "sport",
  "oldtimer",
  "van",
  "pickup",
];
/** Search radius when snapping a spawn node to the road graph for its heading. */
const ROAD_SNAP_M = 30;
/** Candidate scores within this distance of the best count as ties for the seeded tie-break. */
const TIE_TOLERANCE_M = 1;
const COIN_FLIP = 0.5;

/** The part of the road graph the spawner reads. */
export type SpawnGraph = Pick<
  RoadGraph,
  "nodes" | "edges" | "adjacency" | "nearestNode"
>;

/** Fisher–Yates shuffle driven by the seeded generator; returns a new array. */
export function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

/** Heading of the first road edge at the node nearest to `point`; east when no road is within reach. */
export function roadHeadingAt(graph: SpawnGraph, point: Point): number {
  const node = graph.nearestNode(point, ROAD_SNAP_M);
  if (node === null || graph.adjacency[node].length === 0) return 0;
  const edge = graph.edges[graph.adjacency[node][0]];
  const other = edge.a === node ? edge.b : edge.a;
  return Math.atan2(
    graph.nodes[other][1] - graph.nodes[node][1],
    graph.nodes[other][0] - graph.nodes[node][0],
  );
}

/** Spawn nodes of a zone in metres. */
function spawnNodesMetres(zone: MapZone): Point[] {
  return zone.spawnNodes.map(([x, y]) => [fromUnits(x), fromUnits(y)]);
}

/** True when `point` is at least `minimum` metres from every point in `others`. */
export function farFromAll(
  point: Point,
  others: Point[],
  minimum: number,
): boolean {
  return others.every(
    (other) => Math.hypot(other[0] - point[0], other[1] - point[1]) >= minimum,
  );
}

/** A kerb-side parking spot with a car centre and heading. */
export type ParkingSpot = { point: Point; heading: number };

/** True for road classes that may hold parked cars. */
export function isParkingEdge(edge: RoadGraphEdge): boolean {
  return PARKING_ROAD_CLASSES.includes(edge.roadClass);
}

/** Creates seeded parking spots every 40 m along one edge. */
export function edgeParkingSpots(
  graph: SpawnGraph,
  edgeIndex: number,
  random: () => number,
): ParkingSpot[] {
  const edge = graph.edges[edgeIndex];
  const length = edgeLengthM(graph, edgeIndex);
  const direction: 1 | -1 = random() < COIN_FLIP ? -1 : 1;
  const start = random() * PARKING_INTERVAL_M;
  const spots: ParkingSpot[] = [];
  for (let along = start; along < length; along += PARKING_INTERVAL_M) {
    const progress = along / length;
    const rail: RailPosition = {
      edge: edgeIndex,
      direction,
      edgeT: direction === 1 ? progress : 1 - progress,
      side: 1,
    };
    spots.push({
      point: railPoint(graph, rail, kerbOffsetM(edge.roadClass)),
      heading: railHeading(graph, rail),
    });
  }
  return spots;
}

/** Collects parking spots on parking-class edges inside a zone. */
export function zoneParkingSpots(
  graph: SpawnGraph,
  zone: MapZone,
  random: () => number,
): ParkingSpot[] {
  const centre = zoneCentreMetres(zone);
  const radius = zoneRadiusMetres(zone);
  const spots: ParkingSpot[] = [];
  graph.edges.forEach((edge, index) => {
    if (!isParkingEdge(edge)) return;
    const middleX = (graph.nodes[edge.a][0] + graph.nodes[edge.b][0]) / 2;
    const middleY = (graph.nodes[edge.a][1] + graph.nodes[edge.b][1]) / 2;
    if (Math.hypot(middleX - centre[0], middleY - centre[1]) > radius) return;
    spots.push(...edgeParkingSpots(graph, index, random));
  });
  return spots;
}

function pickParkingSpots(
  graph: SpawnGraph,
  zone: MapZone,
  random: () => number,
  avoid: Point[],
): ParkingSpot[] {
  const chosen: ParkingSpot[] = [];
  for (const spot of shuffle(zoneParkingSpots(graph, zone, random), random)) {
    if (chosen.length >= PARKED_CARS_PER_ZONE) break;
    if (!farFromAll(spot.point, avoid, MIN_CAR_TO_PLAYER_M)) continue;
    if (
      !farFromAll(
        spot.point,
        chosen.map((item) => item.point),
        MIN_CAR_SPACING_M,
      )
    )
      continue;
    chosen.push(spot);
  }
  return chosen;
}

/** Parks seeded cars along the kerbs of every zone's residential and service roads. */
export function spawnParkedCars(
  index: MapIndex,
  graph: SpawnGraph,
  random: () => number,
  avoid: Point[],
  firstId: number,
): VehicleState[] {
  const cars: VehicleState[] = [];
  for (const zone of index.zones) {
    for (const spot of pickParkingSpots(graph, zone, random, avoid)) {
      const kind =
        PARKED_CAR_KINDS[Math.floor(random() * PARKED_CAR_KINDS.length)];
      const colour = Math.floor(random() * VEHICLE_COLOUR_COUNT);
      cars.push(
        createVehicle(
          firstId + cars.length,
          kind,
          spot.point,
          spot.heading,
          colour,
        ),
      );
    }
  }
  return cars;
}

/** Smallest distance from `point` to any threat. */
function nearestThreatDistance(point: Point, threats: Point[]): number {
  return Math.min(
    ...threats.map((threat) =>
      Math.hypot(threat[0] - point[0], threat[1] - point[1]),
    ),
  );
}

/**
 * Spec §5 spawn choice: the node maximising the minimum distance to `threats`, ties (within
 * 1 m) broken by the seed; a seeded random node when there are no threats.
 */
export function chooseSpawnNode(
  zone: MapZone,
  threats: Point[],
  random: () => number,
): Point {
  const nodes = spawnNodesMetres(zone);
  if (threats.length === 0 || nodes.length === 0)
    return pickSpawn(zone, random);
  const scores = nodes.map((node) => nearestThreatDistance(node, threats));
  const best = Math.max(...scores);
  const ties = nodes.filter(
    (_, index) => scores[index] >= best - TIE_TOLERANCE_M,
  );
  return ties[Math.min(ties.length - 1, Math.floor(random() * ties.length))];
}

/**
 * Spawn node for a respawn: a seeded random node, skipping any within
 * `RESPAWN_CAR_CLEARANCE_M` of a point in `blockedBy` (spec §5: never respawn on a car) so a
 * respawning player cannot land on a parked or driven vehicle. Falls back to
 * {@link chooseSpawnNode}'s unfiltered pick when every node is blocked.
 */
export function chooseRespawnNode(
  zone: MapZone,
  blockedBy: Point[],
  random: () => number,
): Point {
  const clear = spawnNodesMetres(zone).filter((node) =>
    farFromAll(node, blockedBy, RESPAWN_CAR_CLEARANCE_M),
  );
  if (clear.length === 0) return chooseSpawnNode(zone, [], random);
  return clear[Math.min(clear.length - 1, Math.floor(random() * clear.length))];
}

/** The zone whose edge is nearest to `point`; used to respawn after dying outside every disc. */
export function nearestZone(index: MapIndex, point: Point): MapZone | null {
  let best: MapZone | null = null;
  let bestDistance = Infinity;
  for (const zone of index.zones) {
    const distance = distanceToZoneEdge(zone, point);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = zone;
    }
  }
  return best;
}

/** The edges among `edges` whose road segment passes within `radiusM` of `centre`. */
export function edgesNear(
  graph: Pick<RoadGraph, "nodes" | "edges">,
  edges: number[],
  centre: Point,
  radiusM: number,
): number[] {
  return edges.filter((index) => {
    const edge = graph.edges[index];
    return (
      distancePointToSegment(
        centre,
        graph.nodes[edge.a],
        graph.nodes[edge.b],
      ) <= radiusM
    );
  });
}

/**
 * A seeded fraction along `edge` that lies inside the disc of `radiusM` around `centre`, or null
 * when the segment misses the disc. Clipping the segment to the disc first means a long road
 * through the disc is sampled only where it passes the player, instead of anywhere along it.
 */
export function edgeTWithin(
  graph: Pick<RoadGraph, "nodes" | "edges">,
  edge: number,
  centre: Point,
  radiusM: number,
  random: () => number,
): number | null {
  const start = graph.nodes[graph.edges[edge].a];
  const end = graph.nodes[graph.edges[edge].b];
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const fx = start[0] - centre[0];
  const fy = start[1] - centre[1];
  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radiusM * radiusM;
  if (a === 0) return c <= 0 ? 0 : null;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const low = Math.max(0, (-b - root) / (2 * a));
  const high = Math.min(1, (-b + root) / (2 * a));
  if (low > high) return null;
  return low + random() * (high - low);
}

/** A seeded edge and fraction near `centre`: one of `edges` (all pre-filtered by {@link edgesNear}) clipped to the disc. */
export function pickEdgeTNear(
  graph: Pick<RoadGraph, "nodes" | "edges">,
  edges: number[],
  centre: Point,
  radiusM: number,
  random: () => number,
): { edge: number; edgeT: number } | null {
  if (edges.length === 0) return null;
  const edge =
    edges[Math.min(edges.length - 1, Math.floor(random() * edges.length))];
  const edgeT = edgeTWithin(graph, edge, centre, radiusM, random);
  return edgeT === null ? null : { edge, edgeT };
}
