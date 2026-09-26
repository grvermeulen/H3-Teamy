/**
 * Procedural poses for the character rig: idle breathing, walk and run cycles phased by distance
 * travelled, arms raised to aim or swing, and a death pose. Pure: the same input gives the same
 * pose.
 *
 * Rotations are Euler angles (XYZ order, radians) in each bone's bind frame. The character faces
 * +X with +Z to its right, so the Z component pitches a hanging limb forward (+) or back (−) and
 * leans the spine back (+) or forward (−); Y turns a bone about the vertical (+ turns the right
 * arm inward, − the left); X rolls it sideways (− lifts the right arm out, + the left).
 */
import { SIM_STEP_S } from "../sim/player";
import { BONES, PELVIS_HEIGHT_M, type BoneName } from "./characterRig";
import { isTwoHanded, type ModelWeapon } from "./weapons3d";

/** What a character can hold. */
export type HeldWeapon = ModelWeapon;

/** Everything a pose depends on. */
export type PoseInput = {
  /** Ground speed, m/s. */
  speed: number;
  /** Distance walked so far, metres; phases the gait. */
  phaseM: number;
  aiming: boolean;
  weapon: HeldWeapon | null;
  dead: boolean;
  /** Simulation tick; drives breathing. */
  tick: number;
  /** 0…1: 1 as a shot fires or a swing lands, easing back to 0. */
  recoil: number;
};

/** An Euler rotation `[x, y, z]`, radians. */
export type Euler3 = [number, number, number];

/** Rotation per bone; a bone left out stays at its bind rotation. */
export type BoneRotations = Partial<Record<BoneName, Euler3>>;

/** A full pose. */
export type Pose = {
  rotations: BoneRotations;
  /** Height of the pelvis bone above the ground along the character's own up axis, metres. */
  pelvisHeight: number;
  /** The character lies on the ground (dead): the caller tips it over onto its side. */
  lying: boolean;
};

/**
 * A pose written in place by {@link poseInto}: every bone owns one rotation array for the life of
 * the pose, so posing a character each frame allocates nothing.
 */
export type MutablePose = {
  rotations: Record<BoneName, Euler3>;
  pelvisHeight: number;
  lying: boolean;
};

/** Distance of one walking gait cycle (two steps), metres. */
export const WALK_STRIDE_M = 1.4;
/** Distance of one running gait cycle, metres. */
export const RUN_STRIDE_M = 2.2;
/** Above this speed the character runs, m/s. */
export const RUN_SPEED_MPS = 4;
/** Full swing of a thigh either side of vertical, radians. */
export const LEG_SWING_RAD = 0.6;
/** The legs reach their full swing at this speed, m/s. */
const FULL_SWING_SPEED_MPS = 2;
/** The running style (arm pump, lean, knee lift) fades in from this speed, m/s. */
const RUN_STYLE_FROM_MPS = 3.5;
/** …over this many m/s. */
const RUN_STYLE_SPAN_MPS = 1;
/** Knee bend on the back swing while walking and running, radians. */
const KNEE_BACK_WALK_RAD = 0.7;
const KNEE_BACK_RUN_RAD = 1.4;
/** A slight knee bend whenever the legs move, radians. */
const KNEE_SOFT_RAD = 0.1;
/** How much of a knee and thigh angle the foot takes back to stay flat, 0…1. */
const FOOT_LEVELLING = 0.4;
/** Arm swing as a share of the opposite thigh's swing, walking and running. */
const ARM_SWING_WALK = 0.8;
const ARM_SWING_RUN = 1.1;
/** Elbow bend at rest, walking and running, radians. */
const ELBOW_REST_RAD = 0.12;
const ELBOW_WALK_RAD = 0.25;
const ELBOW_RUN_RAD = 1.35;
/** The arms hang slightly away from the body, radians. */
const ARM_SPREAD_RAD = 0.08;
/** Forward lean of the spine at a full run, radians. */
const RUN_LEAN_RAD = 0.18;
/** Counter-twist of the chest against the pelvis per stride, radians. */
const TWIST_RAD = 0.1;
/** Length of one breath, seconds. */
const BREATH_PERIOD_S = 3.6;
/** Rise and fall of the chest while breathing, radians. */
const BREATH_RAD = 0.025;
/** Arms drift out as the chest fills, radians. */
const BREATH_SPREAD_RAD = 0.015;
/** Pelvis dip at the widest point of a walking and a running stride, metres. */
const WALK_BOB_M = 0.06;
const RUN_BOB_M = 0.08;
/** Upward kick of a gun arm at full recoil, radians. */
const RECOIL_KICK_RAD = 0.3;

