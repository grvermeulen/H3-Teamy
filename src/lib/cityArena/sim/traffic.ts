import { pointInRect, type Rect } from "../mapBuild/geometry";
import type { MapZone, RoadClass } from "../world/mapTypes";
import {
  railEndNode,
  railHeading,
  railPoint,
  type RailGraph,
} from "../world/pavements";
import type { Point } from "../world/projection";
import type { RoadGraph, RoadGraphEdge } from "../world/roadGraph";
import { zoneCentreMetres, zoneRadiusMetres } from "../world/zone";
import { isDead } from "./damage";
import {
  driveControls,
  laneOffsetM,
  laneTarget,
  obstacleAhead,
} from "./driver";
import { alivePeds } from "./peds";
import { driverPlayer, playersOf } from "./players";
import {
  MIN_CAR_SPACING_M,
  edgesNear,
  farFromAll,
  pickEdgeTNear,
} from "./spawn";
import type {
  ArenaState,
  DriverState,
  RailPosition,
  VehicleKind,
  VehicleState,
} from "./types";
import {
  VEHICLE_COLOUR_COUNT,
  createVehicle,
  type VehicleControls,
} from "./vehicle";

/** Road classes ambient traffic drives. */
export const TRAFFIC_ROAD_CLASSES: RoadClass[] = [
  "primary",
  "secondary",
  "tertiary",
  "unclassified",
];
/** Road classes any AI driver may route over. */
export const AI_ROAD_CLASSES: RoadClass[] = [
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "unclassified",
  "residential",
  "living_street",
];
/** Fewest ambient cars around the players of a populated zone; the top-up refills to this. */
export const TRAFFIC_MIN_PER_ZONE = 14;
/** Most ambient cars around the players of a populated zone. */
export const TRAFFIC_MAX_PER_ZONE = 20;
/** New ambient cars appear within this distance of the player they are spawned around. */
export const TRAFFIC_SPAWN_RADIUS_M = 220;
/** An ambient car farther than this from every player, and off screen, is recycled. */
export const TRAFFIC_RECYCLE_DISTANCE_M = 320;
/** Slowest ambient cruise speed. */
export const TRAFFIC_MIN_SPEED_MPS = 8;
/** Fastest ambient cruise speed. */
export const TRAFFIC_MAX_SPEED_MPS = 12;
/** Distance beyond the bumper watched for obstacles. */
export const TRAFFIC_LOOK_AHEAD_M = 10;
/** Half-width of the obstacle box. */
export const TRAFFIC_LOOK_AHEAD_HALF_WIDTH_M = 2.2;
/** Distance from a target node at which the driver advances its path. */
export const NODE_REACH_M = 4;
/** Nodes a traffic driver keeps planned ahead. */
export const TRAFFIC_PATH_AHEAD = 2;
/** Fresh traffic keeps this distance from players. */
export const TRAFFIC_SPAWN_MIN_FROM_PLAYER_M = 30;
/** Kinds ambient traffic is drawn from where a road class names no pool of its own. */
export const TRAFFIC_KINDS: VehicleKind[] = [
  "compact",
  "sedan",
  "van",
  "pickup",
];
/**
 * Kinds by road class: buses keep to through-roads, oldtimers to the quieter ones, and a sport
 * car is never ambient traffic — it is the prize, parked.
 */
export const TRAFFIC_KINDS_BY_CLASS: Partial<Record<RoadClass, VehicleKind[]>> =
  {
    primary: ["compact", "sedan", "van", "pickup", "bus"],
    secondary: ["compact", "sedan", "van", "pickup", "bus"],
    tertiary: ["compact", "sedan", "oldtimer", "van", "pickup", "bus"],
    unclassified: ["compact", "sedan", "oldtimer", "van", "pickup"],
  };
/** Chance that a car on an unclassified road — the countryside's — is a tractor. */
export const TRACTOR_CHANCE = 0.3;
/** The road class whose traffic includes tractors. */
const TRACTOR_ROAD_CLASS: RoadClass = "unclassified";
const SPAWN_ATTEMPTS = 20;
const COIN_FLIP = 0.5;

/** What AI drivers read from the world. */
export type DriverWorld = { graph: RoadGraph; viewRect?: Rect };
/** A car paired with its AI driver. */
export type DrivenCar = { vehicle: VehicleState; driver: DriverState };
/** Updated drivers and controls for one tick. */
export type DriverStep = {
  traffic: DriverState[];
  controls: Map<number, VehicleControls>;
};
/** A point police cars charge while within range. */
export type ChaseTarget = { point: Point; rangeM: number };

