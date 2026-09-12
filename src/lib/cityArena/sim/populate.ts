import { pointInRect, type Rect } from "../mapBuild/geometry";
import type { MapIndex, MapZone } from "../world/mapTypes";
import type { Point } from "../world/projection";
import { MAX_PEDS, MAX_TRAFFIC, MAX_VEHICLES } from "./limits";
import {
  PEDS_PER_ZONE,
  PED_RESPAWN_BATCH,
  PED_RESPAWN_INTERVAL_TICKS,
  alivePeds,
  recyclePeds,
  spawnPeds,
} from "./peds";
import { placePickups } from "./pickups";
import { orderedPlayers, playersOf } from "./players";
import { farFromAll, nearestZone, type SpawnGraph } from "./spawn";
import { findZoneByKey } from "../world/zone";
import {
  TRAFFIC_MAX_PER_ZONE,
  TRAFFIC_MIN_PER_ZONE,
  TRAFFIC_RECYCLE_DISTANCE_M,
  spawnTraffic,
  type DrivenCar,
} from "./traffic";
import type { ArenaState } from "./types";

/**
 * Ticks between ambient traffic top-ups. One second: a car that drove out of range is recycled
 * and must be back near the players before the street looks empty.
 */
export const TRAFFIC_TOP_UP_INTERVAL_TICKS = 30;

/** World data needed to populate one active zone. */
export type PopulationWorld = {
  index: MapIndex;
  graph: SpawnGraph;
  viewRect?: Rect;
};

/** Where every player stands, dead or alive: what fresh spawns keep their distance from. */
function playerPoints(state: ArenaState): Point[] {
  return playersOf(state).map((player) => [player.x, player.y]);
}

/**
 * Where the population is kept: around the living players, or around everybody while all of them
 * are dead, so a respawn lands in a street that is already populated.
 */
function anchorPoints(state: ArenaState): Point[] {
  const living = playersOf(state).filter(
    (player) => player.diedAtTick === null,
  );
  return (living.length > 0 ? living : playersOf(state)).map((player) => [
    player.x,
    player.y,
  ]);
}

/** Where every car sits, so fresh traffic is not spawned into one. */
function vehiclePoints(state: ArenaState): Point[] {
  return state.vehicles.map((vehicle) => [vehicle.x, vehicle.y]);
}

/** Drops the old zone's people, traffic and pickups, keeping parked cars and any car a player drives. */
function clearPopulation(state: ArenaState): ArenaState {
  const driven = new Set(state.traffic.map((driver) => driver.vehicleId));
  // Any car with a player at the wheel survives the clear-out, not just the local player's:
  // clearing a zone must never delete the car somebody else is driving out of it.
  const occupied = new Set(
    playersOf(state)
      .map((player) => player.vehicleId)
      .filter((id): id is number => id !== null),
  );
  const vehicles = state.vehicles.filter(
    (vehicle) =>
      occupied.has(vehicle.id) || (!driven.has(vehicle.id) && !vehicle.wrecked),
  );
  return { ...state, vehicles, peds: [], cops: [], pickups: [], traffic: [] };
}

/** Appends spawned cars and their drivers, advancing the id counter. */
function addDrivenCars(state: ArenaState, cars: DrivenCar[]): ArenaState {
  if (cars.length === 0) return state;
  return {
    ...state,
    vehicles: [...state.vehicles, ...cars.map((car) => car.vehicle)],
    traffic: [...state.traffic, ...cars.map((car) => car.driver)],
    nextId: state.nextId + cars.length,
  };
}

/** Spawns a seeded number of ambient cars, between the zone minimum and maximum, around the players. */
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
      anchorPoints(state),
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
    anchorPoints(cleared),
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

/**
 * Recycles pedestrians the players left behind and replaces missing ones near them, in small
 * deterministic batches.
 */