/** Linear blend of two numbers. */
function mix(from: number, to: number, share: number): number {
  return from + (to - from) * share;
}

/** Clamps to 0…1. */
function unit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Writes one bone's rotation. */
function setRotation(
  out: MutablePose,
  bone: BoneName,
  x: number,
  y: number,
  z: number,
): void {
  const rotation = out.rotations[bone];
  rotation[0] = x;
  rotation[1] = y;
  rotation[2] = z;
}

/** Writes one bone's rotation from a stored one. */
function setEuler(out: MutablePose, bone: BoneName, euler: Euler3): void {
  setRotation(out, bone, euler[0], euler[1], euler[2]);
}

/** Writes one bone's rotation blended between two stored ones. */
function setMixed(
  out: MutablePose,
  bone: BoneName,
  from: Euler3,
  to: Euler3,
  share: number,
): void {
  setRotation(
    out,
    bone,
    mix(from[0], to[0], share),
    mix(from[1], to[1], share),
    mix(from[2], to[2], share),
  );
}

/** Phase angle, swing amount (0…1) and running share (0…1) of the gait. */
type Gait = { angle: number; amount: number; run: number };

/** Scratch gait, overwritten by every {@link poseInto} call so posing allocates nothing. */
const GAIT: Gait = { angle: 0, amount: 0, run: 0 };

/** Writes the gait at a speed and distance walked; the stride lengthens above {@link RUN_SPEED_MPS}. */
function gaitInto(speed: number, phaseM: number, gait: Gait): Gait {
  const stride = speed > RUN_SPEED_MPS ? RUN_STRIDE_M : WALK_STRIDE_M;
  gait.angle = (2 * Math.PI * phaseM) / stride;
  gait.amount = unit(speed / FULL_SWING_SPEED_MPS);
  gait.run = unit((speed - RUN_STYLE_FROM_MPS) / RUN_STYLE_SPAN_MPS);
  return gait;
}

/** Breathing, −1…1 over {@link BREATH_PERIOD_S}. */
function breathOf(tick: number): number {
  return Math.sin((2 * Math.PI * tick * SIM_STEP_S) / BREATH_PERIOD_S);
}

/** The thigh, shin and foot bones of each leg. */
const LEG_BONES = {
  L: ["upperLegL", "lowerLegL", "footL"],
  R: ["upperLegR", "lowerLegR", "footR"],
} as const;

/** One leg for a thigh swing: the knee bends while the thigh is behind, the foot stays level. */
function writeLeg(
  out: MutablePose,
  [thigh, shin, foot]: (typeof LEG_BONES)["L" | "R"],
  swing: number,
  gait: Gait,
): void {
  const backShare = Math.max(0, -swing / LEG_SWING_RAD);
  const knee = -(
    KNEE_SOFT_RAD * gait.amount +
    mix(KNEE_BACK_WALK_RAD, KNEE_BACK_RUN_RAD, gait.run) * backShare
  );
  setRotation(out, thigh, 0, 0, swing);
  setRotation(out, shin, 0, 0, knee);
  setRotation(out, foot, 0, 0, -(swing + knee) * FOOT_LEVELLING);
}

/** Both legs, half a cycle apart. */
function writeLegs(out: MutablePose, gait: Gait): void {
  const swing = LEG_SWING_RAD * gait.amount * Math.sin(gait.angle);
  writeLeg(out, LEG_BONES.L, swing, gait);
  writeLeg(out, LEG_BONES.R, -swing, gait);
}

/** Arms swinging against the legs, elbows bending more as the character runs. */
function writeFreeArms(out: MutablePose, gait: Gait, breath: number): void {
  const swing =
    LEG_SWING_RAD *
    gait.amount *
    Math.sin(gait.angle) *
    mix(ARM_SWING_WALK, ARM_SWING_RUN, gait.run);
  const elbow = mix(
    ELBOW_REST_RAD,
    mix(ELBOW_WALK_RAD, ELBOW_RUN_RAD, gait.run),
    gait.amount,
  );
  const spread = ARM_SPREAD_RAD + BREATH_SPREAD_RAD * breath;
  setRotation(out, "upperArmR", -spread, 0, swing);
  setRotation(out, "lowerArmR", 0, 0, elbow);
  setRotation(out, "upperArmL", spread, 0, -swing);
  setRotation(out, "lowerArmL", 0, 0, elbow);
}

