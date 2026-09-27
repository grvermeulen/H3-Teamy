/**
 * The sounds the local player makes by moving (immersion spec §6): a footstep at every footfall
 * while walking or running, and a tyre squeal when their car corners or brakes hard. Pure
 * trackers fed once per rendered frame; both count simulation ticks rather than frames, so the
 * cadence is the same at 30, 60 or 144 frames a second and on a client whose ticks arrive in
 * bursts.
 */

import { SIM_STEP_S } from "../sim/player";

/**
 * Metres between two footfalls walking: half a gait cycle. The cycle lengths mirror
 * `WALK_STRIDE_M` / `RUN_STRIDE_M` (1.4 m / 2.2 m) in `render3d/characterPose.ts`, duplicated
 * rather than imported so the 2D bundle never pulls in the lazily loaded 3D chunk; the steps are
 * heard where the 3D legs land.
 */
export const WALK_STEP_M = 0.7;
/** Metres between two footfalls running (half the 2.2 m running cycle). */
export const RUN_STEP_M = 1.1;
/** Above this speed the gait is a run (`RUN_SPEED_MPS` in `characterPose.ts`), m/s. */
export const RUN_SPEED_MPS = 4;
/** Below this speed the player is standing still, m/s. */
const MIN_STEP_SPEED_MPS = 0.3;

/** A car corners hard enough to squeal past this sideways acceleration, m/s². */
const SKID_LATERAL_MPS2 = 24;
/** …or brakes hard enough past this deceleration, m/s². */
const SKID_DECEL_MPS2 = 12;
/** Deceleration beyond this is a crash, which the impact voices; not a skid, m/s². */
const SKID_CRASH_DECEL_MPS2 = 40;
/** Below this speed nothing squeals, m/s. */
const SKID_MIN_SPEED_MPS = 10;
/** Seconds after a squeal before the next one may start. */
export const SKID_COOLDOWN_S = 1.5;

/** The local player's motion this frame, as the sound needs it. */
export type SelfMotion = {
  /** The simulation tick the motion belongs to. */
  tick: number;
  /** Walking: alive and not in a car. */
  onFoot: boolean;
  /** Walking speed, m/s. */
  speedMps: number;
  /** The car they drive, or `null` on foot. */
  car: { forwardMps: number; heading: number } | null;
};

/** A tracker fed once per frame; `step` says whether this frame's cue sounds. */
export type SelfCue = { step(motion: SelfMotion): boolean };

/** Ticks between the tick seen before and this one; none for the first or a tick that went back. */
function ticksSince(previousTick: number | null, tick: number): number {
  return previousTick === null ? 0 : Math.max(0, tick - previousTick);
}

/**
 * Counts the distance walked and says when a foot lands: every {@link WALK_STEP_M} walking and
 * every {@link RUN_STEP_M} running. Standing still or getting in a car starts the count over.
 *
 * @returns The tracker.
 */
export function createFootsteps(): SelfCue {
  let lastTick: number | null = null;
  let travelledM = 0;
  return {
    step(motion: SelfMotion): boolean {
      const ticks = ticksSince(lastTick, motion.tick);
      lastTick = motion.tick;
      if (!motion.onFoot || motion.speedMps < MIN_STEP_SPEED_MPS) {
        travelledM = 0;
        return false;
      }
      travelledM += motion.speedMps * ticks * SIM_STEP_S;
      const stepM = motion.speedMps > RUN_SPEED_MPS ? RUN_STEP_M : WALK_STEP_M;
      if (travelledM < stepM) return false;
      travelledM %= stepM;
      return true;
    },
  };
}

/** The shortest signed turn from `from` to `to`, radians. */
function turnBetween(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/** What the skid detector remembers of the car's last tick. */
type CarSample = { tick: number; forwardMps: number; heading: number };

/** True when the move from `previous` to `current` is a slide: hard cornering or hard braking. */
function isSliding(previous: CarSample, current: CarSample): boolean {
  const seconds = (current.tick - previous.tick) * SIM_STEP_S;
  const speed = Math.abs(current.forwardMps);
  const before = Math.abs(previous.forwardMps);
  if (Math.max(speed, before) < SKID_MIN_SPEED_MPS) return false;
  const turnRate =
    Math.abs(turnBetween(previous.heading, current.heading)) / seconds;
  const deceleration = (before - speed) / seconds;
  const braking =
    deceleration >= SKID_DECEL_MPS2 && deceleration <= SKID_CRASH_DECEL_MPS2;
  return speed * turnRate >= SKID_LATERAL_MPS2 || braking;
}

/**
 * Watches the player's car and says when a slide starts: sideways acceleration (speed × turn
 * rate) or braking past its threshold. One squeal per slide, and none within
 * {@link SKID_COOLDOWN_S} of the last.
 *
 * @returns The tracker.
 */
export function createSkidDetector(): SelfCue {
  let last: CarSample | null = null;
  let sliding = false;
  let quietUntilTick = -Infinity;
  const cooldownTicks = Math.round(SKID_COOLDOWN_S / SIM_STEP_S);
  return {
    step({ tick, car }: SelfMotion): boolean {
      if (!car) {
        last = null;
        sliding = false;
        return false;
      }
      const current: CarSample = { tick, ...car };
      const previous = last;
      if (previous?.tick === tick) return false;
      last = current;
      // A tick that went back is a new world (a rejoin, a reset): start watching afresh.
      if (!previous || tick < previous.tick) return false;
      const slidingNow = isSliding(previous, current);
      const starts = slidingNow && !sliding && tick >= quietUntilTick;
      sliding = slidingNow;
      if (starts) quietUntilTick = tick + cooldownTicks;
      return starts;
    },
  };
}
