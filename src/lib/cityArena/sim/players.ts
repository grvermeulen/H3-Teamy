import type { Point } from "../world/projection";
import type { ArenaPlayerState, ArenaState } from "./types";

/** Returns the players in the state, in join order. */
export function playersOf(state: ArenaState): ArenaPlayerState[] {
  return state.players;
}

/** Returns the player with `id`, or `null` when it is not present. */
export function playerById(
  state: ArenaState,
  id: number,
): ArenaPlayerState | null {
  return state.players.find((player) => player.id === id) ?? null;
}

/** Replaces the matching player, or returns the same state for an unknown id. */
export function replacePlayer(
  state: ArenaState,
  player: ArenaPlayerState,
): ArenaState {
  const index = state.players.findIndex((other) => other.id === player.id);
  if (index === -1) return state;
  const players = [...state.players];
  players[index] = player;
  return { ...state, players };
}

/** Returns the player sitting in `vehicleId`, or `null`. */
export function driverPlayer(
  state: ArenaState,
  vehicleId: number,
): ArenaPlayerState | null {
  return state.players.find((player) => player.vehicleId === vehicleId) ?? null;
}

/**
 * The player this client owns. Offline that is the only player in the state; Plan 3b passes an
 * explicit id instead, once a client can be one of several players in a hosted match.
 */
export function localPlayer(state: ArenaState): ArenaPlayerState {
  const player = state.players[0];
  if (!player) throw new Error("Arena state has no players");
  return player;
}

/**
 * The living player closest to `point`, ties broken by the lower id so the choice is
 * deterministic. Returns `null` when no player passes `filter`.
 */
export function nearestPlayerTo(
  state: ArenaState,
  point: Point,
  filter: (player: ArenaPlayerState) => boolean = () => true,
): ArenaPlayerState | null {
  let best: ArenaPlayerState | null = null;
  let bestDistanceSq = Number.POSITIVE_INFINITY;
  for (const player of state.players) {
    if (!filter(player)) continue;
    const distanceSq = (player.x - point[0]) ** 2 + (player.y - point[1]) ** 2;
    if (distanceSq > bestDistanceSq) continue;
    if (distanceSq === bestDistanceSq && best && best.id < player.id) continue;
    best = player;
    bestDistanceSq = distanceSq;
  }
  return best;
}
