/**
 * Who is in the match: creating a player, joining, leaving, respawning, and being thrown out of a
 * car on death. Entity ids come from one counter shared with the rest of the world, so a rejoining
 * player never collides with a live car or pedestrian.
 */
import { playersOf, replacePlayer } from "./players";
import type { MapZone } from "../world/mapTypes";
import type { Point } from "../world/projection";
import { findZone } from "../world/zone";
import {
  INVULNERABLE_TICKS,
  PLAYER_MAX_HEALTH,
  RESPAWN_DELAY_TICKS,
  isDead,
} from "./damage";
import { populationAnchorZone } from "./populate";
import { MAX_ARENA_PLAYERS } from "./limits";
import { chooseRespawnNode, nearestZone } from "./spawn";
import type { ArenaPlayerState, ArenaState } from "./types";
import { SPAWN_AMMO } from "./weapons";
import { exitVehicle } from "./boarding";
import { LOCAL_PLAYER_ID, type ArenaWorld } from "./arenaWorld";

/** A player standing at `position` with the spawn loadout, ready to fire from `tick`. */
export function createArenaPlayer(
  position: Point,
  tick: number,
): ArenaPlayerState {
  return {
    id: LOCAL_PLAYER_ID,
    x: position[0],
    y: position[1],
    facing: -Math.PI / 2,
    speed: 0,
    health: PLAYER_MAX_HEALTH,
    weapon: "pistol",
    ammo: SPAWN_AMMO,
    vehicleId: null,
    boardingTicksLeft: 0,
    nextShotTick: tick,
    diedAtTick: null,
    invulnerableUntilTick: tick,
    heat: 0,
    heatTick: tick,
    outsideSinceTick: null,
    driveSteer: 0,
    held: { enter: false, weaponNext: false },
  };
}

/**
 * A spawn node of `zone` clear of parked cars and pickups, or `fallback` when there is no zone
 * to spawn into. Shared by respawn and by a player joining, so both land the same way.
 */
export function spawnPointIn(
  state: ArenaState,
  zone: MapZone | null,
  fallback: Point,
  random: () => number,
): Point {
  if (!zone) return fallback;
  const intactVehicles: Point[] = state.vehicles
    .filter((vehicle) => !vehicle.wrecked)
    .map((vehicle) => [vehicle.x, vehicle.y]);
  const pickupSpots: Point[] = state.pickups.map((pickup) => [
    pickup.x,
    pickup.y,
  ]);
  return chooseRespawnNode(zone, [...intactVehicles, ...pickupSpots], random);
}

/**
 * Adds a player at a free spawn node of the population's anchor zone, taking the next free
 * entity id so a client that rejoins never collides with a live entity. Returns the state
 * unchanged and a `null` player when the arena already holds {@link MAX_ARENA_PLAYERS}.
 */
export function addArenaPlayer(
  state: ArenaState,
  world: ArenaWorld,
  tick: number,
  random: () => number,
): { state: ArenaState; player: ArenaPlayerState | null } {
  if (playersOf(state).length >= MAX_ARENA_PLAYERS)
    return { state, player: null };
  const anchor = playersOf(state)[0];
  const zone = populationAnchorZone(state, world.index);
  const spawn = spawnPointIn(
    state,
    zone,
    anchor ? [anchor.x, anchor.y] : [0, 0],
    random,
  );
  const player: ArenaPlayerState = {
    ...createArenaPlayer(spawn, tick),
    id: state.nextId,
    invulnerableUntilTick: tick + INVULNERABLE_TICKS,
  };
  return {
    state: {
      ...state,
      players: [...state.players, player],
      nextId: state.nextId + 1,
    },
    player,
  };
}

/**
 * Removes a player. The car they were driving is simply left where it stands with nobody at the
 * wheel — an ambient driver may pick it up again, exactly as when a player steps out.
 */
export function removeArenaPlayer(state: ArenaState, id: number): ArenaState {
  const players = state.players.filter((player) => player.id !== id);
  if (players.length === state.players.length) return state;
  return { ...state, players };
}

/**
 * Brings a dead player back after the respawn delay: full health and the spawn loadout, on a node
 * of the zone they died in (else the nearest one), shielded for the invulnerable window.
 *
 * @param state - The arena state holding the dead player.
 * @param player - The player to respawn; returned unchanged until the delay has passed.
 * @param world - The map and road graph the spawn node is chosen from.
 * @param tick - The current tick, which decides whether the delay has elapsed.
 * @param random - The injected source of randomness, so respawn stays deterministic.
 * @returns The state with the player respawned, or the state unchanged.
 */
export function applyRespawn(
  state: ArenaState,
  player: ArenaPlayerState,
  world: ArenaWorld,
  tick: number,
  random: () => number,
): ArenaState {
  if (
    player.diedAtTick === null ||
    tick < player.diedAtTick + RESPAWN_DELAY_TICKS
  )
    return state;
  // Respawn in the zone this player died in, not in the state's single `zoneKey`: that field
  // follows one player, and with several it would drop the others across the map.
  const zone =
    findZone(world.index, [player.x, player.y]) ??
    nearestZone(world.index, [player.x, player.y]);
  const spawn = spawnPointIn(state, zone, [player.x, player.y], random);
  return replacePlayer(state, {
    ...createArenaPlayer(spawn, tick),
    id: player.id,
    invulnerableUntilTick: tick + INVULNERABLE_TICKS,
  });
}

/** Safety net: a player who died while seated is placed beside the car. */
export function ejectIfDead(
  state: ArenaState,
  player: ArenaPlayerState,
  world: ArenaWorld,
): ArenaState {
  if (!isDead(player) || player.vehicleId === null) return state;
  return exitVehicle(state, player, world);
}