/** True for through-road edges used by ambient traffic. */
export function isTrafficEdge(edge: RoadGraphEdge): boolean {
  return TRAFFIC_ROAD_CLASSES.includes(edge.roadClass);
}

/** True for edges any AI car may use. */
export function isAiEdge(edge: RoadGraphEdge): boolean {
  return AI_ROAD_CLASSES.includes(edge.roadClass);
}

function otherEnd(edge: RoadGraphEdge, node: number): number {
  return edge.a === node ? edge.b : edge.a;
}

function leavesNode(edge: RoadGraphEdge, node: number): boolean {
  return edge.a === node || !edge.oneway;
}

/** Traffic-class edges whose midpoint lies inside a radius. */
export function trafficEdgesWithin(
  graph: RailGraph,
  centre: Point,
  radiusM: number,
): number[] {
  const edges: number[] = [];
  graph.edges.forEach((edge, index) => {
    if (!isTrafficEdge(edge)) return;
    const middleX = (graph.nodes[edge.a][0] + graph.nodes[edge.b][0]) / 2;
    const middleY = (graph.nodes[edge.a][1] + graph.nodes[edge.b][1]) / 2;
    if (Math.hypot(middleX - centre[0], middleY - centre[1]) <= radiusM)
      edges.push(index);
  });
  return edges;
}

/** Chooses a seeded next traffic node, avoiding a U-turn when possible. */
export function nextTrafficNode(
  graph: RailGraph,
  node: number,
  arrivedFrom: number | null,
  random: () => number,
): number | null {
  const leaving = graph.adjacency[node].filter((edgeIndex) => {
    const edge = graph.edges[edgeIndex];
    return isTrafficEdge(edge) && leavesNode(edge, node);
  });
  const onward = leaving.filter(
    (edgeIndex) => otherEnd(graph.edges[edgeIndex], node) !== arrivedFrom,
  );
  const options = onward.length > 0 ? onward : leaving;
  if (options.length === 0) return null;
  const edgeIndex =
    options[
      Math.min(options.length - 1, Math.floor(random() * options.length))
    ];
  return otherEnd(graph.edges[edgeIndex], node);
}

function nodeBefore(path: number[], fromNode: number): number | null {
  if (path.length > 1) return path[path.length - 2];
  return path.length === 1 ? fromNode : null;
}

/** Extends a traffic path with seeded turns until two nodes are ahead. */
export function extendPath(
  graph: RailGraph,
  driver: DriverState,
  random: () => number,
): DriverState {
  if (driver.fromNode === null) return driver;
  const path = [...driver.path];
  while (path.length < TRAFFIC_PATH_AHEAD) {
    const last = path.length > 0 ? path[path.length - 1] : driver.fromNode;
    const next = nextTrafficNode(
      graph,
      last,
      nodeBefore(path, driver.fromNode),
      random,
    );
    if (next === null) break;
    path.push(next);
  }
  return path.length === driver.path.length ? driver : { ...driver, path };
}

/** Lane offset of the traffic edge joining two nodes. */
export function laneOffsetBetween(
  graph: RailGraph,
  from: number,
  to: number,
): number {
  for (const edgeIndex of graph.adjacency[from]) {
    const edge = graph.edges[edgeIndex];
    if (otherEnd(edge, from) === to && isTrafficEdge(edge))
      return laneOffsetM(edge.roadClass);
  }
  return 0;
}

/** Target point for the next path node, shifted into the driving lane. */
export function driverTarget(
  graph: RailGraph,
  driver: DriverState,
): Point | null {
  if (driver.fromNode === null || driver.path.length === 0) return null;
  const next = driver.path[0];
  return laneTarget(
    graph,
    driver.fromNode,
    next,
    laneOffsetBetween(graph, driver.fromNode, next),
  );
}

/** Drops path nodes reached by the car. */
export function advanceDriver(
  graph: RailGraph,
  driver: DriverState,
  vehicle: VehicleState,
): DriverState {
  let current = driver;
  for (;;) {
    const target = driverTarget(graph, current);
    if (!target) return current;
    if (Math.hypot(target[0] - vehicle.x, target[1] - vehicle.y) > NODE_REACH_M)
      return current;
    current = {
      ...current,
      fromNode: current.path[0],
      path: current.path.slice(1),
    };
  }
}

