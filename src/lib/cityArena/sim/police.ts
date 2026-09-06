import { pointInRect, type Rect } from "../mapBuild/geometry";
import { pathTo } from "../world/pathFollow";
import type { Point } from "../world/projection";
import type { RoadGraph } from "../world/roadGraph";
import { COP_SPAWN_MAX_M, COP_SPAWN_MIN_M, nodesWithin } from "./cops";
import { MAX_TRAFFIC, MAX_VEHICLES } from "./limits";
import { driverPlayer, playersOf } from "./players";
import {
  MIN_CAR_SPACING_M,
  farFromAll,
  roadHeadingAt,
  shuffle,
  type SpawnGraph,
} from "./spawn";
import { isAiEdge, type ChaseTarget, type DrivenCar } from "./traffic";
import type {
  ArenaPlayerState,
  ArenaState,
  DriverState,
  VehicleState,
} from "./types";
import { createVehicle } from "./vehicle";
import { currentWantedLevel, wantedTarget } from "./wanted";

/** Police cars per wanted level (spec §5: one at two stars, two at three). */
export const POLICE_CARS_PER_LEVEL: readonly number[] = [0, 0, 1, 2];
/** Chase speed of a police car. */
export const POLICE_CHASE_MPS = 18;
/** Within this distance a police car drives straight at the wanted player to ram. */
export const POLICE_RAM_RANGE_M = 25;
/** Police cars re-plan their route every this many ticks. */
export const POLICE_REPATH_TICKS = 30;
/** How far a police car looks for a road node when routing. */
export const POLICE_PATH_SNAP_M = 80;
/** A driverless police car farther than this from every player, and out of view, is towed away. */
export const POLICE_TOW_DISTANCE_M = 150;
/** Body colour index of police cars. */
export const POLICE_COLOUR = 5;

/** What the police manager reads from the world. */
export type PoliceWorld = { graph: RoadGraph; viewRect?: Rect };

/** The police drivers among the AI drivers. */
export function policeDrivers(traffic: DriverState[]): DriverState[] {
  return traffic.filter((driver) => driver.role === "police");
}

/** The ram order for police cars: charge the wanted player within 25 m. */
export function policeChase(state: ArenaState): ChaseTarget | null {
  const target = wantedTarget(state);
  return target
    ? { point: [target.x, target.y], rangeM: POLICE_RAM_RANGE_M }
    : null;
}

/** True when a road an AI car may drive meets the node. */
function hasDrivableRoad(graph: RoadGraph, node: number): boolean {
  return graph.adjacency[node].some((edgeIndex) =>
    isAiEdge(graph.edges[edgeIndex]),
  );
}

/** Seeded spawn points for police cars: drivable road nodes 60–120 m from `around`, outside `viewRect`. */
export function policeSpawnPoints(
  graph: RoadGraph,
  around: Point,
  viewRect: Rect | null,
  random: () => number,
): Point[] {
  const points = nodesWithin(graph, around, COP_SPAWN_MIN_M, COP_SPAWN_MAX_M)
    .filter((node) => hasDrivableRoad(graph, node))
    .map((node) => graph.nodes[node])
    .filter((point) => !viewRect || !pointInRect(point, viewRect));
  return shuffle(points, random);
}

/** A police car at rest at `position`, headed along the nearest road. */
export function createPoliceCar(
  id: number,
  graph: SpawnGraph,
  position: Point,
  tick: number,
): DrivenCar {
  const vehicle = createVehicle(
    id,
    "police",
    position,
    roadHeadingAt(graph, position),
    POLICE_COLOUR,
  );
  const driver: DriverState = {
    vehicleId: id,
    role: "police",
    cruiseMps: POLICE_CHASE_MPS,
    fromNode: graph.nearestNode(position, POLICE_PATH_SNAP_M),
    path: [],
    repathTick: tick,
  };
  return { vehicle, driver };
}

/** A police driver's route refreshed when due, keeping service roads out of pursuit routes. */
export function replanPolice(
  driver: DriverState,
  vehicle: VehicleState,
  target: Point,
  graph: RoadGraph,
  tick: number,
): DriverState {
  if (tick < driver.repathTick && driver.path.length > 0) return driver;
  const at: Point = [vehicle.x, vehicle.y];
  const fromNode = graph.nearestNode(at, POLICE_PATH_SNAP_M);
  const route =
    pathTo(graph, at, target, POLICE_PATH_SNAP_M, {
      respectOneway: true,
      allowEdge: isAiEdge,
    }) ?? [];
  return {
    ...driver,
    fromNode,
    path: route[0] === fromNode ? route.slice(1) : route,
    repathTick: tick + POLICE_REPATH_TICKS,
  };
}

