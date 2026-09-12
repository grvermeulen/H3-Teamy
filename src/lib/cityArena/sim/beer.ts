/**
 * The brewery: ordering a beer at its tap, and sobering up again. A beer is ordered with the
 * Instappen button while standing at a `brewery` landmark on foot with no car in reach — the
 * boarding stage tries the car first — and adds {@link DRUNK_PER_BEER} to the player's `drunk`,
 * which every tick then brings down by {@link DRUNK_DECAY_PER_TICK}. Being drunk lowers the
 * damage a player's own shots do ({@link drunkDamageFactor}); the renderer sways the view.
 */
import type { MapIndex, MapLandmark } from "../world/mapTypes";
import { landmarkCentreMetres } from "../world/zone";
import { isDead } from "./damage";
import { pushEvent } from "./events";
import { SIM_STEP_S } from "./player";
import { playersOf, replacePlayer } from "./players";
import type { ArenaPlayerState, ArenaState } from "./types";

/** Distance from the brewery's centre within which the tap serves; covers the whole terrace. */
export const BEER_ORDER_RANGE_M = 10;
/** What one beer adds to `drunk`: three glasses and you are fully drunk. */
export const DRUNK_PER_BEER = 0.34;
/** Seconds a fully drunk player takes to sober up completely. */
export const SOBER_UP_S = 120;
/** How much `drunk` falls per tick. */
export const DRUNK_DECAY_PER_TICK = SIM_STEP_S / SOBER_UP_S;
/**
 * Share of its damage a fully drunk player's shot loses: a swaying arm lands a weaker blow, so
 * at `drunk` 1 every bullet, pellet and swing does half, and in between it scales linearly.
 */
export const DRUNK_DAMAGE_REDUCTION = 0.5;

/**
 * The factor the damage of a shot is multiplied by at a drunkenness of `drunk` (0..1). It is
 * applied where the shot is created (`combat.ts`), so the weakened damage travels with the
 * bullet: sobering up mid-flight cannot make a pellet already in the air hit harder.
 *
 * @param drunk - The shooter's drunkenness; values outside 0..1 are clamped.
 * @returns The damage factor, 1 sober down to `1 − DRUNK_DAMAGE_REDUCTION` fully drunk.
 */
export function drunkDamageFactor(drunk: number): number {
  return 1 - DRUNK_DAMAGE_REDUCTION * Math.min(1, Math.max(0, drunk));
}

/** The breweries on the map: every landmark drawn in the `brewery` style serves beer. */
export function breweriesOf(index: Pick<MapIndex, "landmarks">): MapLandmark[] {
  return index.landmarks.filter((landmark) => landmark.style === "brewery");
}

/** The brewery whose tap the player stands at, or `null` when none is within reach. */
export function breweryAt(
  index: Pick<MapIndex, "landmarks">,
  player: Pick<ArenaPlayerState, "x" | "y">,
): MapLandmark | null {
  for (const brewery of breweriesOf(index)) {
    const [x, y] = landmarkCentreMetres(brewery);
    if (Math.hypot(player.x - x, player.y - y) <= BEER_ORDER_RANGE_M)
      return brewery;
  }
  return null;
}

/** True when a press of the Instappen button would order a beer: alive, on foot, at a tap. */
export function canOrderBeer(
  index: Pick<MapIndex, "landmarks">,
  player: ArenaPlayerState,
): boolean {
  return (
    !isDead(player) &&
    player.vehicleId === null &&
    breweryAt(index, player) !== null
  );
}

/** One beer down: the player gets drunker, capped at 1, and the tick records the event. */
export function orderBeer(
  state: ArenaState,
  player: ArenaPlayerState,
  index: Pick<MapIndex, "landmarks">,
): ArenaState {
  if (!canOrderBeer(index, player)) return state;
  const served = replacePlayer(state, {
    ...player,
    drunk: Math.min(1, player.drunk + DRUNK_PER_BEER),
  });
  return {
    ...served,
    events: pushEvent(served.events, {
      kind: "beer",
      playerId: player.id,
      x: player.x,
      y: player.y,
    }),
  };
}

/** One tick of wearing off, for everyone with anything to wear off. */
export function soberUp(state: ArenaState): ArenaState {
  let next = state;
  for (const player of playersOf(state)) {
    if (player.drunk <= 0) continue;
    next = replacePlayer(next, {
      ...player,
      drunk: Math.max(0, player.drunk - DRUNK_DECAY_PER_TICK),
    });
  }
  return next;
}
