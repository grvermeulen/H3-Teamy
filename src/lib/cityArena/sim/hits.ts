import type { BulletHit } from "./bullets";
import { damageCop } from "./cops";
import { pushEvent } from "./events";
import { damagePed } from "./peds";
import { playerById } from "./players";
import type { ArenaState } from "./types";

function hitPed(
  state: ArenaState,
  index: number,
  hit: BulletHit,
  tick: number,
): ArenaState {
  const ped = state.peds[index];
  const fromPlayer = playerById(state, hit.bullet.ownerId) !== null;
  const damaged = fromPlayer ? damagePed(ped, hit.bullet.damage, tick) : ped;
  let events = pushEvent(state.events, {
    kind: "hit",
    target: "ped",
    x: hit.point[0],
    y: hit.point[1],
  });
  if (damaged.mode === "dead" && ped.mode !== "dead")
    events = pushEvent(events, {
      kind: "kill",
      victim: "ped",
      killerId: hit.bullet.ownerId,
      x: ped.x,
      y: ped.y,
    });
  return {
    ...state,
    events,
    peds: state.peds.map((candidate, position) =>
      position === index ? damaged : candidate,
    ),
  };
}

function hitCop(
  state: ArenaState,
  index: number,
  hit: BulletHit,
  tick: number,
): ArenaState {
  const cop = state.cops[index];
  const fromPlayer = playerById(state, hit.bullet.ownerId) !== null;
  const damaged = fromPlayer ? damageCop(cop, hit.bullet.damage, tick) : cop;
  let events = pushEvent(state.events, {
    kind: "hit",
    target: "cop",
    x: hit.point[0],
    y: hit.point[1],
  });
  if (damaged.diedAtTick !== null && cop.diedAtTick === null)
    events = pushEvent(events, {
      kind: "kill",
      victim: "cop",
      killerId: hit.bullet.ownerId,
      x: cop.x,
      y: cop.y,
    });
  return {
    ...state,
    events,
    cops: state.cops.map((candidate, position) =>
      position === index ? damaged : candidate,
    ),
  };
}

/** Applies a bullet hit to a pedestrian, or returns null for other target kinds. */
export function applyEntityHit(
  state: ArenaState,
  hit: BulletHit,
  tick: number,
): ArenaState | null {
  const target = hit.target;
  if (target.kind !== "player") return null;
  const pedIndex = state.peds.findIndex((ped) => ped.id === target.playerId);
  if (pedIndex >= 0) return hitPed(state, pedIndex, hit, tick);
  const copIndex = state.cops.findIndex((cop) => cop.id === target.playerId);
  return copIndex >= 0 ? hitCop(state, copIndex, hit, tick) : null;
}