/** Refreshes every police driver's route toward the wanted player. */
function replanAll(
  state: ArenaState,
  target: ArenaPlayerState,
  graph: RoadGraph,
  tick: number,
): ArenaState {
  let changed = false;
  const traffic = state.traffic.map((driver) => {
    if (driver.role !== "police") return driver;
    const vehicle = state.vehicles.find(
      (candidate) => candidate.id === driver.vehicleId,
    );
    if (!vehicle) return driver;
    const planned = replanPolice(
      driver,
      vehicle,
      [target.x, target.y],
      graph,
      tick,
    );
    if (planned !== driver) changed = true;
    return planned;
  });
  return changed ? { ...state, traffic } : state;
}

/** The AI drivers without the police; their cars stay where they are. */
function releaseDrivers(state: ArenaState): ArenaState {
  const traffic = state.traffic.filter((driver) => driver.role !== "police");
  return traffic.length === state.traffic.length
    ? state
    : { ...state, traffic };
}

/** True when a police car may be towed. */
function towable(
  state: ArenaState,
  vehicle: VehicleState,
  viewRect: Rect | null,
): boolean {
  if (vehicle.kind !== "police" || driverPlayer(state, vehicle.id))
    return false;
  if (state.traffic.some((driver) => driver.vehicleId === vehicle.id))
    return false;
  if (viewRect && pointInRect([vehicle.x, vehicle.y], viewRect)) return false;
  return playersOf(state).every(
    (player) =>
      Math.hypot(player.x - vehicle.x, player.y - vehicle.y) >
      POLICE_TOW_DISTANCE_M,
  );
}

/** Removes towable police cars. */
function towPoliceCars(state: ArenaState, viewRect: Rect | null): ArenaState {
  const vehicles = state.vehicles.filter(
    (vehicle) => !towable(state, vehicle, viewRect),
  );
  return vehicles.length === state.vehicles.length
    ? state
    : { ...state, vehicles };
}

/** Spawns the police cars the wanted level still lacks. */
function spawnMissingPoliceCars(
  state: ArenaState,
  target: ArenaPlayerState,
  level: number,
  world: PoliceWorld,
  tick: number,
  random: () => number,
): ArenaState {
  const wantedCars = POLICE_CARS_PER_LEVEL[level] ?? 0;
  const activePoliceCars = state.vehicles.filter(
    (vehicle) => vehicle.kind === "police" && !vehicle.wrecked,
  ).length;
  const missing = wantedCars - activePoliceCars;
  const room = Math.min(
    missing,
    MAX_TRAFFIC - state.traffic.length,
    MAX_VEHICLES - state.vehicles.length,
  );
  if (room <= 0) return state;
  const occupied: Point[] = state.vehicles.map((vehicle) => [
    vehicle.x,
    vehicle.y,
  ]);
  const cars: DrivenCar[] = [];
  const points = policeSpawnPoints(
    world.graph,
    [target.x, target.y],
    world.viewRect ?? null,
    random,
  );
  for (const point of points) {
    if (cars.length >= room) break;
    if (!farFromAll(point, occupied, MIN_CAR_SPACING_M)) continue;
    cars.push(
      createPoliceCar(state.nextId + cars.length, world.graph, point, tick),
    );
    occupied.push(point);
  }
  if (cars.length === 0) return state;
  return {
    ...state,
    vehicles: [...state.vehicles, ...cars.map((car) => car.vehicle)],
    traffic: [...state.traffic, ...cars.map((car) => car.driver)],
    nextId: state.nextId + cars.length,
  };
}

/** Keeps police cars in line with wanted level, releasing and towing them when calm. */
export function managePoliceCars(
  state: ArenaState,
  world: PoliceWorld,
  tick: number,
  random: () => number,
): ArenaState {
  const target = wantedTarget(state);
  if (!target)
    return towPoliceCars(releaseDrivers(state), world.viewRect ?? null);
  const level = currentWantedLevel(state);
  const routed = replanAll(state, target, world.graph, tick);
  return spawnMissingPoliceCars(routed, target, level, world, tick, random);
}
