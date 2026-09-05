import type { MapIndex, MapZone } from "../world/mapTypes";
import { fromUnits, type Point } from "../world/projection";
import type { RoadGraph } from "../world/roadGraph";
import { distanceToZoneEdge, pickSpawn } from "../world/zone";
import { CAR_BODY_RADIUS_M } from "./collisions";
import { PLAYER_RADIUS_M } from "./player";
import type { VehicleKind, VehicleState } from "./types";
import { VEHICLE_COLOUR_COUNT, createVehicle } from "./vehicle";

/** Parked cars placed per zone at session start (scope decision 3). */
export const PARKED_CARS_PER_ZONE = 8;
/** Minimum distance between two parked cars. */
export const MIN_CAR_SPACING_M = 12;
/** Minimum distance between a parked car and a point in the avoid list (the player spawn). */
export const MIN_CAR_TO_PLAYER_M = 8;
/** Extra room beyond bare contact between a respawning player and a parked car (m). */
const RESPAWN_CAR_MARGIN_M = 1;
/** Minimum distance a respawn point keeps from any intact vehicle, so players cannot respawn on a car. */
export const RESPAWN_CAR_CLEARANCE_M =
  CAR_BODY_RADIUS_M + PLAYER_RADIUS_M + RESPAWN_CAR_MARGIN_M;
/** Kinds parked cars are drawn from; police cars arrive with the cops in Plan 4b. */
export const PARKED_CAR_KINDS: VehicleKind[] = ["compact", "sedan", "sport"];
/** Search radius when snapping a spawn node to the road graph for its heading. */
const ROAD_SNAP_M = 30;
/** Candidate scores within this distance of the best count as ties for the seeded tie-break. */
const TIE_TOLERANCE_M = 1;

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
function farFromAll(point: Point, others: Point[], minimum: number): boolean {
  return others.every(
    (other) => Math.hypot(other[0] - point[0], other[1] - point[1]) >= minimum,
  );
}

/** Up to PARKED_CARS_PER_ZONE nodes of one zone in seeded order, honouring spacing and the avoid list. */
function pickParkingNodes(
  zone: MapZone,
  random: () => number,
  avoid: Point[],
): Point[] {
  const chosen: Point[] = [];
  for (const node of shuffle(spawnNodesMetres(zone), random)) {
    if (chosen.length >= PARKED_CARS_PER_ZONE) break;
    if (!farFromAll(node, avoid, MIN_CAR_TO_PLAYER_M)) continue;
    if (!farFromAll(node, chosen, MIN_CAR_SPACING_M)) continue;
    chosen.push(node);
  }
  return chosen;
}

/** Parks seeded cars on spawn nodes of every zone, headed along the nearest road; ids count up from `firstId`. */
export function spawnParkedCars(
  index: MapIndex,
  graph: SpawnGraph,
  random: () => number,
  avoid: Point[],
  firstId: number,
): VehicleState[] {
  const cars: VehicleState[] = [];
  for (const zone of index.zones) {
    for (const node of pickParkingNodes(zone, random, avoid)) {
      const kind =
        PARKED_CAR_KINDS[Math.floor(random() * PARKED_CAR_KINDS.length)];
      const colour = Math.floor(random() * VEHICLE_COLOUR_COUNT);
      cars.push(
        createVehicle(
          firstId + cars.length,
          kind,
          node,
          roadHeadingAt(graph, node),
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
