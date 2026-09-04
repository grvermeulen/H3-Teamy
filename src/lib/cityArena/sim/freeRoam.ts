import type { CollisionGrid } from "../world/collisionGrid";
import type { MapIndex } from "../world/mapTypes";
import type { Point } from "../world/projection";
import { findZone } from "../world/zone";
import { stepPlayer } from "./player";
import type { FreeRoamState, WorldInput } from "./types";

/** What the free-roam step needs from the world. */
export type FreeRoamWorld = {
  collision: Pick<CollisionGrid, "resolveCircle">;
  index: MapIndex;
};

/** A fresh session standing still at `spawn`. */
export function createFreeRoamState(
  spawn: Point,
  index: MapIndex,
): FreeRoamState {
  return {
    tick: 0,
    player: { x: spawn[0], y: spawn[1], facing: -Math.PI / 2, speed: 0 },
    zoneKey: findZone(index, spawn)?.key ?? null,
  };
}

/** One fixed step: move the player and re-evaluate which zone they are in. */
export function stepFreeRoam(
  state: FreeRoamState,
  input: WorldInput,
  dt: number,
  world: FreeRoamWorld,
): FreeRoamState {
  const player = stepPlayer(state.player, input, dt, world.collision);
  return {
    tick: state.tick + 1,
    player,
    zoneKey: findZone(world.index, [player.x, player.y])?.key ?? null,
  };
}

/** Moves the player instantly (zone picker), keeping the facing. */
export function teleportPlayer(
  state: FreeRoamState,
  position: Point,
  index: MapIndex,
): FreeRoamState {
  return {
    ...state,
    player: { ...state.player, x: position[0], y: position[1], speed: 0 },
    zoneKey: findZone(index, position)?.key ?? null,
  };
}
