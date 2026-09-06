import type { Rect } from "../mapBuild/geometry";
import type { MapIndex, MapZone } from "../world/mapTypes";
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
  const avoid = playersOf(cleared).map((player): [number, number] => [
    player.x,
    player.y,
  ]);
  const pickups = placePickups(
    index,
    zone,
    graph,
    random,
    avoid,
    cleared.nextId,
  );
  return {
    ...cleared,
    activeZoneKey: zone.key,
    pickups,
    nextId: cleared.nextId + pickups.length,
  };
}

/** Re-populates when the zone nearest the player changes. */
export function applyPopulation(
  state: ArenaState,
  world: PopulationWorld,
  random: () => number,
): ArenaState {
  const [player] = playersOf(state);
  const zone = nearestZone(world.index, [player.x, player.y]);
  if (!zone || zone.key === state.activeZoneKey) return state;
  return populateZone(state, zone, world.index, world.graph, random);
}
