import type { Rect } from "../mapBuild/geometry";
import type { MapIndex, MapZone } from "../world/mapTypes";
import type { Point } from "../world/projection";
import { MAX_PEDS } from "./limits";
import {
  PEDS_PER_ZONE,
  PED_RESPAWN_BATCH,
  PED_RESPAWN_INTERVAL_TICKS,
  alivePeds,
  spawnPeds,
} from "./peds";
import { placePickups } from "./pickups";
import { playersOf } from "./players";
import { nearestZone, type SpawnGraph } from "./spawn";
import type { ArenaState } from "./types";

/** World data needed to populate one active zone. */
export type PopulationWorld = {
  index: MapIndex;
  graph: SpawnGraph;
  viewRect?: Rect;
};

function playerPoints(state: ArenaState): Point[] {
  return playersOf(state).map((player) => [player.x, player.y]);
}

function clearPopulation(state: ArenaState): ArenaState {
  const driven = new Set(state.traffic.map((driver) => driver.vehicleId));
  const vehicles = state.vehicles.filter(
    (vehicle) =>
      !driven.has(vehicle.id) || vehicle.id === state.player.vehicleId,
  );
  return { ...state, vehicles, peds: [], cops: [], pickups: [], traffic: [] };
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
  return {
    ...cleared,
    activeZoneKey: zone.key,
    pickups,
    peds,
    nextId: cleared.nextId + pickups.length + peds.length,
  };
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
  if (tick % PED_RESPAWN_INTERVAL_TICKS !== 0) return state;
  return topUpPeds(state, zone, world, random);
}
