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
import { PELVIS_HEIGHT_M, type BoneName } from "./characterRig";
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

const ZERO: Euler3 = [0, 0, 0];

/** Linear blend of two numbers. */
function mix(from: number, to: number, share: number): number {
  return from + (to - from) * share;
}

/** Linear blend of two rotations. */
function mixEuler(from: Euler3, to: Euler3, share: number): Euler3 {
  return [
    mix(from[0], to[0], share),
    mix(from[1], to[1], share),
    mix(from[2], to[2], share),
  ];
}

/** A right-side rotation as seen on the left: roll and turn change sign. */
function mirror([x, y, z]: Euler3): Euler3 {
  return [-x, -y, z];
}

/** Clamps to 0…1. */
function unit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Phase angle, swing amount (0…1) and running share (0…1) of the gait. */
type Gait = { angle: number; amount: number; run: number };

/** The gait at a speed and distance walked; the stride lengthens above {@link RUN_SPEED_MPS}. */
function gaitOf(speed: number, phaseM: number): Gait {
  const stride = speed > RUN_SPEED_MPS ? RUN_STRIDE_M : WALK_STRIDE_M;
  return {
    angle: (2 * Math.PI * phaseM) / stride,
    amount: unit(speed / FULL_SWING_SPEED_MPS),
    run: unit((speed - RUN_STYLE_FROM_MPS) / RUN_STYLE_SPAN_MPS),
  };
}

/** Breathing, −1…1 over {@link BREATH_PERIOD_S}. */
function breathOf(tick: number): number {
  return Math.sin((2 * Math.PI * tick * SIM_STEP_S) / BREATH_PERIOD_S);
}

/** One leg for a thigh swing: the knee bends while the thigh is behind, the foot stays level. */
function legRotations(swing: number, gait: Gait): [Euler3, Euler3, Euler3] {
  const backShare = Math.max(0, -swing / LEG_SWING_RAD);
  const knee = -(
    KNEE_SOFT_RAD * gait.amount +
    mix(KNEE_BACK_WALK_RAD, KNEE_BACK_RUN_RAD, gait.run) * backShare
  );
  return [
    [0, 0, swing],
    [0, 0, knee],
    [0, 0, -(swing + knee) * FOOT_LEVELLING],
  ];
}

/** Both legs, half a cycle apart. */
function legs(gait: Gait): BoneRotations {
  const swing = LEG_SWING_RAD * gait.amount * Math.sin(gait.angle);
  const [upperLegL, lowerLegL, footL] = legRotations(swing, gait);
  const [upperLegR, lowerLegR, footR] = legRotations(-swing, gait);
  return { upperLegL, lowerLegL, footL, upperLegR, lowerLegR, footR };
}

/** Arms swinging against the legs, elbows bending more as the character runs. */
function freeArms(gait: Gait, breath: number): BoneRotations {
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
  const upperArmR: Euler3 = [-spread, 0, swing];
  const lowerArmR: Euler3 = [0, 0, elbow];
  return {
    upperArmR,
    lowerArmR,
    upperArmL: mirror([-spread, 0, -swing]),
    lowerArmL: lowerArmR,
  };
}

