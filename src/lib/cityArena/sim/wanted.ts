import { isDead } from "./damage";
import { eventsOfKind, pushEvent } from "./events";
import { SIM_STEP_S } from "./player";
import { playersOf, replacePlayer } from "./players";
import type {
  ArenaEvent,
  ArenaPlayerState,
  ArenaState,
  CopState,
  DriverState,
} from "./types";

/** Heat for killing a pedestrian. */
export const HEAT_PED_KILL = 30;
/** Heat for killing a cop. */
export const HEAT_COP_KILL = 60;
/** Heat for firing within 15 m of a cop. */
export const HEAT_SHOT_NEAR_COP = 10;
/** Heat for ramming a police car. */
export const HEAT_RAM_POLICE = 20;
/** Distance from a cop at which a shot adds heat. */
export const HEAT_NEAR_COP_M = 15;
/** Quiet ticks before heat starts decaying. */
export const HEAT_QUIET_TICKS = 240;
/** Heat lost per second. */
export const HEAT_DECAY_PER_S = 5;
/** Heat per wanted star. */
export const HEAT_PER_LEVEL = 40;
/** Maximum wanted stars. */
export const MAX_WANTED_LEVEL = 3;
const HEAT_DECAY_PER_TICK = HEAT_DECAY_PER_S * SIM_STEP_S;
type ImpactEvent = Extract<ArenaEvent, { kind: "impact" }>;

/** Converts heat to wanted stars. */
export function wantedLevel(heat: number): number {
  return Math.min(MAX_WANTED_LEVEL, Math.floor(heat / HEAT_PER_LEVEL));
}

/** Adds heat and records the tick that started the quiet timer. */
export function addHeat(
  player: ArenaPlayerState,
  amount: number,
  tick: number,
): ArenaPlayerState {
  if (amount <= 0) return player;
  return { ...player, heat: player.heat + amount, heatTick: tick };
}

/** Decays heat after the quiet period. */
export function decayHeat(
  player: ArenaPlayerState,
  tick: number,
): ArenaPlayerState {
  if (player.heat === 0 || tick - player.heatTick < HEAT_QUIET_TICKS)
    return player;
  return { ...player, heat: Math.max(0, player.heat - HEAT_DECAY_PER_TICK) };
}

function nearLivingCop(cops: CopState[], x: number, y: number): boolean {
  return cops.some(
    (cop) =>
      cop.diedAtTick === null &&
      Math.hypot(cop.x - x, cop.y - y) <= HEAT_NEAR_COP_M,
  );
}

function isPoliceCar(
  traffic: DriverState[],
  vehicleId: number | null,
): boolean {
  return (
    vehicleId !== null &&
    traffic.some(
      (driver) => driver.role === "police" && driver.vehicleId === vehicleId,
    )
  );
}

function rammedPoliceCar(
  impact: ImpactEvent,
  player: ArenaPlayerState,
  traffic: DriverState[],
): boolean {
  if (player.vehicleId === null) return false;
  if (impact.vehicleId === player.vehicleId)
    return isPoliceCar(traffic, impact.otherVehicleId);
  if (impact.otherVehicleId === player.vehicleId)
    return isPoliceCar(traffic, impact.vehicleId);
  return false;
}

/** Calculates heat earned by one player from this tick's events. */
export function heatFromEvents(
  events: ArenaEvent[],
  player: ArenaPlayerState,
  cops: CopState[],
  traffic: DriverState[],
): number {
  let heat = 0;
  for (const kill of eventsOfKind(events, "kill")) {
    if (kill.killerId !== player.id) continue;
    heat += kill.victim === "cop" ? HEAT_COP_KILL : HEAT_PED_KILL;
  }
  for (const shot of eventsOfKind(events, "shot"))
    if (shot.ownerId === player.id && nearLivingCop(cops, shot.x, shot.y))
      heat += HEAT_SHOT_NEAR_COP;
  for (const impact of eventsOfKind(events, "impact"))
    if (rammedPoliceCar(impact, player, traffic)) heat += HEAT_RAM_POLICE;
  return heat;
}

/** Returns the living player with the highest nonzero wanted level. */
export function wantedTarget(state: ArenaState): ArenaPlayerState | null {
  let target: ArenaPlayerState | null = null;
  for (const player of playersOf(state)) {
    if (isDead(player) || wantedLevel(player.heat) === 0) continue;
    if (!target || player.heat > target.heat) target = player;
  }
  return target;
}

/** Returns the wanted level currently in force. */
export function currentWantedLevel(state: ArenaState): number {
  const target = wantedTarget(state);
  return target ? wantedLevel(target.heat) : 0;
}

function updateHeat(
  state: ArenaState,
  player: ArenaPlayerState,
  tick: number,
): ArenaPlayerState {
  if (isDead(player))
    return player.heat === 0 ? player : { ...player, heat: 0 };
  const earned = heatFromEvents(
    state.events,
    player,
    state.cops,
    state.traffic,
  );
  return decayHeat(addHeat(player, earned, tick), tick);
}

/** Applies heat and records wanted-level changes. */
export function applyWanted(state: ArenaState, tick: number): ArenaState {
  let next = state;
  for (const player of playersOf(state)) {
    const updated = updateHeat(state, player, tick);
    if (updated === player) continue;
    next = replacePlayer(next, updated);
    const level = wantedLevel(updated.heat);
    if (level === wantedLevel(player.heat)) continue;
    next = {
      ...next,
      events: pushEvent(next.events, {
        kind: "wanted",
        playerId: player.id,
        level,
      }),
    };
  }
  return next;
}
