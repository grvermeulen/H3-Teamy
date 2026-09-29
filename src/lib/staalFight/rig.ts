import { DEG, clamp, lerp, type Vec } from "./math";
import type { FighterId, HandShape } from "./types";

/**
 * A pose as authored. Angles are in degrees.
 *
 * - `torso` leans the upper body (0 upright, + forward); `head` tilts the head on top of that.
 * - Arms are absolute: 0 hangs straight down, 90 points forward, 180 straight up. The elbow
 *   (`eF`/`eB`) flexes the forearm further round (0 straight, + bent).
 * - Legs are either angles (`hF`/`kF`: thigh from straight down, knee bend ≤ 0) or foot targets
 *   (`fF`/`fB`: `[forward, up]` from the floor under the hip), solved with two-bone IK.
 * - `reachF` points the front hand at the mouth or the eyes (drinking, adjusting the shades).
 * - `hip` is the hip height above the floor, `dx` shifts the body forward, `rot` pitches the
 *   whole figure around the hip (+ forward), for tumbles and lying on the floor.
 */
export type PoseSpec = {
  torso?: number;
  head?: number;
  sF?: number;
  eF?: number;
  sB?: number;
  eB?: number;
  hF?: number;
  kF?: number;
  hB?: number;
  kB?: number;
  fF?: readonly [number, number];
  fB?: readonly [number, number];
  reachF?: "mouth" | "eyes";
  hip?: number;
  dx?: number;
  rot?: number;
  handF?: HandShape;
  handB?: HandShape;
};

/** A resolved pose: every angle known, feet and reaches already solved. */
export type Pose = {
  torso: number;
  head: number;
  sF: number;
  eF: number;
  sB: number;
  eB: number;
  hF: number;
  kF: number;
  hB: number;
  kB: number;
  hip: number;
  dx: number;
  rot: number;
  handF: HandShape;
  handB: HandShape;
};

/** Bone lengths and the fighter's stance, in canvas pixels. */
export type Rig = {
  torso: number;
  neck: number;
  headR: number;
  upperArm: number;
  foreArm: number;
  thigh: number;
  shin: number;
  foot: number;
  /** How far below the neck the shoulders sit, along the spine. */
  shoulderDrop: number;
  /** Forward offset of the near (front) and far (back) shoulder: the 3/4 view. */
  shoulderF: number;
  shoulderB: number;
  hipF: number;
  hipB: number;
  stance: PoseSpec;
};

/** Staal: compact, heavy-shouldered, low fighting stance. */
const STAAL_RIG: Rig = {
  torso: 78,
  neck: 12,
  headR: 21,
  upperArm: 44,
  foreArm: 40,
  thigh: 50,
  shin: 48,
  foot: 24,
  shoulderDrop: 10,
  shoulderF: 7,
  shoulderB: -7,
  hipF: 5,
  hipB: -5,
  stance: {
    torso: 10,
    head: -4,
    sF: 60,
    eF: 100,
    sB: 35,
    eB: 118,
    fF: [36, 0],
    fB: [-40, 0],
    hip: 86,
    dx: 0,
    rot: 0,
    handF: "fist",
    handB: "fist",
  },
};

/** Trump: taller, upright, a businessman's idea of a guard. */
const TRUMP_RIG: Rig = {
  torso: 84,
  neck: 8,
  headR: 23,
  upperArm: 44,
  foreArm: 38,
  thigh: 52,
  shin: 50,
  foot: 26,
  shoulderDrop: 10,
  shoulderF: 8,
  shoulderB: -8,
  hipF: 6,
  hipB: -6,
  stance: {
    torso: 3,
    head: 2,
    sF: 40,
    eF: 88,
    sB: 25,
    eB: 96,
    fF: [26, 0],
    fB: [-28, 0],
    hip: 94,
    dx: 0,
    rot: 0,
    handF: "fist",
    handB: "fist",
  },
};

