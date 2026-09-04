import type { CollisionGrid } from "../world/collisionGrid";
import type { PlayerState, WorldInput } from "./types";

/** Walking speed at full stick deflection. */
export const WALK_SPEED_MPS = 4;

/** Collision radius of a person. */
export const PLAYER_RADIUS_M = 0.4;

/** Fixed simulation step (30 Hz). */
export const SIM_STEP_S = 1 / 30;

/** Input magnitudes below this are treated as "not moving". */
export const MOVE_DEAD_ZONE = 0.05;

/** Advances the player by `dt` seconds and resolves collisions; the aim angle, when given, wins over the movement direction for the facing. */
export function stepPlayer(
  player: PlayerState,
  input: WorldInput,
  dt: number,
  collision: Pick<CollisionGrid, "resolveCircle">,
): PlayerState {
  const magnitude = Math.min(1, Math.hypot(input.move[0], input.move[1]));
  if (magnitude < MOVE_DEAD_ZONE)
    return { ...player, facing: input.aim ?? player.facing, speed: 0 };
  const [resolvedX, resolvedY] = collision.resolveCircle(
    [
      player.x + input.move[0] * WALK_SPEED_MPS * dt,
      player.y + input.move[1] * WALK_SPEED_MPS * dt,
    ],
    PLAYER_RADIUS_M,
  );
  return {
    x: resolvedX,
    y: resolvedY,
    facing: input.aim ?? Math.atan2(input.move[1], input.move[0]),
    speed: magnitude * WALK_SPEED_MPS,
  };
}
