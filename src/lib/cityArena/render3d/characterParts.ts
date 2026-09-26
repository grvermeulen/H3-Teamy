/**
 * The body, face and hair of a character as rigid parts, each a painted low-poly block bound to
 * one bone. Every part is authored in the bind pose, in the character's space (+X forward, +Y up,
 * +Z to its right). Accessories live in `characterExtras.ts`.
 */
import type { BufferGeometry } from "three";
import type { LookSpec } from "./characterLooks";
import type { BoneName, Joints, Proportions } from "./characterRig";
import { block, shade, type BlockSpec, type Vec3 } from "./lowPoly";

/** A painted piece of geometry that follows one bone. */
export type RigPart = {
  geometry: BufferGeometry;
  bone: BoneName;
  /** Drawn unlit, so it reads as a light source. */
  glow?: boolean;
};

/** What every part builder needs to know about the character. */
export type PartContext = {
  look: LookSpec;
  p: Proportions;
  joints: Joints;
  /** The vest colour of another player, or `null` for a look without a vest. */
  vest: number | null;
};

/** Left or right; the left side lies toward −z. */
export type Side = "L" | "R";

/**
 * The sign of z on a side.
 *
 * @param side - `L` or `R`.
 * @returns −1 for the left, +1 for the right.
 */
export function sideSign(side: Side): number {
  return side === "L" ? -1 : 1;
}

/** The deltoid is this much wider than the upper arm; the rig sets the shoulders by it. */
export const DELTOID_SCALE = 1.2;

/** Chin to crown of the character, metres. */
function headHeight(ctx: PartContext): number {
  return ctx.p.height - ctx.joints.head[1];
}

/** Bevel of the head block; high for a rounded skull. */
const HEAD_CHAMFER = 0.42;
/** The jaw is this much narrower than the crown. */
const HEAD_TAPER = 0.86;
/** Bevel of arms and legs: near-octagonal, so limbs read round. */
const LIMB_CHAMFER = 0.55;
/** The skin under a garment's edges, a shadowed crease. */
const CREASE_SHADE = 0.55;

/**
 * Scale of the head's taper at a height, 0…1 from chin to crown.
 */
function headScaleAt(ctx: PartContext, y: number): number {
  const upShare = (y - ctx.joints.head[1]) / headHeight(ctx);
  return HEAD_TAPER + (1 - HEAD_TAPER) * Math.min(1, Math.max(0, upShare));
}

/**
 * The x of the front of the face at a height, so features sit on the surface.
 *
 * @param ctx - The character.
 * @param y - Height above the ground, metres.
 * @returns The x of the face's flat front.
 */
export function headFrontX(ctx: PartContext, y: number): number {
  return (ctx.p.headDepth / 2) * headScaleAt(ctx, y);
}

/**
 * The |z| of the side of the head at a height.
 *
 * @param ctx - The character.
 * @param y - Height above the ground, metres.
 * @returns Half the head's width there.
 */
export function headSideZ(ctx: PartContext, y: number): number {
  return (ctx.p.headWidth / 2) * headScaleAt(ctx, y);
}

/**
 * A block part bound to a bone.
 *
 * @param bone - The bone it follows.
 * @param spec - The block, in the character's bind-pose space.
 * @returns The part.
 */
export function part(bone: BoneName, spec: BlockSpec): RigPart {
  return { bone, geometry: block(spec) };
}

/** Heights (metres) and the chest's taper that shape the torso; extras layer onto them. */
export type TorsoLevels = {
  pelvisY: number;
  chestY: number;
  shoulderY: number;
  chestBottom: number;
  chestTop: number;
  /** Width of the chest block's bottom relative to its top. */
  chestTaper: number;
  bellyBottom: number;
  bellyTop: number;
};

/**
 * Where the torso's blocks start and end.
 *
 * @param ctx - The character.
 * @returns The torso's levels.
 */