/** Both rigs, by fighter. */
export const RIGS: Record<FighterId, Rig> = {
  staal: STAAL_RIG,
  trump: TRUMP_RIG,
};

/** Unit vector pointing "up" along an angle measured from straight up, + forward. */
function up(a: number): Vec {
  return { x: Math.sin(a), y: -Math.cos(a) };
}

/** Unit vector for an angle measured from straight down, + forward. */
function down(a: number): Vec {
  return { x: Math.sin(a), y: Math.cos(a) };
}

function add(a: Vec, b: Vec, k = 1): Vec {
  return { x: a.x + b.x * k, y: a.y + b.y * k };
}

/**
 * Rotates a point clockwise on screen (positive = pitch forward for a right-facing figure).
 *
 * @param p - The point.
 * @param a - Angle in radians.
 * @returns The rotated point.
 */
export function rotate(p: Vec, a: number): Vec {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/**
 * Two-bone IK for a leg: the thigh and knee angles that put the foot on a target, knee forward.
 *
 * @param l1 - Thigh length.
 * @param l2 - Shin length.
 * @param hipX - Forward offset of this hip joint.
 * @param hipH - Hip height above the floor.
 * @param foot - Target `[forward, up]` from the floor under the hip.
 * @returns Thigh angle and knee bend, in degrees.
 */
export function legIK(
  l1: number,
  l2: number,
  hipX: number,
  hipH: number,
  foot: readonly [number, number],
): { h: number; k: number } {
  const vx = foot[0] - hipX;
  const vy = hipH - foot[1];
  const d = clamp(Math.hypot(vx, vy), Math.abs(l1 - l2) + 0.5, l1 + l2 - 0.01);
  const a = Math.atan2(vx, vy);
  const alpha = Math.acos(
    clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1),
  );
  const beta = Math.acos(
    clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1),
  );
  return { h: (a + alpha) / DEG, k: -(Math.PI - beta) / DEG };
}

/**
 * Two-bone IK for an arm: the shoulder and elbow angles that put the hand on a target, elbow low.
 *
 * @param l1 - Upper-arm length.
 * @param l2 - Forearm length.
 * @param shoulder - The shoulder, in hip-local space.
 * @param target - Where the hand should go, in hip-local space.
 * @returns Shoulder angle and elbow flex, in degrees.
 */
export function armIK(
  l1: number,
  l2: number,
  shoulder: Vec,
  target: Vec,
): { s: number; e: number } {
  const vx = target.x - shoulder.x;
  const vy = target.y - shoulder.y;
  const d = clamp(Math.hypot(vx, vy), Math.abs(l1 - l2) + 0.5, l1 + l2 - 0.01);
  const a = Math.atan2(vx, vy);
  const alpha = Math.acos(
    clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1),
  );
  const beta = Math.acos(
    clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1),
  );
  return { s: (a - alpha) / DEG, e: (Math.PI - beta) / DEG };
}

/** Spine points that depend only on torso and head angles. */
function spine(
  rig: Rig,
  torsoDeg: number,
  headDeg: number,
): { neck: Vec; shoulderBase: Vec; head: Vec; headAngle: number } {
  const t = torsoDeg * DEG;
  const neck = add({ x: 0, y: 0 }, up(t), rig.torso);
  const shoulderBase = add(neck, up(t), -rig.shoulderDrop);
  const headAngle = (torsoDeg + headDeg) * DEG;
  const head = add(neck, up(headAngle), rig.neck + rig.headR);
  return { neck, shoulderBase, head, headAngle };
}

/**
 * Where a point in the head's own frame (x forward, y down, origin at the head centre) lands.
 *
 * @param head - Head centre.
 * @param headAngle - Head angle in radians.
 * @param local - The point in the head frame.
 * @returns The point in hip-local space.
 */
export function headPoint(head: Vec, headAngle: number, local: Vec): Vec {
  return add(head, rotate(local, headAngle));
}

/** Mouth and eyes in the head frame, as fractions of the head radius. */
const MOUTH = { x: 0.62, y: 0.5 };
const EYES = { x: 0.6, y: -0.2 };

