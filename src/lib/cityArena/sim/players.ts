import type { ArenaPlayerState, ArenaState } from "./types";

/** Returns the players in the state; this is the Plan 3 widening seam. */
export function playersOf(state: ArenaState): ArenaPlayerState[] {
  return [state.player];
}

/** Returns the player with `id`, or `null` when it is not present. */
export function playerById(
  state: ArenaState,
  id: number,
): ArenaPlayerState | null {
  return state.player.id === id ? state.player : null;
}

/** Replaces the matching player, or returns the same state for an unknown id. */
export function replacePlayer(
  state: ArenaState,
  player: ArenaPlayerState,
): ArenaState {
  return state.player.id === player.id ? { ...state, player } : state;
}

/** Returns the player sitting in `vehicleId`, or `null`. */
export function driverPlayer(
  state: ArenaState,
  vehicleId: number,
): ArenaPlayerState | null {
  return state.player.vehicleId === vehicleId ? state.player : null;
}