export function torsoLevels(ctx: PartContext): TorsoLevels {
  const { joints, p } = ctx;
  const pelvisY = joints.pelvis[1];
  const chestY = joints.chest[1];
  const shoulderY = joints.upperArmR[1];
  return {
    pelvisY,
    chestY,
    shoulderY,
    chestBottom: chestY - 0.07,
    chestTop: shoulderY + 0.06,
    chestTaper: (p.waistWidth / p.chestWidth) * 1.04,
    bellyBottom: pelvisY + 0.03,
    bellyTop: chestY + 0.02,
  };
}

/**
 * Half the chest's depth at a height, so extras sit on its tapered front.
 *
 * @param ctx - The character.
 * @param y - Height above the ground, metres.
 * @returns The x of the chest's front there.
 */
export function chestFrontX(ctx: PartContext, y: number): number {
  const levels = torsoLevels(ctx);
  const upShare =
    (y - levels.chestBottom) / (levels.chestTop - levels.chestBottom);
  const clamped = Math.min(1, Math.max(0, upShare));
  return (
    (ctx.p.chestDepth / 2) *
    (levels.chestTaper + (1 - levels.chestTaper) * clamped)
  );
}

/** Hips, belly, chest, neck and, for coats, the skirt of the top. */
function torsoParts(ctx: PartContext): RigPart[] {
  const { look, p, joints } = ctx;
  const levels = torsoLevels(ctx);
  const neckBottom = joints.neck[1] - 0.04;
  const neckTop = joints.head[1] + 0.04;
  const parts: RigPart[] = [
    part("pelvis", {
      size: [p.waistDepth, 0.21, p.waistWidth],
      at: [0, levels.pelvisY - 0.045, 0],
      colour: look.bottom.colour,
      chamfer: 0.45,
      taper: p.hipWidth / p.waistWidth,
    }),
    part("spine", {
      size: [p.waistDepth, levels.bellyTop - levels.bellyBottom, p.waistWidth],
      at: [0, (levels.bellyTop + levels.bellyBottom) / 2, 0],
      colour: look.top.colour,
      chamfer: 0.45,
    }),
    part("chest", {
      size: [p.chestDepth, levels.chestTop - levels.chestBottom, p.chestWidth],
      at: [0, (levels.chestTop + levels.chestBottom) / 2, 0],
      colour: look.top.colour,
      chamfer: 0.45,
      taper: levels.chestTaper,
    }),
    part("neck", {
      size: [p.neck * 1.05, neckTop - neckBottom, p.neck],
      at: [0, (neckTop + neckBottom) / 2, 0],
      colour: look.skin,
      chamfer: 0.3,
    }),
    yokePart(ctx),
  ];
  const hem = look.top.hem ?? 0;
  if (hem > 0) parts.push(hemPart(ctx, hem));
  return parts;
}

/** Height of the slope from the shoulders up to the neck, metres. */
const YOKE_HEIGHT_M = 0.08;

/** The slope from the shoulders up to the neck (the trapezius), in the top's colour. */
function yokePart(ctx: PartContext): RigPart {
  const { p } = ctx;
  const levels = torsoLevels(ctx);
  const topWidth = p.neck + 0.1;
  const taper = (p.chestWidth * 0.95) / topWidth;
  return part("chest", {
    size: [(p.chestDepth * 0.9) / taper, YOKE_HEIGHT_M, topWidth],
    at: [-0.01, levels.chestTop + YOKE_HEIGHT_M / 2 - 0.03, 0],
    colour: ctx.look.top.colour,
    chamfer: 0.5,
    taper,
  });
}

/** The part of a top that hangs over the hips: a jacket's hem or a coat's skirt. */
function hemPart(ctx: PartContext, hem: number): RigPart {
  const { p, joints } = ctx;
  const top = joints.pelvis[1] + 0.07;
  const bottom = joints.pelvis[1] - 0.15 - hem;
  return part("pelvis", {
    size: [p.waistDepth + 0.035, top - bottom, p.hipWidth + 0.035],
    at: [0, (top + bottom) / 2, 0],
    colour: ctx.look.top.colour,
    chamfer: 0.3,
    taper: 1 + hem * 0.4,
  });
}