/**
 * Fills in a pose: stance defaults, IK for feet and reaches.
 *
 * @param spec - The authored pose (overrides on top of the stance).
 * @param rig - The fighter's rig.
 * @returns A fully resolved pose.
 */
export function resolvePose(spec: PoseSpec, rig: Rig): Pose {
  const st = rig.stance;
  const hip = spec.hip ?? st.hip ?? 90;
  const torso = spec.torso ?? st.torso ?? 0;
  const head = spec.head ?? st.head ?? 0;

  const leg = (
    angle: number | undefined,
    knee: number | undefined,
    target: readonly [number, number] | undefined,
    stAngle: number | undefined,
    stKnee: number | undefined,
    stTarget: readonly [number, number] | undefined,
    hipX: number,
  ): { h: number; k: number } => {
    if (angle !== undefined) return { h: angle, k: knee ?? 0 };
    const foot = target ?? stTarget;
    if (foot) return legIK(rig.thigh, rig.shin, hipX, hip, foot);
    return { h: stAngle ?? 0, k: stKnee ?? 0 };
  };
  const front = leg(spec.hF, spec.kF, spec.fF, st.hF, st.kF, st.fF, rig.hipF);
  const back = leg(spec.hB, spec.kB, spec.fB, st.hB, st.kB, st.fB, rig.hipB);

  let sF = spec.sF ?? st.sF ?? 0;
  let eF = spec.eF ?? st.eF ?? 0;
  if (spec.reachF) {
    const sp = spine(rig, torso, head);
    const shoulder = add(sp.shoulderBase, { x: rig.shoulderF, y: 0 });
    const aim = spec.reachF === "mouth" ? MOUTH : EYES;
    const target = headPoint(sp.head, sp.headAngle, {
      x: aim.x * rig.headR,
      y: aim.y * rig.headR,
    });
    const ik = armIK(rig.upperArm, rig.foreArm, shoulder, target);
    sF = ik.s;
    eF = ik.e;
  }

  return {
    torso,
    head,
    sF,
    eF,
    sB: spec.sB ?? st.sB ?? 0,
    eB: spec.eB ?? st.eB ?? 0,
    hF: front.h,
    kF: front.k,
    hB: back.h,
    kB: back.k,
    hip,
    dx: spec.dx ?? 0,
    rot: spec.rot ?? 0,
    handF: spec.handF ?? st.handF ?? "fist",
    handB: spec.handB ?? st.handB ?? "fist",
  };
}

const ANGLE_KEYS = [
  "torso",
  "head",
  "sF",
  "eF",
  "sB",
  "eB",
  "hF",
  "kF",
  "hB",
  "kB",
  "hip",
  "dx",
  "rot",
] as const;

/**
 * Blends two resolved poses. Hands switch at the halfway point.
 *
 * @param a - Pose at `t = 0`.
 * @param b - Pose at `t = 1`.
 * @param t - Progress.
 * @returns The blended pose.
 */
export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const out = { ...a };
  for (const k of ANGLE_KEYS) out[k] = lerp(a[k], b[k], t);
  out.handF = t < 0.5 ? a.handF : b.handF;
  out.handB = t < 0.5 ? a.handB : b.handB;
  return out;
}

/** Every joint of a posed figure in hip-local space (facing right, y down, before `rot`). */
export type Joints = {
  hip: Vec;
  neck: Vec;
  head: Vec;
  headAngle: number;
  torsoAngle: number;
  shoulderF: Vec;
  elbowF: Vec;
  handF: Vec;
  shoulderB: Vec;
  elbowB: Vec;
  handB: Vec;
  hipF: Vec;
  kneeF: Vec;
  ankleF: Vec;
  toeF: Vec;
  hipB: Vec;
  kneeB: Vec;
  ankleB: Vec;
  toeB: Vec;
  /** Absolute limb angles in radians, measured from straight down. */
  upperArmF: number;
  foreArmF: number;
  upperArmB: number;
  foreArmB: number;
  thighF: number;
  shinF: number;
  thighB: number;
  shinB: number;
};