/** Pelvis sway, running lean, chest counter-twist and breathing. */
function writeTorso(out: MutablePose, gait: Gait, breath: number): void {
  const twist = TWIST_RAD * gait.amount * Math.sin(gait.angle);
  const lean = RUN_LEAN_RAD * gait.run;
  const chestPitch = BREATH_RAD * breath;
  setRotation(out, "pelvis", 0, -twist, 0);
  setRotation(out, "spine", 0, 0, -lean);
  setRotation(out, "chest", 0, twist, chestPitch);
  setRotation(out, "head", 0, -twist / 2, lean / 2 - chestPitch);
}

/**
 * How a gun is held. The right hand grips the gun and the wrist keeps its barrel level (or dipped
 * by `drop`); for a two-handed gun the chest turns (`chestYaw`, the left shoulder leading) and the
 * left hand reaches the fore-end. The left-arm angles were solved offline so the hand lands on the
 * gun for all three builds, within a few centimetres.
 */
type GunStance = {
  upper: Euler3;
  /** Elbow bend, radians. */
  elbow: number;
  /** Muzzle dip below level, radians. */
  drop: number;
  chestYaw: number;
  left: { upper: Euler3; elbow: number } | null;
};

/** How each kind of gun is carried and aimed. */
const GUN_STANCES = {
  pistolCarry: {
    upper: [-0.08, 0, 0.12],
    elbow: 0.35,
    drop: 0,
    chestYaw: 0,
    left: null,
  },
  pistolAim: {
    upper: [0, 0.12, 1.5],
    elbow: 0,
    drop: 0,
    chestYaw: 0,
    left: null,
  },
  longCarry: {
    upper: [-0.15, 0.5, 0.3],
    elbow: 1.2,
    drop: 0.3,
    chestYaw: -0.4,
    left: { upper: [0.19, -0.41, 0.99], elbow: 0.01 },
  },
  rifleAim: {
    upper: [0, 0.6, 1.25],
    elbow: 1.1,
    drop: 0,
    chestYaw: -0.6,
    left: { upper: [-0.46, -0.06, 1.54], elbow: 0.46 },
  },
  shotgunAim: {
    upper: [0, 0.6, 1.25],
    elbow: 1.1,
    drop: 0,
    chestYaw: -0.6,
    left: { upper: [-0.78, 0.02, 1.82], elbow: 0.01 },
  },
  rocketCarry: {
    upper: [-0.05, 0.1, 0.35],
    elbow: 2.2,
    drop: 0.25,
    chestYaw: 0,
    left: { upper: [-0.63, -0.23, 0.97], elbow: 0.24 },
  },
  rocketAim: {
    upper: [0.03, 0.2, 0.61],
    elbow: 2.42,
    drop: 0,
    chestYaw: -0.2,
    left: { upper: [-0.58, -0.37, 0.95], elbow: 0.87 },
  },
} satisfies Record<string, GunStance>;

/** The stance for a gun, aimed or carried. */
function gunStance(weapon: HeldWeapon, aiming: boolean): GunStance {
  if (weapon === "rocket") {
    return aiming ? GUN_STANCES.rocketAim : GUN_STANCES.rocketCarry;
  }
  if (!isTwoHanded(weapon)) {
    return aiming ? GUN_STANCES.pistolAim : GUN_STANCES.pistolCarry;
  }
  if (!aiming) return GUN_STANCES.longCarry;
  return weapon === "shotgun" ? GUN_STANCES.shotgunAim : GUN_STANCES.rifleAim;
}

/** How much of the support arm's lift the left wrist takes back, 0…1. */
const SUPPORT_WRIST_SHARE = 0.6;
/** How much of the chest's turn the head undoes to keep looking ahead, 0…1. */
const HEAD_COUNTER_SHARE = 0.85;