/** Creates a rolling traffic car in its lane with an initial driver path. */
export function createTrafficCar(
  id: number,
  graph: RailGraph,
  rail: RailPosition,
  kind: VehicleKind,
  colour: number,
  cruiseMps: number,
): DrivenCar {
  const edge = graph.edges[rail.edge];
  const heading = railHeading(graph, rail);
  const lane = railPoint(
    graph,
    { ...rail, side: 1 },
    laneOffsetM(edge.roadClass),
  );
  const vehicle: VehicleState = {
    ...createVehicle(id, kind, lane, heading, colour),
    velocityX: Math.cos(heading) * cruiseMps,
    velocityY: Math.sin(heading) * cruiseMps,
  };
  return {
    vehicle,
    driver: {
      vehicleId: id,
      role: "traffic",
      cruiseMps,
      fromNode: rail.direction === 1 ? edge.a : edge.b,
      path: [railEndNode(graph, rail)],
      repathTick: 0,
    },
  };
}

/** Which way a spawned car drives an edge: with a one-way, either way otherwise. */
function trafficDirection(
  graph: RailGraph,
  edge: number,
  random: () => number,
): 1 | -1 {
  return graph.edges[edge].oneway || random() >= COIN_FLIP ? 1 : -1;
}

/** A seeded rail anywhere on one of `edges`, in the right-hand lane. */
function trafficRail(
  graph: RailGraph,
  edges: number[],
  random: () => number,
): RailPosition {
  const edge =
    edges[Math.min(edges.length - 1, Math.floor(random() * edges.length))];
  const direction = trafficDirection(graph, edge, random);
  return { edge, direction, edgeT: random(), side: 1 };
}

/** Through-road edges a car may spawn on, grouped by the point it is spawned around. */
type TrafficPool = { centre: Point | null; edges: number[] };

/** The through-roads to spawn on: the zone's, or those near each of `around` when given. */
function trafficPools(
  zone: MapZone,
  graph: RailGraph,
  around: Point[],
): TrafficPool[] {
  const zoneEdges = trafficEdgesWithin(
    graph,
    zoneCentreMetres(zone),
    zoneRadiusMetres(zone),
  );
  if (around.length === 0) return [{ centre: null, edges: zoneEdges }];
  return around
    .map((centre) => ({
      centre,
      edges: edgesNear(graph, zoneEdges, centre, TRAFFIC_SPAWN_RADIUS_M),
    }))
    .filter((pool) => pool.edges.length > 0);
}

/** A seeded rail from a pool: anywhere on a zone-wide pool, clipped to the disc on a player-centred one. */
function railFromPool(
  graph: RailGraph,
  pool: TrafficPool,
  random: () => number,
): RailPosition | null {
  if (pool.centre === null) return trafficRail(graph, pool.edges, random);
  const near = pickEdgeTNear(
    graph,
    pool.edges,
    pool.centre,
    TRAFFIC_SPAWN_RADIUS_M,
    random,
  );
  if (!near) return null;
  const direction = trafficDirection(graph, near.edge, random);
  // `edgeT` on a rail runs from the directed start, so a reversed rail mirrors the fraction.
  return {
    edge: near.edge,
    edgeT: direction === 1 ? near.edgeT : 1 - near.edgeT,
    direction,
    side: 1,
  };
}

/**
 * A seeded kind for ambient traffic on a road of `roadClass`.
 *
 * @param roadClass - The road the car spawns on.
 * @param random - The seeded generator.
 * @returns The kind.
 */
export function pickTrafficKind(
  roadClass: RoadClass,
  random: () => number,
): VehicleKind {
  if (roadClass === TRACTOR_ROAD_CLASS && random() < TRACTOR_CHANCE)
    return "tractor";
  const pool = TRAFFIC_KINDS_BY_CLASS[roadClass] ?? TRAFFIC_KINDS;
  return pool[Math.floor(random() * pool.length)] ?? "compact";
}

/**
 * Spawns seeded ambient cars on through-roads, spaced from players, cars and the view. With
 * `around` given, each car appears within {@link TRAFFIC_SPAWN_RADIUS_M} of one of those points —
 * the players — so the traffic drives where they are rather than over the whole zone.
 */