/** Deltoid, upper arm (with a short sleeve), forearm, hand and thumb of one side. */
function armParts(ctx: PartContext, side: Side): RigPart[] {
  const { look, p, joints } = ctx;
  const [, shoulderY, z] = joints[`upperArm${side}`];
  const elbowY = joints[`lowerArm${side}`][1];
  const wristY = joints[`hand${side}`][1];
  const upperLength = shoulderY - elbowY;
  const lowerLength = elbowY - wristY;
  const sleeved = look.top.reach !== "none";
  const longSleeved = look.top.reach === "full";
  const upper: BoneName = `upperArm${side}`;
  const parts: RigPart[] = [
    part(upper, {
      size: [p.arm * 1.15, 0.13, p.arm * DELTOID_SCALE],
      at: [0, shoulderY - 0.015, z],
      colour: sleeved ? look.top.colour : look.skin,
      chamfer: 0.55,
    }),
    part(upper, {
      size: [p.arm, upperLength + 0.02, p.arm],
      at: [0, shoulderY - upperLength / 2, z],
      colour: longSleeved ? look.top.colour : look.skin,
      chamfer: LIMB_CHAMFER,
      taper: 0.85,
    }),
    part(`lowerArm${side}`, {
      size: [p.forearm, lowerLength + 0.03, p.forearm],
      at: [0, elbowY - lowerLength / 2 + 0.005, z],
      colour: longSleeved ? look.top.colour : look.skin,
      chamfer: LIMB_CHAMFER,
      taper: 0.8,
    }),
    ...handParts(ctx, side, wristY, z),
  ];
  if (look.top.reach === "short") {
    parts.push(
      part(upper, {
        size: [p.arm * 1.12, upperLength * 0.5, p.arm * 1.12],
        at: [0, shoulderY - upperLength * 0.25, z],
        colour: look.top.colour,
        chamfer: 0.3,
      }),
    );
  }
  return parts;
}

/** A fist and its thumb. */
function handParts(
  ctx: PartContext,
  side: Side,
  wristY: number,
  z: number,
): RigPart[] {
  const { p, look } = ctx;
  const bone: BoneName = `hand${side}`;
  return [
    part(bone, {
      size: [p.hand * 0.9, 0.1, p.hand * 0.72],
      at: [0.004, wristY - 0.052, z],
      colour: look.skin,
      chamfer: 0.45,
    }),
    part(bone, {
      size: [0.032, 0.05, 0.03],
      at: [
        p.hand * 0.45 + 0.006,
        wristY - 0.035,
        z - sideSign(side) * p.hand * 0.15,
      ],
      colour: shade(look.skin, 0.96),
      chamfer: 0.3,
    }),
  ];
}

/** Thigh (with shorts), shin and foot of one side. */
function legParts(ctx: PartContext, side: Side): RigPart[] {
  const { look, p, joints } = ctx;
  const [, hipY, z] = joints[`upperLeg${side}`];
  const kneeY = joints[`lowerLeg${side}`][1];
  const ankleY = joints[`foot${side}`][1];
  const full = look.bottom.reach === "full";
  const legColour = full ? look.bottom.colour : look.skin;
  const parts: RigPart[] = [
    spanPart(`upperLeg${side}`, [hipY + 0.04, kneeY - 0.02], {
      size: [p.thigh * 1.05, 0, p.thigh],
      z,
      colour: legColour,
      taper: 0.78,
    }),
    spanPart(`lowerLeg${side}`, [kneeY + 0.01, ankleY - 0.015], {
      size: [p.calf * 1.05, 0, p.calf],
      z,
      colour: legColour,
      taper: 0.72,
    }),
    part(`foot${side}`, {
      size: [0.25, ankleY, p.calf * 0.85 + 0.01],
      at: [0.06, ankleY / 2, z],
      colour: look.shoes,
      chamfer: 0.35,
    }),
  ];
  if (look.bottom.reach === "short") {
    parts.push(
      spanPart(`upperLeg${side}`, [hipY + 0.035, kneeY + 0.1], {
        size: [p.thigh * 1.16, 0, p.thigh * 1.1],
        z,
        colour: look.bottom.colour,
        taper: 1.05,
      }),
    );
  }
  return parts;
}

