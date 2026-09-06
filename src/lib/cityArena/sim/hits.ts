import type { BulletHit } from "./bullets";
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

/** Applies a bullet hit to a pedestrian, or returns null for other target kinds. */
export function applyEntityHit(
  state: ArenaState,
  hit: BulletHit,
  tick: number,
): ArenaState | null {
  const target = hit.target;
  if (target.kind !== "player") return null;
  const pedIndex = state.peds.findIndex((ped) => ped.id === target.playerId);
  return pedIndex >= 0 ? hitPed(state, pedIndex, hit, tick) : null;
}
