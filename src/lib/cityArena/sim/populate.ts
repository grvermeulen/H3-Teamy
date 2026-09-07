import type { Rect } from "../mapBuild/geometry";
import type { MapIndex, MapZone } from "../world/mapTypes";
import type { Point } from "../world/projection";
import { MAX_PEDS, MAX_TRAFFIC, MAX_VEHICLES } from "./limits";
import {
  PEDS_PER_ZONE,
  PED_RESPAWN_BATCH,
  PED_RESPAWN_INTERVAL_TICKS,
  alivePeds,
  spawnPeds,
} from "./peds";
import { placePickups } from "./pickups";
import { localPlayer, playersOf } from "./players";
import { nearestZone, type SpawnGraph } from "./spawn";
import {
  TRAFFIC_MAX_PER_ZONE,
  TRAFFIC_MIN_PER_ZONE,
  spawnTraffic,
  type DrivenCar,
} from "./traffic";
import type { ArenaState } from "./types";

/** Ticks between ambient traffic top-ups. */
export const TRAFFIC_TOP_UP_INTERVAL_TICKS = 150;

/** World data needed to populate one active zone. */
export type PopulationWorld = {
  index: MapIndex;
  graph: SpawnGraph;
  viewRect?: Rect;
};

function playerPoints(state: ArenaState): Point[] {
  return playersOf(state).map((player) => [player.x, player.y]);
}

function vehiclePoints(state: ArenaState): Point[] {
  return state.vehicles.map((vehicle) => [vehicle.x, vehicle.y]);
}

function clearPopulation(state: ArenaState): ArenaState {
  const driven = new Set(state.traffic.map((driver) => driver.vehicleId));
  const vehicles = state.vehicles.filter(
    (vehicle) =>
      vehicle.id === localPlayer(state).vehicleId ||
      (!driven.has(vehicle.id) && !vehicle.wrecked),
  );
  return { ...state, vehicles, peds: [], cops: [], pickups: [], traffic: [] };
}

function addDrivenCars(state: ArenaState, cars: DrivenCar[]): ArenaState {
  if (cars.length === 0) return state;
  return {
    ...state,
    vehicles: [...state.vehicles, ...cars.map((car) => car.vehicle)],
    traffic: [...state.traffic, ...cars.map((car) => car.driver)],
    nextId: state.nextId + cars.length,
  };
}

function spawnZoneTraffic(
  state: ArenaState,
  zone: MapZone,
  graph: SpawnGraph,
  random: () => number,
): ArenaState {
  const count =
    TRAFFIC_MIN_PER_ZONE +
    Math.floor(random() * (TRAFFIC_MAX_PER_ZONE - TRAFFIC_MIN_PER_ZONE + 1));
  return addDrivenCars(
    state,
    spawnTraffic(
      zone,
      graph,
      random,
      playerPoints(state),
      vehiclePoints(state),
      null,
      state.nextId,
      count,
    ),
  );
}

/** Clears the old active-zone population and places the new zone's pickups. */
export function populateZone(
  state: ArenaState,
  zone: MapZone,
  index: MapIndex,
  graph: SpawnGraph,
  random: () => number,
): ArenaState {
  const cleared = clearPopulation(state);
  const avoid = playerPoints(cleared);
  const pickups = placePickups(
    index,
    zone,
    graph,
    random,
    avoid,
    cleared.nextId,
  );
  const peds = spawnPeds(
    zone,
    graph,
    random,
    avoid,
    null,
    cleared.nextId + pickups.length,
    PEDS_PER_ZONE,
  );
  const populated: ArenaState = {
    ...cleared,
    activeZoneKey: zone.key,
    pickups,
    peds,
    nextId: cleared.nextId + pickups.length + peds.length,
  };
  return spawnZoneTraffic(populated, zone, graph, random);
}

/** Replaces missing pedestrians in small deterministic batches. */
export function topUpPeds(
  state: ArenaState,
  zone: MapZone,
  world: PopulationWorld,
  random: () => number,
): ArenaState {
  const room = Math.min(
    PEDS_PER_ZONE - alivePeds(state.peds).length,
    MAX_PEDS - state.peds.length,
    PED_RESPAWN_BATCH,
  );
  if (room <= 0) return state;
  const fresh = spawnPeds(
    zone,
    world.graph,
    random,
    playerPoints(state),
    world.viewRect ?? null,
    state.nextId,
    room,
  );
  if (fresh.length === 0) return state;
  return {
    ...state,
    peds: [...state.peds, ...fresh],
    nextId: state.nextId + fresh.length,
  };
}

/** Replaces missing ambient traffic one car at a time, up to the zone minimum. */
export function topUpTraffic(
  state: ArenaState,
  zone: MapZone,
  world: PopulationWorld,
  random: () => number,
): ArenaState {
  const ambient = state.traffic.filter(
    (driver) => driver.role === "traffic",
  ).length;
  if (
    ambient >= TRAFFIC_MIN_PER_ZONE ||
    state.traffic.length >= MAX_TRAFFIC ||
    state.vehicles.length >= MAX_VEHICLES
  )
    return state;
  return addDrivenCars(
    state,
    spawnTraffic(
      zone,
      world.graph,
      random,
      playerPoints(state),
      vehiclePoints(state),
      world.viewRect ?? null,
      state.nextId,
      1,
    ),
  );
}

/** Re-populates when the zone nearest the player changes. */
export function applyPopulation(
  state: ArenaState,
  world: PopulationWorld,
  tick: number,
  random: () => number,
): ArenaState {
  const [player] = playersOf(state);
  const zone = nearestZone(world.index, [player.x, player.y]);
  if (!zone) return state;
  if (zone.key !== state.activeZoneKey)
    return populateZone(state, zone, world.index, world.graph, random);
  let next = state;
  if (tick % PED_RESPAWN_INTERVAL_TICKS === 0)
    next = topUpPeds(next, zone, world, random);
  if (tick % TRAFFIC_TOP_UP_INTERVAL_TICKS === 0)
    next = topUpTraffic(next, zone, world, random);
  return next;
}