/** Turns the chest by `yaw` and the head back most of the way, so the character looks ahead. */
function writeBlade(out: MutablePose, yaw: number): void {
  setRotation(out, "chest", 0, yaw, 0);
  setRotation(out, "head", 0, -yaw * HEAD_COUNTER_SHARE, 0);
}

/** Gun arms: the wrist keeps the barrel level; recoil kicks the arm up. */
function writeGunArms(
  out: MutablePose,
  input: PoseInput,
  weapon: HeldWeapon,
): void {
  const { upper, elbow, drop, chestYaw, left } = gunStance(
    weapon,
    input.aiming,
  );
  const kick = RECOIL_KICK_RAD * input.recoil;
  setRotation(out, "upperArmR", upper[0], upper[1], upper[2] + kick);
  setRotation(out, "lowerArmR", 0, 0, elbow);
  setRotation(out, "handR", 0, 0, -(upper[2] + elbow) - drop);
  if (chestYaw !== 0) writeBlade(out, chestYaw);
  if (left) {
    const wrist = -(left.upper[2] + left.elbow) * SUPPORT_WRIST_SHARE;
    setEuler(out, "upperArmL", left.upper);
    setRotation(out, "lowerArmL", 0, 0, left.elbow);
    setRotation(out, "handL", 0, 0, wrist);
  }
}

/** Both arms and the chest's turn while holding a bat two-handed. */
type BatStance = {
  chestYaw: number;
  upperR: Euler3;
  elbowR: number;
  /** Wrist pitch of the right hand, which sets the bat's angle. */
  handR: number;
  upperL: Euler3;
  elbowL: number;
};

/**
 * A bat wound up by the right ear (bat up and back), and swung through across the body (bat out
 * to the left). Solved offline so both fists stay on the handle.
 */
const BAT_STANCES = {
  windUp: {
    chestYaw: -0.3,
    upperR: [-0.48, 0.98, 2.88],
    elbowR: 2.73,
    handR: -3.21,
    upperL: [0.84, 0.76, 2.84],
    elbowL: 1.46,
  },
  swung: {
    chestYaw: 0.5,
    upperR: [-1.06, 0.44, 0.93],
    elbowR: 1.31,
    handR: -1.59,
    upperL: [-0.6, -0.19, 1.01],
    elbowL: 0.12,
  },
} satisfies Record<string, BatStance>;

/** The bat hangs from the right hand, tip angled down ahead of the feet. */
const BAT_LOW = {
  upper: [-0.08, 0, 0.2] as Euler3,
  elbow: 0.4,
  handR: -0.95,
};

/** Bat arms: low when idle; wound up to aim, swinging through as recoil peaks. */
function writeBatArms(out: MutablePose, input: PoseInput): void {
  if (!input.aiming && input.recoil === 0) {
    setEuler(out, "upperArmR", BAT_LOW.upper);
    setRotation(out, "lowerArmR", 0, 0, BAT_LOW.elbow);
    setRotation(out, "handR", 0, 0, BAT_LOW.handR);
    return;
  }
  const { windUp, swung } = BAT_STANCES;
  const share = input.recoil;
  const elbowL = mix(windUp.elbowL, swung.elbowL, share);
  const upperLPitch = mix(windUp.upperL[2], swung.upperL[2], share);
  writeBlade(out, mix(windUp.chestYaw, swung.chestYaw, share));
  setMixed(out, "upperArmR", windUp.upperR, swung.upperR, share);
  setRotation(out, "lowerArmR", 0, 0, mix(windUp.elbowR, swung.elbowR, share));
  setRotation(out, "handR", 0, 0, mix(windUp.handR, swung.handR, share));
  setMixed(out, "upperArmL", windUp.upperL, swung.upperL, share);
  setRotation(out, "lowerArmL", 0, 0, elbowL);
  setRotation(
    out,
    "handL",
    0,
    0,
    -(upperLPitch + elbowL) * SUPPORT_WRIST_SHARE,
  );
}

/** Fists up to guard and the right one thrown on recoil. */
const FIST_STANCES = {
  guardUpper: [-0.15, 0.35, 1] as Euler3,
  guardLower: [0, 0, 1.9] as Euler3,
  punchUpper: [0, 0.15, 1.5] as Euler3,
  punchLower: [0, 0, 0.05] as Euler3,
};

