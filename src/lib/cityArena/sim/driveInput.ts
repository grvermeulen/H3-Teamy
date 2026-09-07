import { wrapAngle } from "./driver";
import { MOVE_DEAD_ZONE } from "./player";
import type { WorldInput } from "./types";
import type { VehicleControls } from "./vehicle";

/**
 * Heading error at which analog steering reaches full lock. Wider than the AI's
 * `STEER_FULL_ERROR_RAD` (π/6) on purpose, so a thumb wobble never asks for the whole wheel.
 */
export const ANALOG_STEER_FULL_ERROR_RAD = Math.PI / 4;

/**
 * Heading error beyond which the stick is read as "go back": the car brakes and then reverses
 * toward the stick instead of spinning on the spot to face it.
 */
export const ANALOG_REVERSE_ERROR_RAD = (Math.PI * 3) / 4;

/**
 * Largest change of the steer command (−1..1) per second. At 30 Hz that is 0.2 per tick, so
 * centre to full lock takes 1/6 s; a flicked thumb cannot snap the wheel across.
 */
export const STEER_COMMAND_RATE_PER_S = 6;

/** Controls for one tick plus the rate-limited steer command to carry into the next one. */
export type DriveStep = { controls: VehicleControls; steer: number };

/** Clamps a control value to −1..1, folding a stray IEEE −0 (from negating a zero rear error) back to plain 0. */
function clampUnit(value: number): number {
  return Math.max(-1, Math.min(1, value)) + 0;
}

/** Plan 4a's tank steering, kept verbatim for keyboards: x steers, up is gas, down brakes. */
function digitalStep(input: WorldInput): DriveStep {
  const steer = clampUnit(input.move[0]);
  return { controls: { throttle: clampUnit(-input.move[1]), steer }, steer };
}

/**
 * Throttle and the un-limited steer command for a stick pointing `stickAngle` while the car
 * heads `heading`. Inside {@link ANALOG_REVERSE_ERROR_RAD} the car drives forward and turns
 * toward the stick; beyond it the car reverses, and the error is re-measured from its tail and
 * negated because `turnRate` mirrors the steering while the forward speed is negative.
 */
function analogTarget(
  stickAngle: number,
  magnitude: number,
  heading: number,
): VehicleControls {
  const error = wrapAngle(stickAngle - heading);
  if (Math.abs(error) <= ANALOG_REVERSE_ERROR_RAD) {
    return {
      throttle: magnitude,
      steer: clampUnit(error / ANALOG_STEER_FULL_ERROR_RAD),
    };
  }
  const rearError = wrapAngle(error - Math.sign(error) * Math.PI);
  return {
    throttle: -magnitude,
    steer: clampUnit(-rearError / ANALOG_STEER_FULL_ERROR_RAD),
  };
}

/** Moves `previousSteer` toward `target` by at most {@link STEER_COMMAND_RATE_PER_S} per second. */
function rateLimit(previousSteer: number, target: number, dt: number): number {
  const maxChange = STEER_COMMAND_RATE_PER_S * dt;
  const change = target - previousSteer;
  if (Math.abs(change) <= maxChange) return target;
  return previousSteer + Math.sign(change) * maxChange;
}

/**
 * Maps one movement input onto car controls. Digital (keyboard) input keeps Plan 4a's tank
 * steering unchanged. An analog stick is heading-seeking: its direction is the heading the
 * driver wants, so the steer command is the signed angle from the car's heading to the stick
 * over {@link ANALOG_STEER_FULL_ERROR_RAD}, and letting go re-centres the wheel instead of
 * holding a turn. The returned `steer` is the rate-limited command the caller must remember.
 */
export function driveStep(
  input: WorldInput,
  heading: number,
  previousSteer: number,
  dt: number,
): DriveStep {
  if (!input.moveIsAnalog) return digitalStep(input);
  const magnitude = Math.min(1, Math.hypot(input.move[0], input.move[1]));
  if (magnitude < MOVE_DEAD_ZONE) {
    const centring = rateLimit(previousSteer, 0, dt);
    return { controls: { throttle: 0, steer: centring }, steer: centring };
  }
  const target = analogTarget(
    Math.atan2(input.move[1], input.move[0]),
    magnitude,
    heading,
  );
  const steer = rateLimit(previousSteer, target.steer, dt);
  return { controls: { throttle: target.throttle, steer }, steer };
}
