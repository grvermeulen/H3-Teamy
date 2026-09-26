/**
 * What the 3D cast infers from the blended scene between frames (spec §6.6–6.7): how fast a
 * pedestrian or officer walks (the simulation keeps no speed for them), how far along its gait it
 * is, how far a driverless car's front wheels are turned, and each other player's vest hue. Pure
 * and allocation-free: every tracker writes into the memory it is given.
 */
import { angleDelta } from "../input/cameraYaw";
import type { VehicleKind } from "../sim/types";
import { VEHICLE_SPECS } from "../sim/vehicle";

/** Speeds and steering ease toward a new value with this time constant, seconds. */
export const MOTION_SMOOTHING_S = 0.15;
/**
 * A jump longer than this between two frames is a respawn or a snapshot snap, not a walk, metres:
 * the speed keeps its last value instead of spiking.
 */
export const TELEPORT_M = 5;
/** Below this speed a car is treated as parked and its wheels centre, m/s. */
const STEER_MIN_SPEED_MPS = 0.5;
/** The golden ratio's fractional part: stepping hues by it spreads any count evenly. */
const GOLDEN_RATIO_CONJUGATE = 0.618033988749895;

/** A character's walking memory. */
export type Motion = {
  /** Where the character stood last frame, metres. */
  x: number;
  y: number;
  /** Smoothed ground speed, m/s. */
  speed: number;
  /** Distance walked so far, metres; phases the gait. */
  phaseM: number;
  /** False until the first sample. */
  primed: boolean;
};

/**
 * A fresh walking memory, at rest.
 *
 * @returns A motion to pass to {@link trackMotion} every frame.
 */
export function createMotion(): Motion {
  return { x: 0, y: 0, speed: 0, phaseM: 0, primed: false };
}

/** The share of the gap to a target that an exponential ease closes in `dt` seconds. */
function easeShare(dt: number): number {
  return 1 - Math.exp(-dt / MOTION_SMOOTHING_S);
}

/**
 * Advances a character's walk by one frame: the speed eases toward `measuredSpeed` (a player's
 * own) or, when the simulation has none, toward the distance moved over `dt`; the gait phase
 * grows by the distance walked. The first sample only primes the memory; a jump longer than
 * {@link TELEPORT_M} re-primes the position and leaves the speed alone.
 *
 * @param motion - The character's memory, updated in place.
 * @param x - Where it stands this frame, metres east.
 * @param y - Metres south.
 * @param dt - Seconds since the previous frame.
 * @param measuredSpeed - The simulation's speed for the character, or `null` to measure it.
 */
export function trackMotion(
  motion: Motion,
  x: number,
  y: number,
  dt: number,
  measuredSpeed: number | null,
): void {
  const moved = Math.hypot(x - motion.x, y - motion.y);
  const wasPrimed = motion.primed;
  motion.x = x;
  motion.y = y;
  motion.primed = true;
  if (!wasPrimed) {
    motion.speed = measuredSpeed ?? 0;
    return;
  }
  if (dt <= 0 || (measuredSpeed === null && moved > TELEPORT_M)) return;
  const target = measuredSpeed ?? moved / dt;
  motion.speed += (target - motion.speed) * easeShare(dt);
  motion.phaseM += motion.speed * dt;
}

/**
 * The vest hue of another player: golden-ratio steps around the colour wheel by id, so the same
 * player always wears the same colour and a full match's players stay far apart.
 *
 * @param playerId - The player's id.
 * @returns Hue in turns, `[0, 1)`.
 */
export function vestHueOf(playerId: number): number {
  const turns = playerId * GOLDEN_RATIO_CONJUGATE;
  return turns - Math.floor(turns);
}

/** A car's steering memory. */
export type SteerMemory = {
  /** The heading last frame, radians. */
  heading: number;
  /** Smoothed steering, −1..1. */
  steer: number;
  primed: boolean;
};

/**
 * A fresh steering memory, wheels straight.
 *
 * @returns A memory to pass to {@link trackSteer} every frame.
 */
export function createSteerMemory(): SteerMemory {
  return { heading: 0, steer: 0, primed: false };
}

/** One frame of a car, as {@link trackSteer} reads it. */
export type SteerSample = {
  heading: number;
  /** Signed speed along the heading, m/s. */
  forward: number;
  kind: VehicleKind;
  dt: number;
  /** The driving player's steering command, or `null` without a player at the wheel. */
  driverSteer: number | null;
};

/** The steering that turns a car of `kind` at `turnRate` rad/s: the simulation's rule inverted. */
function steerForTurn(
  turnRate: number,
  forward: number,
  kind: VehicleKind,
): number {
  if (Math.abs(forward) < STEER_MIN_SPEED_MPS) return 0;
  const direction = forward < 0 ? -1 : 1;
  const steer = turnRate / (VEHICLE_SPECS[kind].steerRateRadS * direction);
  return Math.max(-1, Math.min(1, steer));
}

/**
 * The front wheels' steering this frame, −1..1 (positive to the right): a player's own command
 * when one drives, else read from how fast the heading turns — the simulation's turn rule
 * (`steer × steerRate`, mirrored in reverse) inverted and smoothed.
 *
 * @param memory - The car's memory, updated in place.
 * @param sample - Heading, forward speed, kind, frame time and the driver's command.
 * @returns The steering to show.
 */
export function trackSteer(memory: SteerMemory, sample: SteerSample): number {
  const turned = memory.primed ? angleDelta(memory.heading, sample.heading) : 0;
  memory.heading = sample.heading;
  memory.primed = true;
  if (sample.driverSteer !== null) {
    memory.steer = sample.driverSteer;
    return memory.steer;
  }
  if (sample.dt <= 0) return memory.steer;
  const target = steerForTurn(turned / sample.dt, sample.forward, sample.kind);
  memory.steer += (target - memory.steer) * easeShare(sample.dt);
  return memory.steer;
}
