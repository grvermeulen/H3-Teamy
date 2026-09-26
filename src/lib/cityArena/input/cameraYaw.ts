/**
 * How the 3D camera's yaw moves besides the mouse (spec §6.3): easing behind a car once the mouse
 * rests, riding along with the car in the driver's seat, and turning toward a camera-relative aim
 * stick on touch or a gamepad. Pure, so the runtime only feeds it the clock and the car.
 */

import type { ArenaSettings } from "../schemas";
import type { WorldInput } from "../sim/types";

/** Seconds the mouse must rest before the chase camera eases behind the car (spec §6.3). */
export const CHASE_IDLE_S = 1.2;
/** Rate (per second) at which the third-person chase camera swings behind the heading. */
const CHASE_EASE_PER_S = 2.2;
/** The driver's-seat view settles on the windscreen faster than the chase camera swings round. */
const SEAT_EASE_PER_S = 5;
/** Mouse yaw below this in one frame counts as a resting mouse, radians. */
const YAW_IDLE_EPSILON_RAD = 1e-4;
/** Rate (per second) at which the camera turns toward a held aim stick. */
const STICK_TURN_PER_S = 3;
/**
 * Rate (per second, at full stick) at which a lone movement stick turns the camera toward where
 * the player walks, so a touch player without an aim stick can still look around.
 */
export const MOVE_FOLLOW_PER_S = 0.8;
/** The camera follows a walk only this far off its forward, so walking backward never spins it. */
const MOVE_FOLLOW_MAX_RAD = 0.6 * Math.PI;
/** A full turn, radians. */
const TURN = 2 * Math.PI;
/** A stick's screen angle for "up" (screen y grows downward), which maps to the camera's forward. */
const STICK_UP_RAD = -Math.PI / 2;

/** What the car camera remembers between frames. */
export type CarLook = {
  /** Seconds since the mouse last turned the camera. */
  idleSeconds: number;
  /** The heading of the car driven last frame, or `null` on foot. */
  heading: number | null;
};

/** A {@link CarLook} before the first frame. */
export const INITIAL_CAR_LOOK: CarLook = { idleSeconds: 0, heading: null };

/**
 * The shortest signed turn from one angle to another.
 *
 * @param from - Radians, any winding.
 * @param to - Radians, any winding.
 * @returns The difference in `[−π, π)`.
 */
export function angleDelta(from: number, to: number): number {
  const delta = (((to - from + Math.PI) % TURN) + TURN) % TURN;
  return delta - Math.PI;
}

/**
 * Eases `yaw` toward `target` along the shorter arc, frame-rate independently: an exponential
 * approach closing `1 − e^(−rate·dt)` of the gap.
 *
 * @param yaw - The current yaw, radians (unwrapped: the mouse lets it wind freely).
 * @param target - The yaw to approach.
 * @param rate - Per second.
 * @param dt - Seconds this frame.
 * @returns The new yaw, still unwrapped relative to `yaw`.
 */
export function easeYaw(
  yaw: number,
  target: number,
  rate: number,
  dt: number,
): number {
  return yaw + angleDelta(yaw, target) * (1 - Math.exp(-rate * dt));
}

/** One frame of {@link nextCarYaw}. */
export type CarYawInput = {
  yaw: number;
  /** Radians the mouse turned the camera since the previous frame. */
  yawDelta: number;
  /** The car's heading, or `null` on foot. */
  heading: number | null;
  mode: ArenaSettings["camera3d"];
  dt: number;
  state: CarLook;
};

/**
 * The camera yaw in or out of a car for this frame (spec §6.3). On foot the yaw is the mouse's.
 * Over the shoulder, a resting mouse ({@link CHASE_IDLE_S}) lets the chase camera ease behind
 * the car. Behind the eyes the view is bolted to the car — it turns with the car at once, the
 * mouse adds a look offset on top, and a resting mouse settles that offset back onto the
 * windscreen, faster than the chase camera swings.
 *
 * @param input - The yaw, this frame's mouse turn, the car heading, mode, time and memory.
 * @returns The new yaw and what to remember for the next frame.
 */
export function nextCarYaw(input: CarYawInput): {
  yaw: number;
  state: CarLook;
} {
  const { yaw, yawDelta, heading, mode, dt, state } = input;
  const idleSeconds =
    Math.abs(yawDelta) > YAW_IDLE_EPSILON_RAD ? 0 : state.idleSeconds + dt;
  if (heading === null) return { yaw, state: { idleSeconds, heading: null } };
  const carried =
    mode === "first" && state.heading !== null
      ? yaw + angleDelta(state.heading, heading)
      : yaw;
  const rate = mode === "first" ? SEAT_EASE_PER_S : CHASE_EASE_PER_S;
  return {
    yaw:
      idleSeconds >= CHASE_IDLE_S
        ? easeYaw(carried, heading, rate, dt)
        : carried,
    state: { idleSeconds, heading },
  };
}

/**
 * The world heading of an aim stick read relative to the camera: pushed up is the camera's
 * forward, pushed right its right (spec §6.3, touch and gamepad).
 *
 * @param yaw - The camera yaw, radians.
 * @param stickAngle - The stick's screen-space angle, `atan2(y, x)` with y down.
 * @returns The world heading, radians.
 */
export function stickWorldYaw(yaw: number, stickAngle: number): number {
  return yaw + stickAngle - STICK_UP_RAD;
}

/**
 * The camera yaw after the sticks have had their say (spec §6.3): a held aim stick turns the camera
 * toward the aim; on foot without one, an analog movement stick turns it toward the walking
 * direction (up to {@link MOVE_FOLLOW_MAX_RAD} off forward), scaled by how far it is pushed. The
 * mouse and the keyboard never turn it here.
 *
 * @param yaw - The camera yaw, radians.
 * @param input - The frame's aim (a stick's screen angle, or `null`) and movement.
 * @param driving - In a car the chase camera does the following instead.
 * @param dt - Seconds this frame.
 * @returns The new yaw.
 */
export function stickTurnedYaw(
  yaw: number,
  input: Pick<WorldInput, "aim" | "move" | "moveIsAnalog">,
  driving: boolean,
  dt: number,
): number {
  if (input.aim !== null)
    return easeYaw(yaw, stickWorldYaw(yaw, input.aim), STICK_TURN_PER_S, dt);
  const [sx, sy] = input.move;
  const push = Math.hypot(sx, sy);
  if (driving || !input.moveIsAnalog || push === 0) return yaw;
  const walk = stickWorldYaw(yaw, Math.atan2(sy, sx));
  if (Math.abs(angleDelta(yaw, walk)) > MOVE_FOLLOW_MAX_RAD) return yaw;
  return easeYaw(yaw, walk, MOVE_FOLLOW_PER_S * push, dt);
}
