import type { CollisionGrid } from "../world/collisionGrid";
import type { PlayerState, WorldInput } from "./types";

/**
 * Walking speed at full stick deflection: a GTA2-style jog (19.8 km/h). Raised from the spec's
 * 4 m/s on 2026-09-06 because a phone view of ≈ 45 m took 16 s to cross on foot.
 */
export const WALK_SPEED_MPS = 5.5;

/** Seconds a standing start takes to reach {@link WALK_SPEED_MPS}: enough weight to feel, too short to lag. */
export const WALK_RAMP_S = 0.15;

/** Acceleration on foot, derived so the ramp lasts exactly {@link WALK_RAMP_S}. */
export const WALK_ACCEL_MPS2 = WALK_SPEED_MPS / WALK_RAMP_S;

/** Collision radius of a person. */
export const PLAYER_RADIUS_M = 0.4;

/** Fixed simulation step (30 Hz). */
export const SIM_STEP_S = 1 / 30;

/** Input magnitudes below this are treated as "not moving". */
export const MOVE_DEAD_ZONE = 0.05;

/**
 * Speed after one `dt` of accelerating from `previous` toward `target`. Slowing down is instant
 * (a release ramp would add input latency exactly when a player is dodging), and the previous
 * speed is clamped to {@link WALK_SPEED_MPS} first so stepping out of a fast car cannot lurch.
 */
function rampSpeed(previous: number, target: number, dt: number): number {
  const from = Math.min(Math.max(0, previous), WALK_SPEED_MPS);
  if (from >= target) return target;
  return Math.min(target, from + WALK_ACCEL_MPS2 * dt);
}

/** Advances the player by `dt` seconds and resolves collisions; the aim angle, when given, wins over the movement direction for the facing. */
export function stepPlayer(
  player: PlayerState,
  input: WorldInput,
  dt: number,
  collision: Pick<CollisionGrid, "resolveCircle">,
): PlayerState {
  const inputMagnitude = Math.hypot(input.move[0], input.move[1]);
  const magnitude = Math.min(1, inputMagnitude);
  if (magnitude < MOVE_DEAD_ZONE)
    return { ...player, facing: input.aim ?? player.facing, speed: 0 };
  const speed = rampSpeed(player.speed, magnitude * WALK_SPEED_MPS, dt);
  const stepPerUnit = (speed * dt) / inputMagnitude;
  const [resolvedX, resolvedY] = collision.resolveCircle(
    [
      player.x + input.move[0] * stepPerUnit,
      player.y + input.move[1] * stepPerUnit,
    ],
    PLAYER_RADIUS_M,
  );
  return {
    x: resolvedX,
    y: resolvedY,
    facing: input.aim ?? Math.atan2(input.move[1], input.move[0]),
    speed,
  };
}