/** A limb block between two heights, `[top, bottom]`, centred on the limb's axis. */
function spanPart(
  bone: BoneName,
  [top, bottom]: [number, number],
  spec: { size: Vec3; z: number; colour: number; taper: number },
): RigPart {
  return part(bone, {
    size: [spec.size[0], top - bottom, spec.size[2]],
    at: [0, (top + bottom) / 2, spec.z],
    colour: spec.colour,
    chamfer: LIMB_CHAMFER,
    taper: spec.taper,
  });
}

/** Face height of the eyes above the chin, metres. */
export const EYE_RISE_M = 0.135;
/** Eyes sit this far either side of the midline, metres. */
export const EYE_SPACING_M = 0.045;
/** Dark eyes. */
const EYE_COLOUR = 0x1b1512;

/** A block on the face: its front stands `proud` metres out of the face at height `y`. */
export type FaceFeature = {
  size: Vec3;
  y: number;
  z: number;
  colour: number;
  proud: number;
  taper?: number;
};

/**
 * A feature block on the face, bound to the head.
 *
 * @param ctx - The character.
 * @param spec - Size, height, side offset, colour and how far it stands out.
 * @returns The part.
 */
export function onFace(ctx: PartContext, spec: FaceFeature): RigPart {
  return part("head", {
    size: spec.size,
    at: [
      headFrontX(ctx, spec.y) + spec.proud - spec.size[0] / 2,
      spec.y,
      spec.z,
    ],
    colour: spec.colour,
    taper: spec.taper,
  });
}

/** The colour of the eyebrows: the hair's, or a dark shade of the skin for the bald. */
function browColour(look: LookSpec): number {
  return look.hair.style === "bald" ? shade(look.skin, 0.45) : look.hair.colour;
}

/** Skull, nose and mouth, then each side's eye, brow and ear. */
function headParts(ctx: PartContext): RigPart[] {
  const { look, p } = ctx;
  const chin = ctx.joints.head[1];
  return [
    part("head", {
      size: [p.headDepth, headHeight(ctx), p.headWidth],
      at: [0, chin + headHeight(ctx) / 2, 0],
      colour: look.skin,
      chamfer: HEAD_CHAMFER,
      taper: HEAD_TAPER,
    }),
    onFace(ctx, {
      size: [0.04, 0.055, 0.034],
      y: chin + 0.092,
      z: 0,
      colour: shade(look.skin, 0.93),
      proud: 0.028,
      taper: 1.35,
    }),
    onFace(ctx, {
      size: [0.01, 0.012, 0.058],
      y: chin + 0.05,
      z: 0,
      colour: shade(look.skin, CREASE_SHADE),
      proud: 0.004,
    }),
    ...faceSideParts(ctx, "L"),
    ...faceSideParts(ctx, "R"),
  ];
}

/** One side's eye, eyebrow and ear. */
function faceSideParts(ctx: PartContext, side: Side): RigPart[] {
  const { look } = ctx;
  const chin = ctx.joints.head[1];
  const sign = sideSign(side);
  const eyeY = chin + EYE_RISE_M;
  const earY = chin + 0.12;
  return [
    onFace(ctx, {
      size: [0.02, 0.034, 0.034],
      y: eyeY,
      z: sign * EYE_SPACING_M,
      colour: EYE_COLOUR,
      proud: 0.008,
    }),
    onFace(ctx, {
      size: [0.016, 0.014, 0.05],
      y: eyeY + 0.034,
      z: sign * (EYE_SPACING_M + 0.002),
      colour: browColour(look),
      proud: 0.01,
    }),
    part("head", {
      size: [0.05, 0.065, 0.025],
      at: [-0.01, earY, sign * (headSideZ(ctx, earY) + 0.008)],
      colour: shade(look.skin, 0.94),
      chamfer: 0.4,
    }),
  ];
}

