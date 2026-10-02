import { nearbyLandmarkActivity } from "../world/landmarkActivities";
import type { ArenaWorld } from "./arenaWorld";
import { PLAYER_MAX_HEALTH } from "./damage";
import { orderBeer } from "./beer";
import { activeBonus, BONUS_BALANCE } from "./landmarkBonuses";
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
      readyAtTick: untilTick + BONUS_BALANCE.restSeconds / SIM_STEP_S,
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
      player.health < PLAYER_MAX_HEALTH
    ) {
      next = replacePlayer(next, {
        ...player,
        health: Math.min(
          PLAYER_MAX_HEALTH,
          player.health + BONUS_BALANCE.recoveryPerSecond * SIM_STEP_S,
        ),
      });
    }
  }
  return next;
}