/** Unarmed arms when aiming or punching; the left guard mirrors the right. */
function writeFistArms(out: MutablePose, input: PoseInput): void {
  const { guardUpper, guardLower, punchUpper, punchLower } = FIST_STANCES;
  setMixed(out, "upperArmR", guardUpper, punchUpper, input.recoil);
  setMixed(out, "lowerArmR", guardLower, punchLower, input.recoil);
  setRotation(out, "upperArmL", -guardUpper[0], -guardUpper[1], guardUpper[2]);
  setEuler(out, "lowerArmL", guardLower);
}

/** Arm overrides for what the character holds; free arms are left as they swing. */
function writeHeldArms(out: MutablePose, input: PoseInput): void {
  const weapon = input.weapon;
  const readied = input.aiming || input.recoil > 0;
  if (weapon === null || weapon === "fist" || weapon === "cannon") {
    if (readied) writeFistArms(out, input);
  } else if (weapon === "bat") {
    writeBatArms(out, input);
  } else {
    writeGunArms(out, input, weapon);
  }
}

/** On its side in the recovery position: arms forward, the upper leg drawn up. */
const DEAD_ROTATIONS: BoneRotations = {
  spine: [0, 0, -0.1],
  head: [-0.3, 0.15, -0.2],
  upperArmL: [0.25, 0, 1.35],
  lowerArmL: [0, 0, 0.5],
  upperArmR: [-0.2, 0, 0.75],
  lowerArmR: [0, 0, 0.9],
  upperLegL: [0, 0, 0.25],
  lowerLegL: [0, 0, -0.35],
  upperLegR: [0, 0, 0.95],
  lowerLegR: [0, 0, -1.3],
  footR: [0, 0, 0.3],
};

/** Every bone back to its bind rotation, then the stored rotations of `rotations` on top. */
function resetRotations(out: MutablePose, rotations: BoneRotations): void {
  for (let index = 0; index < BONES.length; index += 1) {
    const bone = BONES[index];
    const stored = rotations[bone];
    if (stored) setEuler(out, bone, stored);
    else setRotation(out, bone, 0, 0, 0);
  }
}

/** No stored rotations: every bone at its bind rotation. */
const BIND_POSE: BoneRotations = {};

/**
 * A fresh pose, every bone at its bind rotation, for {@link poseInto} to write into.
 *
 * @returns A new mutable pose with one rotation array per bone.
 */
export function createPose(): MutablePose {
  const rotations = {} as Record<BoneName, Euler3>;
  for (const bone of BONES) rotations[bone] = [0, 0, 0];
  return { rotations, pelvisHeight: PELVIS_HEIGHT_M, lying: false };
}

/**
 * Writes this frame's pose into `out` without allocating: every bone is rewritten, so nothing
 * from the previous pose survives. Call it every frame with one pose per character.
 *
 * @param input - Speed, gait phase, aim, weapon, death, tick and recoil.
 * @param out - The pose to overwrite, from {@link createPose}.
 * @returns `out`.
 */
export function poseInto(input: PoseInput, out: MutablePose): MutablePose {
  if (input.dead) {
    resetRotations(out, DEAD_ROTATIONS);
    out.pelvisHeight = PELVIS_HEIGHT_M;
    out.lying = true;
    return out;
  }
  resetRotations(out, BIND_POSE);
  const gait = gaitInto(input.speed, input.phaseM, GAIT);
  const breath = breathOf(input.tick);
  writeTorso(out, gait, breath);
  writeLegs(out, gait);
  writeFreeArms(out, gait, breath);
  writeHeldArms(out, input);
  const bob =
    mix(WALK_BOB_M, RUN_BOB_M, gait.run) *
    gait.amount *
    Math.sin(gait.angle) ** 2;
  out.pelvisHeight = PELVIS_HEIGHT_M - bob;
  out.lying = false;
  return out;
}

/**
 * The pose of a character, freshly allocated: a convenience over {@link poseInto} for tests and
 * one-off use. Per-frame code should keep one pose and call {@link poseInto}.
 *
 * @param input - Speed, gait phase, aim, weapon, death, tick and recoil.
 * @returns Bone rotations, the pelvis height and whether it lies on the ground.
 */
export function poseFor(input: PoseInput): Pose {
  return poseInto(input, createPose());
}