/** Short hair: a cap over the crown, the back of the head, a fringe and sideburns. */
function shortHairParts(ctx: PartContext, colour: number): RigPart[] {
  const { p } = ctx;
  const crown = p.height;
  const fringeY = crown - 0.045;
  const parts: RigPart[] = [
    part("head", {
      size: [p.headDepth + 0.018, 0.08, p.headWidth + 0.018],
      at: [-0.004, crown - 0.03, 0],
      colour,
      chamfer: 0.55,
    }),
    part("head", {
      size: [0.06, 0.16, p.headWidth * 0.92 + 0.012],
      at: [-p.headDepth / 2 + 0.02, crown - 0.1, 0],
      colour,
      chamfer: 0.5,
      taper: 0.9,
    }),
    part("head", {
      size: [0.03, 0.035, p.headWidth * 0.8],
      at: [headFrontX(ctx, fringeY) - 0.004, fringeY, 0],
      colour,
      chamfer: 0.4,
    }),
  ];
  for (const side of ["L", "R"] as const) {
    const y = crown - 0.1;
    parts.push(
      part("head", {
        size: [0.035, 0.07, 0.015],
        at: [0.012, y, sideSign(side) * (headSideZ(ctx, y) + 0.004)],
        colour,
      }),
    );
  }
  return parts;
}

/** The ponytail's block, before it is tilted: `[x, y, z]` extent, metres. */
const PONYTAIL_SIZE: Vec3 = [0.075, 0.28, 0.075];
/** Tilt of the ponytail about the side axis (its tip swings back), radians. */
export const PONYTAIL_TILT = -0.4;

/**
 * A point on the ponytail's axis, `along` metres from its centre toward its root.
 *
 * @param ctx - The character.
 * @param along - Distance from the tail's centre toward its root, metres.
 * @returns The point, in the character's space.
 */
export function ponytailPoint(ctx: PartContext, along: number): Vec3 {
  const centreX = -ctx.p.headDepth / 2 - 0.05;
  const centreY = ctx.p.height - 0.17;
  return [
    centreX - Math.sin(PONYTAIL_TILT) * along,
    centreY + Math.cos(PONYTAIL_TILT) * along,
    0,
  ];
}

/** A ponytail hanging from the back of the crown. */
function ponytailPart(ctx: PartContext, colour: number): RigPart {
  return part("head", {
    size: PONYTAIL_SIZE,
    at: ponytailPoint(ctx, 0),
    colour,
    chamfer: 0.5,
    taper: 0.55,
    rotation: [0, 0, PONYTAIL_TILT],
  });
}

/** The hair of the look. */
function hairParts(ctx: PartContext): RigPart[] {
  const hair = ctx.look.hair;
  if (hair.style === "bald") return [];
  const parts = shortHairParts(ctx, hair.colour);
  if (hair.style === "ponytail") parts.push(ponytailPart(ctx, hair.colour));
  return parts;
}

/**
 * Every body part of a character: torso, arms, legs, head, face and hair.
 *
 * @param ctx - The character's look, measurements and joints.
 * @returns Parts in bind pose, each bound to one bone.
 */
export function bodyParts(ctx: PartContext): RigPart[] {
  return [
    ...torsoParts(ctx),
    ...armParts(ctx, "L"),
    ...armParts(ctx, "R"),
    ...legParts(ctx, "L"),
    ...legParts(ctx, "R"),
    ...headParts(ctx),
    ...hairParts(ctx),
  ];
}