export function topUpPeds(
  state: ArenaState,
  zone: MapZone,
  world: PopulationWorld,
  random: () => number,
): ArenaState {
  const anchors = anchorPoints(state);
  const peds = recyclePeds(state.peds, anchors, world.viewRect ?? null);
  const recycled = peds === state.peds ? state : { ...state, peds };
  const room = Math.min(
    PEDS_PER_ZONE - alivePeds(recycled.peds).length,
    MAX_PEDS - recycled.peds.length,
    PED_RESPAWN_BATCH,
  );
  if (room <= 0) return recycled;
  const fresh = spawnPeds(
    zone,
    world.graph,
    random,
    playerPoints(recycled),
    world.viewRect ?? null,
    recycled.nextId,
    room,
    anchors,
  );
  if (fresh.length === 0) return recycled;
  return {
    ...recycled,
    peds: [...recycled.peds, ...fresh],
    nextId: recycled.nextId + fresh.length,
  };
}

/**
 * Removes ambient cars, driver and all, that are farther than {@link TRAFFIC_RECYCLE_DISTANCE_M}
 * from every anchor and off screen. Police cars, wrecks and anything a player sits in stay.
 */
function recycleTraffic(
  state: ArenaState,
  anchors: Point[],
  world: PopulationWorld,
): ArenaState {
  if (anchors.length === 0) return state;
  const viewRect = world.viewRect ?? null;
  const occupied = new Set(
    playersOf(state)
      .map((player) => player.vehicleId)
      .filter((id): id is number => id !== null),
  );
  const gone = new Set<number>();
  for (const driver of state.traffic) {
    if (driver.role !== "traffic" || occupied.has(driver.vehicleId)) continue;
    const vehicle = state.vehicles.find(
      (candidate) => candidate.id === driver.vehicleId,
    );
    if (!vehicle || vehicle.wrecked) continue;
    const point: Point = [vehicle.x, vehicle.y];
    if (viewRect && pointInRect(point, viewRect)) continue;
    if (farFromAll(point, anchors, TRAFFIC_RECYCLE_DISTANCE_M))
      gone.add(vehicle.id);
  }
  if (gone.size === 0) return state;
  return {
    ...state,
    vehicles: state.vehicles.filter((vehicle) => !gone.has(vehicle.id)),
    traffic: state.traffic.filter((driver) => !gone.has(driver.vehicleId)),
  };
}

/**
 * Recycles ambient cars the players left behind and replaces missing ones near them, one car at
 * a time up to the zone minimum.
 */
export function topUpTraffic(
  state: ArenaState,
  zone: MapZone,
  world: PopulationWorld,
  random: () => number,
): ArenaState {
  const anchors = anchorPoints(state);
  const recycled = recycleTraffic(state, anchors, world);
  const ambient = recycled.traffic.filter(
    (driver) => driver.role === "traffic",
  ).length;
  if (
    ambient >= TRAFFIC_MIN_PER_ZONE ||
    recycled.traffic.length >= MAX_TRAFFIC ||
    recycled.vehicles.length >= MAX_VEHICLES
  )
    return recycled;
  return addDrivenCars(
    recycled,
    spawnTraffic(
      zone,
      world.graph,
      random,
      playerPoints(recycled),
      vehiclePoints(recycled),
      world.viewRect ?? null,
      recycled.nextId,
      1,
      anchors,
    ),
  );
}

/**
 * The zone the NPC population is kept around.
 *
 * While a match is running the zone rule pins it: spec §6.4 has the host simulate NPCs inside
 * the zone disc, and anchoring on a player instead would let one person who wandered off drag
 * the whole crowd across the map. In free roam there is no match zone, so it follows the
 * lowest-id living player — which is exactly today's behaviour when there is only one.
 */
export function populationAnchorZone(
  state: ArenaState,
  index: MapIndex,
): MapZone | null {
  if (state.zoneEnforced && state.enforcedZoneKey)
    return findZoneByKey(index, state.enforcedZoneKey);
  const players = orderedPlayers(state);
  const anchor =
    players.find((player) => player.diedAtTick === null) ?? players[0];
  return anchor ? nearestZone(index, [anchor.x, anchor.y]) : null;
}

/** Re-populates when the anchor zone changes, and tops up pedestrians and traffic on schedule. */
export function applyPopulation(
  state: ArenaState,
  world: PopulationWorld,
  tick: number,
  random: () => number,
): ArenaState {
  const zone = populationAnchorZone(state, world.index);
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
