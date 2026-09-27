/**
 * Which of a glTF character's clips play, and how strongly, for a pose (spec §7, "Runtime"):
 * idle, walk and run cross-weighted by the measured speed, their cycles paced by the stride so the
 * feet do not slide; a raised gun on the upper body while aiming; a shot, punch or bat swing played
 * once on a fresh recoil; and the death, once, held on its last frame. Pure and allocation-free
 * through {@link clipMixInto}.
 */
import type { CharacterRig, ClipRole } from "../characterManifest";
import type { WeaponKind } from "../sim/types";
import { RUN_SPEED_MPS, type PoseInput } from "./characterPose";

/** The clips of the gait, blended by speed. */
export type GaitRole = "idle" | "walk" | "run";

/** How far one full cycle of the walk and of the run carries a model, metres. */
export type GaitStride = { walkM: number; runM: number };

/** One gait clip's share. */
export type BaseWeight = { role: GaitRole; weight: number };

/** What plays this frame. */
export type ClipMix = {
  /** Idle, walk and run, weights summing to one (all zero when dead). */
  base: BaseWeight[];
  /**
   * Gait cycles per second: the walk and run advance together at this pace, which carries the
   * body as far per cycle as the blended stride.
   */
  cyclesPerSecond: number;
  /** A pose held by the upper body over the gait (the raised gun), or `null`. */
  upper: { role: ClipRole; weight: number } | null;
  /** A clip to start now and play once (a shot, a punch, a swing, the death), or `null`. */
  once: ClipRole | null;
};

/**
 * Each rig's stride at its own size, measured from the packed clips (the foot's travel while it is
 * planted, times the cycle): the men's walk carries 1.84 m per 1.33 s cycle, their run 2.37 m per
 * 0.79 s; the women's 1.78 m per 1.67 s and 2.39 m per 1.00 s. A scaled character scales these.
 */
export const RIG_STRIDES: Record<CharacterRig, GaitStride> = {
  men: { walkM: 1.84, runM: 2.37 },
  women: { walkM: 1.78, runM: 2.39 },
};

/** Below this speed the character stands, m/s. */
const IDLE_BELOW_MPS = 0.15;
/** The walk has fully replaced the idle at this speed, m/s. */
const WALK_FULL_MPS = 0.8;
/** The run fades in over this span around {@link RUN_SPEED_MPS}, m/s. */
const RUN_BLEND_MPS = 1;
/** Bones of the upper body: the raised gun and the one-off clips move only these. */
const UPPER_BODY_BONES =
  /^(Torso|Chest|Neck|Head|Shoulder|UpperArm|LowerArm|Wrist|Index|Middle|Ring|Pinky|Thumb)/;
/** Weapons swung rather than fired, and the tank's cannon, which no one carries. */
const NOT_GUNS: ReadonlySet<WeaponKind> = new Set<WeaponKind>([
  "fist",
  "bat",
  "cannon",
]);

/** Clamps to 0…1. */
function unit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * A fresh mix to write into with {@link clipMixInto}.
 *
 * @returns A mix standing idle.
 */
export function createClipMix(): ClipMix {
  return {
    base: [
      { role: "idle", weight: 1 },
      { role: "walk", weight: 0 },
      { role: "run", weight: 0 },
    ],
    cyclesPerSecond: 0,
    upper: null,
    once: null,
  };
}

/** The raised-gun overlay, shared by every mix (it never changes). */
const GUN_RAISED = Object.freeze({ role: "gunIdle" as const, weight: 1 });

/** Writes the gait weights and pace for a speed. */
function writeGait(out: ClipMix, speed: number, stride: GaitStride): void {
  const moving = unit(
    (speed - IDLE_BELOW_MPS) / (WALK_FULL_MPS - IDLE_BELOW_MPS),
  );
  const running = unit(
    (speed - (RUN_SPEED_MPS - RUN_BLEND_MPS / 2)) / RUN_BLEND_MPS,
  );
  out.base[0].weight = 1 - moving;
  out.base[1].weight = moving * (1 - running);
  out.base[2].weight = moving * running;
  const strideM = stride.walkM + (stride.runM - stride.walkM) * running;
  out.cyclesPerSecond = speed / strideM;
}

/** The one-off clip a fresh recoil starts for what the character holds. */
function onceFor(weapon: WeaponKind | null): ClipRole {
  if (weapon === "bat") return "swing";
  if (weapon === null || NOT_GUNS.has(weapon)) return "punch";
  return "gunShoot";
}

/**
 * Writes what plays for a pose into `out` without allocating.
 *
 * @param pose - Speed, aim, weapon, death and recoil (the gait phase and tick are not used).
 * @param stride - The rig's stride per walk and run cycle.
 * @param out - The mix to overwrite, from {@link createClipMix}.
 * @returns `out`.
 */
export function clipMixInto(
  pose: PoseInput,
  stride: GaitStride,
  out: ClipMix,
): ClipMix {
  if (pose.dead) {
    for (const entry of out.base) entry.weight = 0;
    out.cyclesPerSecond = 0;
    out.upper = null;
    out.once = "death";
    return out;
  }
  writeGait(out, pose.speed, stride);
  const gun = pose.weapon !== null && !NOT_GUNS.has(pose.weapon);
  out.upper = gun && pose.aiming ? GUN_RAISED : null;
  out.once = pose.recoil === 1 ? onceFor(pose.weapon) : null;
  return out;
}

/**
 * What plays for a pose, freshly allocated: a convenience over {@link clipMixInto} for tests and
 * one-off use.
 *
 * @param pose - Speed, aim, weapon, death and recoil.
 * @param stride - The rig's stride per walk and run cycle.
 * @returns The mix.
 */
export function clipMix(pose: PoseInput, stride: GaitStride): ClipMix {
  return clipMixInto(pose, stride, createClipMix());
}

/**
 * Whether an animation track moves the upper body (spine above the waist, arms, hands, neck and
 * head), judged by its bone name as three.js names tracks (`UpperArmR.quaternion`).
 *
 * @param trackName - The track's name.
 * @returns `true` for the upper body.
 */
export function isUpperBodyTrack(trackName: string): boolean {
  return UPPER_BODY_BONES.test(trackName);
}
