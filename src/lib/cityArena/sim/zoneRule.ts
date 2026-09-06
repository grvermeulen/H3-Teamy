import type { MapIndex, MapZone } from "../world/mapTypes";
import { distanceToZoneEdge, findZoneByKey } from "../world/zone";
import { damagePlayer, isDead } from "./damage";
import { pushEvent } from "./events";
import { SIM_STEP_S } from "./player";
import { playersOf, replacePlayer } from "./players";
import type { ArenaPlayerState, ArenaState } from "./types";

/** Ticks of warning after leaving the zone. */
export const ZONE_WARNING_TICKS = 150;
/** Damage per second after the warning. */
export const ZONE_DAMAGE_PER_S = 10;
/** Ticks between damage lumps. */
export const ZONE_DAMAGE_INTERVAL_TICKS = 30;
const TICKS_PER_SECOND = Math.round(1 / SIM_STEP_S);

/** Whole seconds remaining on the countdown, or null when inactive. */
export function zoneSecondsLeft(
  player: Pick<ArenaPlayerState, "outsideSinceTick">,
  tick: number,
): number | null {
  if (player.outsideSinceTick === null) return null;
  const left = player.outsideSinceTick + ZONE_WARNING_TICKS - tick;
  return Math.max(0, Math.ceil(left / TICKS_PER_SECOND));
}

function damageDue(player: ArenaPlayerState, tick: number): boolean {
  if (player.outsideSinceTick === null) return false;
  const elapsed = tick - player.outsideSinceTick - ZONE_WARNING_TICKS;
  return elapsed >= 0 && elapsed % ZONE_DAMAGE_INTERVAL_TICKS === 0;
}

function withoutTimer(state: ArenaState, player: ArenaPlayerState): ArenaState {
  if (player.outsideSinceTick === null) return state;
  return replacePlayer(state, { ...player, outsideSinceTick: null });
}

function withZoneEvent(
  state: ArenaState,
  playerId: number,
  phase: "warning" | "damage",
): ArenaState {
  return {
    ...state,
    events: pushEvent(state.events, { kind: "zone", playerId, phase }),
  };
}

function applyOutside(
  state: ArenaState,
  player: ArenaPlayerState,
  tick: number,
): ArenaState {
  if (player.outsideSinceTick === null)
    return withZoneEvent(
      replacePlayer(state, { ...player, outsideSinceTick: tick }),
      player.id,
      "warning",
    );
  if (!damageDue(player, tick)) return state;
  const damaged = damagePlayer(player, ZONE_DAMAGE_PER_S, tick);
  if (damaged === player) return state;
  return withZoneEvent(replacePlayer(state, damaged), player.id, "damage");
}

function enforcedZone(state: ArenaState, index: MapIndex): MapZone | null {
  if (!state.zoneEnforced || state.activeZoneKey === null) return null;
  return findZoneByKey(index, state.activeZoneKey);
}

/** Applies the warning and out-of-zone damage for every living player. */
export function applyZoneRule(
  state: ArenaState,
  index: MapIndex,
  tick: number,
): ArenaState {
  const zone = enforcedZone(state, index);
  let next = state;
  for (const player of playersOf(state)) {
    const inside =
      zone === null || distanceToZoneEdge(zone, [player.x, player.y]) <= 0;
    if (inside || isDead(player)) {
      next = withoutTimer(next, player);
      continue;
    }
    next = applyOutside(next, player, tick);
  }
  return next;
}