export function spawnTraffic(
  zone: MapZone,
  graph: RailGraph,
  random: () => number,
  avoid: Point[],
  occupied: Point[],
  viewRect: Rect | null,
  firstId: number,
  count: number,
  around: Point[] = [],
): DrivenCar[] {
  const pools = trafficPools(zone, graph, around);
  const cars: DrivenCar[] = [];
  if (pools.length === 0) return cars;
  const placed: Point[] = [...occupied];
  for (let attempt = 0; attempt < count * SPAWN_ATTEMPTS; attempt++) {
    if (cars.length >= count) break;
    const pool =
      pools[Math.min(pools.length - 1, Math.floor(random() * pools.length))];
    const rail = railFromPool(graph, pool, random);
    if (!rail) continue;
    const kind = pickTrafficKind(graph.edges[rail.edge].roadClass, random);
    const colour = Math.floor(random() * VEHICLE_COLOUR_COUNT);
    const cruise =
      TRAFFIC_MIN_SPEED_MPS +
      random() * (TRAFFIC_MAX_SPEED_MPS - TRAFFIC_MIN_SPEED_MPS);
    const car = createTrafficCar(
      firstId + cars.length,
      graph,
      rail,
      kind,
      colour,
      cruise,
    );
    const point: Point = [car.vehicle.x, car.vehicle.y];
    if (!farFromAll(point, avoid, TRAFFIC_SPAWN_MIN_FROM_PLAYER_M)) continue;
    if (!farFromAll(point, placed, MIN_CAR_SPACING_M)) continue;
    if (viewRect && pointInRect(point, viewRect)) continue;
    cars.push(car);
    placed.push(point);
  }
  return cars;
}

/** Points an AI driver must avoid; police ignore the player's car so it can ram. */
export function obstaclePoints(
  state: ArenaState,
  driver: DriverState,
): Point[] {
  const points: Point[] = [];
  for (const vehicle of state.vehicles) {
    if (vehicle.id === driver.vehicleId) continue;
    if (driver.role === "police" && driverPlayer(state, vehicle.id)) continue;
    points.push([vehicle.x, vehicle.y]);
  }
  if (driver.role !== "police") {
    for (const ped of alivePeds(state.peds)) points.push([ped.x, ped.y]);
    for (const cop of state.cops)
      if (cop.diedAtTick === null) points.push([cop.x, cop.y]);
  }
  if (driver.role === "police") return points;
  for (const player of playersOf(state))
    if (!isDead(player) && player.vehicleId === null)
      points.push([player.x, player.y]);
  return points;
}

function drivenVehicle(
  state: ArenaState,
  driver: DriverState,
): VehicleState | null {
  const vehicle = state.vehicles.find(
    (candidate) => candidate.id === driver.vehicleId,
  );
  return vehicle && !vehicle.wrecked ? vehicle : null;
}

function ramPoint(
  driver: DriverState,
  vehicle: VehicleState,
  chase: ChaseTarget | null,
): Point | null {
  if (driver.role !== "police" || !chase) return null;
  const distance = Math.hypot(
    chase.point[0] - vehicle.x,
    chase.point[1] - vehicle.y,
  );
  // Start the final approach before the ram radius so a routed police car does
  // not brake at the last road node and get stranded just outside the target.
  return distance <= Math.max(chase.rangeM, 80) ? chase.point : null;
}

/** Steps every AI driver and returns the controls for its car. */
export function stepDrivers(
  state: ArenaState,
  world: DriverWorld,
  random: () => number,
  chase: ChaseTarget | null,
): DriverStep {
  const traffic: DriverState[] = [];
  const controls = new Map<number, VehicleControls>();
  for (const driver of state.traffic) {
    const vehicle = drivenVehicle(state, driver);
    if (!vehicle) continue;
    let next = advanceDriver(world.graph, driver, vehicle);
    if (next.role === "traffic") next = extendPath(world.graph, next, random);
    traffic.push(next);
    const target =
      ramPoint(next, vehicle, chase) ?? driverTarget(world.graph, next);
    if (!target) continue;
    const blocked = obstacleAhead(
      vehicle,
      obstaclePoints(state, next),
      TRAFFIC_LOOK_AHEAD_M,
      TRAFFIC_LOOK_AHEAD_HALF_WIDTH_M,
    );
    controls.set(
      vehicle.id,
      driveControls(vehicle, target, next.cruiseMps, blocked),
    );
  }
  return { traffic, controls };
}