/**
 * Forward kinematics: every joint of a pose.
 *
 * @param p - The resolved pose.
 * @param rig - The fighter's rig.
 * @returns Joints in hip-local space, facing right, before the whole-body `rot`.
 */
export function solveJoints(p: Pose, rig: Rig): Joints {
  const sp = spine(rig, p.torso, p.head);
  const shoulderF = add(sp.shoulderBase, { x: rig.shoulderF, y: 0 });
  const shoulderB = add(sp.shoulderBase, { x: rig.shoulderB, y: 0 });
  const upperArmF = p.sF * DEG;
  const foreArmF = (p.sF + p.eF) * DEG;
  const upperArmB = p.sB * DEG;
  const foreArmB = (p.sB + p.eB) * DEG;
  const elbowF = add(shoulderF, down(upperArmF), rig.upperArm);
  const handF = add(elbowF, down(foreArmF), rig.foreArm);
  const elbowB = add(shoulderB, down(upperArmB), rig.upperArm);
  const handB = add(elbowB, down(foreArmB), rig.foreArm);

  const hipF = { x: rig.hipF, y: 0 };
  const hipB = { x: rig.hipB, y: 0 };
  const thighF = p.hF * DEG;
  const shinF = (p.hF + p.kF) * DEG;
  const thighB = p.hB * DEG;
  const shinB = (p.hB + p.kB) * DEG;
  const kneeF = add(hipF, down(thighF), rig.thigh);
  const ankleF = add(kneeF, down(shinF), rig.shin);
  const toeF = add(ankleF, down(shinF + Math.PI / 2), rig.foot);
  const kneeB = add(hipB, down(thighB), rig.thigh);
  const ankleB = add(kneeB, down(shinB), rig.shin);
  const toeB = add(ankleB, down(shinB + Math.PI / 2), rig.foot);

  return {
    hip: { x: 0, y: 0 },
    neck: sp.neck,
    head: sp.head,
    headAngle: sp.headAngle,
    torsoAngle: p.torso * DEG,
    shoulderF,
    elbowF,
    handF,
    shoulderB,
    elbowB,
    handB,
    hipF,
    kneeF,
    ankleF,
    toeF,
    hipB,
    kneeB,
    ankleB,
    toeB,
    upperArmF,
    foreArmF,
    upperArmB,
    foreArmB,
    thighF,
    shinF,
    thighB,
    shinB,
  };
}

/**
 * The hip-local position of a named body point.
 *
 * @param j - Solved joints.
 * @param rig - The rig (for the head radius).
 * @param limb - Which point.
 * @returns The point, facing right, before `rot`.
 */
export function limbPoint(
  j: Joints,
  rig: Rig,
  limb:
    | "handF"
    | "handB"
    | "footF"
    | "footB"
    | "kneeF"
    | "elbowF"
    | "head"
    | "mouth"
    | "chest"
    | "hip",
): Vec {
  switch (limb) {
    case "handF":
      return j.handF;
    case "handB":
      return j.handB;
    case "footF":
      return { x: (j.ankleF.x + j.toeF.x) / 2, y: (j.ankleF.y + j.toeF.y) / 2 };
    case "footB":
      return { x: (j.ankleB.x + j.toeB.x) / 2, y: (j.ankleB.y + j.toeB.y) / 2 };
    case "kneeF":
      return j.kneeF;
    case "elbowF":
      return j.elbowF;
    case "head":
      return j.head;
    case "mouth":
      return headPoint(j.head, j.headAngle, {
        x: MOUTH.x * rig.headR,
        y: MOUTH.y * rig.headR,
      });
    case "chest":
      return { x: (j.neck.x + j.hip.x) / 2 + 6, y: (j.neck.y * 2) / 3 };
    case "hip":
      return j.hip;
  }
}