/** Pelvis sway, running lean, chest counter-twist and breathing. */
function torso(gait: Gait, breath: number): BoneRotations {
  const twist = TWIST_RAD * gait.amount * Math.sin(gait.angle);
  const lean = RUN_LEAN_RAD * gait.run;
  const chestPitch = BREATH_RAD * breath;
  return {
    pelvis: [0, -twist, 0],
    spine: [0, 0, -lean],
    chest: [0, twist, chestPitch],
    head: [0, -twist / 2, lean / 2 - chestPitch],
  };
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

/** Gun arms: the wrist keeps the barrel level; recoil kicks the arm up. */
function gunArms(input: PoseInput, weapon: HeldWeapon): BoneRotations {
  const { upper, elbow, drop, chestYaw, left } = gunStance(
    weapon,
    input.aiming,
  );
  const arms: BoneRotations = {
    upperArmR: [upper[0], upper[1], upper[2] + RECOIL_KICK_RAD * input.recoil],
    lowerArmR: [0, 0, elbow],
    handR: [0, 0, -(upper[2] + elbow) - drop],
  };
  if (chestYaw !== 0) {
    arms.chest = [0, chestYaw, 0];
    arms.head = [0, -chestYaw * HEAD_COUNTER_SHARE, 0];
  }
  if (left) {
    arms.upperArmL = left.upper;
    arms.lowerArmL = [0, 0, left.elbow];
    arms.handL = [0, 0, -(left.upper[2] + left.elbow) * SUPPORT_WRIST_SHARE];
  }
  return arms;
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
function batArms(input: PoseInput): BoneRotations {
  if (!input.aiming && input.recoil === 0) {
    return {
      upperArmR: BAT_LOW.upper,
      lowerArmR: [0, 0, BAT_LOW.elbow],
      handR: [0, 0, BAT_LOW.handR],
    };
  }
  const { windUp, swung } = BAT_STANCES;
  const share = input.recoil;
  const upperL = mixEuler(windUp.upperL, swung.upperL, share);
  const elbowL = mix(windUp.elbowL, swung.elbowL, share);
  const chestYaw = mix(windUp.chestYaw, swung.chestYaw, share);
  return {
    chest: [0, chestYaw, 0],
    head: [0, -chestYaw * HEAD_COUNTER_SHARE, 0],
    upperArmR: mixEuler(windUp.upperR, swung.upperR, share),
    lowerArmR: [0, 0, mix(windUp.elbowR, swung.elbowR, share)],
    handR: [0, 0, mix(windUp.handR, swung.handR, share)],
    upperArmL: upperL,
    lowerArmL: [0, 0, elbowL],
    handL: [0, 0, -(upperL[2] + elbowL) * SUPPORT_WRIST_SHARE],
  };
}

/** Fists up to guard and the right one thrown on recoil. */
const FIST_STANCES = {
  guardUpper: [-0.15, 0.35, 1] as Euler3,
  guardLower: [0, 0, 1.9] as Euler3,
  punchUpper: [0, 0.15, 1.5] as Euler3,
  punchLower: [0, 0, 0.05] as Euler3,
};

/** Unarmed arms when aiming or punching. */
function fistArms(input: PoseInput): BoneRotations {
  const { guardUpper, guardLower, punchUpper, punchLower } = FIST_STANCES;
  return {
    upperArmR: mixEuler(guardUpper, punchUpper, input.recoil),
    lowerArmR: mixEuler(guardLower, punchLower, input.recoil),
    upperArmL: mirror(guardUpper),
    lowerArmL: guardLower,
  };
}

/** Arm overrides for what the character holds, or none when its arms swing freely. */
function heldArms(input: PoseInput): BoneRotations {
  const weapon = input.weapon;
  const readied = input.aiming || input.recoil > 0;
  if (weapon === null || weapon === "fist" || weapon === "cannon") {
    return readied ? fistArms(input) : {};
  }
  return weapon === "bat" ? batArms(input) : gunArms(input, weapon);
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

/**
 * The pose of a character this frame.
 *
 * @param input - Speed, gait phase, aim, weapon, death, tick and recoil.
 * @returns Bone rotations, the pelvis height and whether it lies on the ground.
 */
export function poseFor(input: PoseInput): Pose {
  if (input.dead) {
    return {
      rotations: { ...DEAD_ROTATIONS },
      pelvisHeight: PELVIS_HEIGHT_M,
      lying: true,
    };
  }
  const gait = gaitOf(input.speed, input.phaseM);
  const breath = breathOf(input.tick);
  const rotations: BoneRotations = {
    ...torso(gait, breath),
    ...legs(gait),
    ...freeArms(gait, breath),
    ...heldArms(input),
  };
  const bob =
    mix(WALK_BOB_M, RUN_BOB_M, gait.run) *
    gait.amount *
    Math.sin(gait.angle) ** 2;
  return { rotations, pelvisHeight: PELVIS_HEIGHT_M - bob, lying: false };
}

/**
 * A bone's rotation in a pose.
 *
 * @param rotations - The pose's rotations.
 * @param bone - The bone.
 * @returns Its rotation, or no rotation when the pose leaves it out.
 */
export function rotationOf(rotations: BoneRotations, bone: BoneName): Euler3 {
  return rotations[bone] ?? ZERO;
}
