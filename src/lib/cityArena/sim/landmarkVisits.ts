import { nearbyLandmarkActivity } from "../world/landmarkActivities";
import type { ArenaWorld } from "./arenaWorld";
import { orderBeer } from "./beer";
import { activeBonus } from "./landmarkBonuses";
import { SIM_STEP_S } from "./player";
import { playersOf, replacePlayer } from "./players";
import type { ArenaPlayerState, ArenaState } from "./types";

/** Visits a landmark on the interaction button edge; cars take precedence in boarding.ts. */
export function visitLandmark(
  state: ArenaState,
  player: ArenaPlayerState,
  world: ArenaWorld,
): ArenaState {
  const place = nearbyLandmarkActivity(world.index, player, world.collision);
  const served = orderBeer(state, player, world.index);
  if (!place || state.tick < (player.bonus?.readyAtTick ?? 0)) return served;
  const current = served.players.find((entry) => entry.id === player.id)!;
  const untilTick =
    state.tick + Math.round(place.activity.seconds / SIM_STEP_S);
  return replacePlayer(served, {
    ...current,
    bonus: {
      kind: place.activity.bonus,
      untilTick,
      readyAtTick: untilTick + 15 / SIM_STEP_S,
    },
  });
}

/** Applies recovery at the fixed simulation rate and clears bonuses on death or after rest. */
export function stepLandmarkBonuses(state: ArenaState): ArenaState {
  let next = state;
  for (const player of playersOf(state)) {
    if (!player.bonus) continue;
    if (player.diedAtTick !== null || state.tick >= player.bonus.readyAtTick) {
      next = replacePlayer(next, { ...player, bonus: undefined });
    } else if (
      activeBonus(player, state.tick) === "recovery" &&
      player.health < 100
    ) {
      next = replacePlayer(next, {
        ...player,
        health: Math.min(100, player.health + 2 * SIM_STEP_S),
      });
    }
  }
  return next;
}
