/**
 * Accessories layered over a character's body — shades, caps, hoods, a backpack, hi-vis bands and
 * the like — each a set of rigid parts bound to the bone they ride on.
 */
import type { Extra } from "./characterLooks";
import {
  chestFrontX,
  EYE_RISE_M,
  EYE_SPACING_M,
  headFrontX,
  headSideZ,
  onFace,
  part,
  ponytailPoint,
  PONYTAIL_TILT,
  sideSign,
  torsoLevels,
  type PartContext,
  type RigPart,
  type Side,
} from "./characterParts";
import { shade } from "./lowPoly";

/** Both sides, left first. */
const SIDES: readonly Side[] = ["L", "R"];

/** One extra of a given kind. */
type ExtraOf<K extends Extra["kind"]> = Extract<Extra, { kind: K }>;

/** Builds the parts of one kind of extra. */
type ExtraBuilder<K extends Extra["kind"]> = (
  ctx: PartContext,
  extra: ExtraOf<K>,
) => RigPart[];

/** Chin height of the character. */
function chinY(ctx: PartContext): number {
  return ctx.joints.head[1];
}

/** Dark frame across the eyes, glowing red lenses and temples back to the ears. */
const sunglasses: ExtraBuilder<"sunglasses"> = (ctx, { frame, lens }) => {
  const eyeY = chinY(ctx) + EYE_RISE_M;
  const width = headSideZ(ctx, eyeY) * 2 - 0.012;
  const parts: RigPart[] = [
    onFace(ctx, {
      size: [0.016, 0.05, width],
      y: eyeY + 0.003,
      z: 0,
      colour: frame,
      proud: 0.014,
    }),
  ];
  for (const side of SIDES) {
    const lensPart = onFace(ctx, {
      size: [0.008, 0.038, 0.066],
      y: eyeY,
      z: sideSign(side) * (EYE_SPACING_M + 0.004),
      colour: lens,
      proud: 0.018,
    });
    parts.push({ ...lensPart, glow: true });
    parts.push(
      part("head", {
        size: [ctx.p.headDepth * 0.55, 0.012, 0.012],
        at: [
          headFrontX(ctx, eyeY) - ctx.p.headDepth * 0.27,
          eyeY + 0.012,
          sideSign(side) * (headSideZ(ctx, eyeY) + 0.006),
        ],
        colour: frame,
      }),
    );
  }
  return parts;
};

/** A short grey beard around the mouth. */
const goatee: ExtraBuilder<"goatee"> = (ctx, { colour }) => {
  const chin = chinY(ctx);
  const parts: RigPart[] = [
    onFace(ctx, {
      size: [0.03, 0.055, 0.066],
      y: chin + 0.024,
      z: 0,
      colour,
      proud: 0.02,
      taper: 0.8,
    }),
    onFace(ctx, {
      size: [0.02, 0.016, 0.078],
      y: chin + 0.066,
      z: 0,
      colour,
      proud: 0.022,
    }),
  ];
  for (const side of SIDES) {
    parts.push(
      onFace(ctx, {
        size: [0.018, 0.045, 0.012],
        y: chin + 0.045,
        z: sideSign(side) * 0.036,
        colour,
        proud: 0.014,
      }),
    );
  }
  return parts;
};

/** Pecs, traps and biceps for the player's bodybuilder frame. */
const muscles: ExtraBuilder<"muscles"> = (ctx, { colour }) => {
  const { p } = ctx;
  const levels = torsoLevels(ctx);
  const pecY = levels.shoulderY - 0.09;
  const parts: RigPart[] = absParts(ctx, colour);
  for (const side of SIDES) {
    const [, shoulderY, z] = ctx.joints[`upperArm${side}`];
    parts.push(
      part("chest", {
        size: [0.05, 0.12, p.chestWidth * 0.44],
        at: [
          chestFrontX(ctx, pecY) - 0.016,
          pecY,
          sideSign(side) * p.chestWidth * 0.23,
        ],
        colour,
        chamfer: 0.6,
        taper: 0.8,
      }),
      part(`upperArm${side}`, {
        size: [p.arm * 0.5, 0.16, p.arm * 0.8],
        at: [p.arm * 0.4, shoulderY - 0.13, z],
        colour: ctx.look.skin,
        chamfer: 0.5,
      }),
    );
  }
  return parts;
};

/** Two columns of three ab blocks on the belly. */
function absParts(ctx: PartContext, colour: number): RigPart[] {
  const levels = torsoLevels(ctx);
  const rows = 3;
  const rowHeight = (levels.bellyTop - levels.bellyBottom) / (rows + 0.6);
  return Array.from({ length: rows * 2 }, (_, index) => {
    const row = Math.floor(index / 2);
    const z = (index % 2 === 0 ? -1 : 1) * 0.038;
    return part("spine", {
      size: [0.03, rowHeight * 0.82, 0.066],
      at: [
        ctx.p.waistDepth / 2 - 0.006,
        levels.bellyBottom + rowHeight * (row + 0.9),
        z,
      ],
      colour,
      chamfer: 0.5,
    });
  });
}

/** An inked band and patch around the left upper arm. */
const tattoo: ExtraBuilder<"tattoo"> = (ctx, { colour }) => {
  const [, shoulderY, z] = ctx.joints.upperArmL;
  const arm = ctx.p.arm;
  return [
    part("upperArmL", {
      size: [arm * 0.97 + 0.006, 0.022, arm * 0.97 + 0.006],
      at: [0, shoulderY - 0.1, z],
      colour,
    }),
    part("upperArmL", {
      size: [arm * 0.5, 0.07, 0.01],
      at: [0, shoulderY - 0.16, z - arm * 0.46],
      colour,
    }),
  ];
};

/** Beads around the right wrist. */
const bracelet: ExtraBuilder<"bracelet"> = (ctx, { colours }) => {
  const [, wristY, z] = ctx.joints.handR;
  const radius = ctx.p.forearm * 0.4 + 0.012;
  const beads = 8;
  return Array.from({ length: beads }, (_, index) => {
    const angle = (index / beads) * Math.PI * 2;
    return part("lowerArmR", {
      size: [0.024, 0.024, 0.024],
      at: [
        Math.cos(angle) * radius,
        wristY + 0.028,
        z + Math.sin(angle) * radius,
      ],
      colour: colours[index % colours.length],
      rotation: [0, angle, 0],
    });
  });
};

/** A padded bodywarmer over the bare torso, in the player's own colour. */
const vest: ExtraBuilder<"vest"> = (ctx, { trim }) => {
  const { p } = ctx;
  const levels = torsoLevels(ctx);
  const colour = ctx.vest ?? trim;
  const bellyHeight = levels.bellyTop - levels.bellyBottom;
  return [
    part("chest", {
      size: [
        p.chestDepth + 0.075,
        levels.chestTop - levels.chestBottom - 0.02,
        p.chestWidth + 0.03,
      ],
      at: [0, (levels.chestTop + levels.chestBottom) / 2 - 0.01, 0],
      colour,
      chamfer: 0.3,
      taper: levels.chestTaper,
    }),
    part("spine", {
      size: [p.waistDepth + 0.06, bellyHeight + 0.02, p.waistWidth + 0.03],
      at: [0, levels.bellyBottom + bellyHeight / 2, 0],
      colour,
      chamfer: 0.3,
    }),
    part("spine", {
      size: [p.waistDepth + 0.066, 0.03, p.waistWidth + 0.036],
      at: [0, levels.bellyBottom + 0.005, 0],
      colour: trim,
    }),
    part("chest", {
      size: [0.012, levels.chestTop - levels.chestBottom - 0.04, 0.014],
      at: [
        p.chestDepth / 2 + 0.036,
        (levels.chestTop + levels.chestBottom) / 2 - 0.02,
        0,
      ],
      colour: trim,
    }),
  ];
};

/** A backpack on the chest bone's back with straps over the shoulders. */
const backpack: ExtraBuilder<"backpack"> = (ctx, { colour, strap }) => {
  const { p } = ctx;
  const levels = torsoLevels(ctx);
  const packY = (levels.chestY + levels.shoulderY) / 2 - 0.02;
  const backX = -p.chestDepth / 2;
  const parts: RigPart[] = [
    part("chest", {
      size: [0.15, 0.36, p.chestWidth * 0.85],
      at: [backX - 0.065, packY, 0],
      colour,
      chamfer: 0.4,
    }),
    part("chest", {
      size: [0.05, 0.13, p.chestWidth * 0.6],
      at: [backX - 0.155, packY - 0.08, 0],
      colour: shade(colour, 0.82),
      chamfer: 0.4,
    }),
  ];
  for (const side of SIDES) {
    const z = sideSign(side) * p.chestWidth * 0.26;
    parts.push(
      part("chest", {
        size: [0.012, 0.3, 0.04],
        at: [chestFrontX(ctx, levels.chestY) + 0.004, levels.chestY + 0.02, z],
        colour: strap,
      }),
      part("chest", {
        size: [p.chestDepth + 0.02, 0.014, 0.04],
        at: [0, levels.chestTop + 0.004, z],
        colour: strap,
      }),
    );
  }
  return parts;
};

/** A jacket's zip down the front and its turned-up collar. */
const zip: ExtraBuilder<"zip"> = (ctx, { colour }) => {
  const { p, look } = ctx;
  const levels = torsoLevels(ctx);
  const chestMid = (levels.chestTop + levels.chestBottom) / 2;
  return [
    part("chest", {
      size: [0.02, levels.chestTop - levels.chestBottom - 0.02, 0.012],
      at: [chestFrontX(ctx, chestMid), chestMid, 0],
      colour,
    }),
    part("spine", {
      size: [0.012, levels.bellyTop - levels.bellyBottom, 0.012],
      at: [
        p.waistDepth / 2 + 0.002,
        (levels.bellyTop + levels.bellyBottom) / 2,
        0,
      ],
      colour,
    }),
    part("chest", {
      size: [p.chestDepth * 0.72, 0.055, p.neck + 0.07],
      at: [-0.008, levels.chestTop + 0.016, 0],
      colour: shade(look.top.colour, 0.9),
      chamfer: 0.4,
    }),
  ];
};

/** A flat cap with a short brim, pulled low. */
const flatCap: ExtraBuilder<"flatCap"> = (ctx, { colour }) => {
  const { p } = ctx;
  const crown = p.height;
  return [
    part("head", {
      size: [p.headDepth + 0.045, 0.055, p.headWidth + 0.035],
      at: [0.014, crown - 0.004, 0],
      colour,
      chamfer: 0.5,
      taper: 1.06,
    }),
    part("head", {
      size: [0.075, 0.016, p.headWidth * 0.86],
      at: [p.headDepth / 2 + 0.04, crown - 0.028, 0],
      colour: shade(colour, 0.85),
      chamfer: 0.3,
      rotation: [0, 0, -0.18],
    }),
  ];
};

/** A hood up over the head, framing the face, with its slack over the upper back. */
const hood: ExtraBuilder<"hood"> = (ctx, { colour }) => {
  const { p } = ctx;
  const chin = chinY(ctx);
  const crown = p.height;
  const levels = torsoLevels(ctx);
  const parts: RigPart[] = [
    part("head", {
      size: [p.headDepth + 0.05, 0.07, p.headWidth + 0.06],
      at: [-0.012, crown - 0.01, 0],
      colour,
      chamfer: 0.55,
    }),
    part("head", {
      size: [0.07, crown - chin + 0.05, p.headWidth + 0.05],
      at: [-p.headDepth / 2 - 0.004, (crown + chin) / 2 - 0.02, 0],
      colour,
      chamfer: 0.5,
    }),
    part("chest", {
      size: [0.08, 0.14, p.chestWidth * 0.55],
      at: [-p.chestDepth / 2 + 0.02, levels.chestTop + 0.01, 0],
      colour: shade(colour, 0.9),
      chamfer: 0.5,
    }),
  ];
  for (const side of SIDES) {
    parts.push(
      part("head", {
        size: [p.headDepth * 0.78, (crown - chin) * 0.85, 0.035],
        at: [-0.02, chin + 0.11, sideSign(side) * (p.headWidth / 2 + 0.02)],
        colour,
        chamfer: 0.4,
      }),
    );
  }
  return parts;
};

/** A hoodie's front pocket and drawstrings. */
const pouch: ExtraBuilder<"pouch"> = (ctx, { colour, cord }) => {
  const { p } = ctx;
  const levels = torsoLevels(ctx);
  const bellyHeight = levels.bellyTop - levels.bellyBottom;
  const cordY = levels.chestTop - 0.08;
  const parts: RigPart[] = [
    part("spine", {
      size: [0.03, bellyHeight * 0.7, p.waistWidth * 0.62],
      at: [
        p.waistDepth / 2 + 0.006,
        levels.bellyBottom + bellyHeight * 0.38,
        0,
      ],
      colour,
      chamfer: 0.3,
    }),
  ];
  for (const side of SIDES) {
    parts.push(
      part("chest", {
        size: [0.008, 0.12, 0.008],
        at: [chestFrontX(ctx, cordY) + 0.004, cordY, sideSign(side) * 0.03],
        colour: cord,
      }),
    );
  }
  return parts;
};

/** A row of buttons down the front of a coat or jacket. */
const buttons: ExtraBuilder<"buttons"> = (ctx, { colour }) => {
  const levels = torsoLevels(ctx);
  const heights = [levels.chestY + 0.07, levels.chestY - 0.03];
  const size: [number, number, number] = [0.012, 0.02, 0.02];
  return [
    ...heights.map((y) =>
      part("chest", { size, at: [chestFrontX(ctx, y) + 0.004, y, 0], colour }),
    ),
    part("spine", {
      size,
      at: [
        ctx.p.waistDepth / 2 + 0.004,
        (levels.bellyTop + levels.bellyBottom) / 2,
        0,
      ],
      colour,
    }),
  ];
};

/** A white shirt front and collar, a tie and the jacket's lapels. */
const collar: ExtraBuilder<"collar"> = (ctx, { shirt, tie }) => {
  const { p, look } = ctx;
  const levels = torsoLevels(ctx);
  const vY = levels.chestTop - 0.07;
  const front = chestFrontX(ctx, vY);
  const parts: RigPart[] = [
    part("chest", {
      size: [0.02, 0.13, 0.1],
      at: [front - 0.006, vY, 0],
      colour: shirt,
      taper: 0.3,
    }),
    part("chest", {
      size: [p.neck + 0.02, 0.035, p.neck + 0.03],
      at: [0, levels.chestTop + 0.01, 0],
      colour: shirt,
    }),
    part("chest", {
      size: [0.012, 0.16, 0.032],
      at: [front + 0.006, vY - 0.03, 0],
      colour: tie,
      taper: 1.4,
    }),
    part("chest", {
      size: [0.02, 0.026, 0.03],
      at: [front + 0.004, levels.chestTop - 0.012, 0],
      colour: tie,
    }),
  ];
  for (const side of SIDES) {
    parts.push(
      part("chest", {
        size: [0.012, 0.14, 0.035],
        at: [front + 0.002, vY + 0.005, sideSign(side) * 0.055],
        colour: shade(look.top.colour, 0.75),
        rotation: [sideSign(side) * -0.35, 0, 0],
      }),
    );
  }
  return parts;
};

/** A peaked police cap with a black band and a gold badge. */
const policeCap: ExtraBuilder<"policeCap"> = (ctx, { colour, peak, badge }) => {
  const { p } = ctx;
  const crown = p.height;
  return [
    part("head", {
      size: [p.headDepth + 0.055, 0.075, p.headWidth + 0.055],
      at: [0.006, crown + 0.014, 0],
      colour,
      chamfer: 0.3,
      taper: 0.86,
    }),
    part("head", {
      size: [p.headDepth + 0.03, 0.032, p.headWidth + 0.03],
      at: [0.004, crown - 0.028, 0],
      colour: peak,
      chamfer: 0.2,
    }),
    part("head", {
      size: [0.085, 0.014, p.headWidth * 0.9],
      at: [p.headDepth / 2 + 0.036, crown - 0.038, 0],
      colour: peak,
      chamfer: 0.2,
      rotation: [0, 0, -0.25],
    }),
    part("head", {
      size: [0.012, 0.032, 0.032],
      at: [p.headDepth / 2 + 0.018, crown + 0.006, 0],
      colour: badge,
    }),
  ];
};

/** Hi-vis bands around the chest, the waist and both upper arms. */
const bands: ExtraBuilder<"bands"> = (ctx, { colour }) => {
  const { p } = ctx;
  const levels = torsoLevels(ctx);
  const bandY = levels.chestY + 0.05;
  const chestScale = chestFrontX(ctx, bandY) / (p.chestDepth / 2);
  const parts: RigPart[] = [
    part("chest", {
      size: [
        p.chestDepth * chestScale + 0.014,
        0.05,
        p.chestWidth * chestScale + 0.014,
      ],
      at: [0, bandY, 0],
      colour,
    }),
    part("spine", {
      size: [p.waistDepth + 0.014, 0.04, p.waistWidth + 0.014],
      at: [0, levels.bellyBottom + 0.05, 0],
      colour,
    }),
  ];
  for (const side of SIDES) {
    const [, shoulderY, z] = ctx.joints[`upperArm${side}`];
    parts.push(
      part(`upperArm${side}`, {
        size: [p.arm + 0.012, 0.04, p.arm + 0.012],
        at: [0, shoulderY - 0.1, z],
        colour,
      }),
    );
  }
  return parts;
};

/** A belt (or a waistband) with a buckle. */
const belt: ExtraBuilder<"belt"> = (ctx, { colour }) => {
  const { p } = ctx;
  const y = ctx.joints.pelvis[1] + 0.045;
  return [
    part("pelvis", {
      size: [p.waistDepth + 0.05, 0.04, p.hipWidth + 0.05],
      at: [0, y, 0],
      colour,
    }),
    part("pelvis", {
      size: [0.012, 0.032, 0.045],
      at: [p.waistDepth / 2 + 0.027, y, 0],
      colour: shade(colour, 1.6),
    }),
  ];
};

/** A holstered sidearm on the right hip. */
const holster: ExtraBuilder<"holster"> = (ctx, { colour }) => {
  const { p } = ctx;
  const y = ctx.joints.pelvis[1] - 0.05;
  const z = p.hipWidth / 2 + 0.045;
  return [
    part("pelvis", {
      size: [0.1, 0.16, 0.05],
      at: [-0.01, y, z],
      colour,
      chamfer: 0.3,
    }),
    part("pelvis", {
      size: [0.05, 0.05, 0.03],
      at: [0.02, y + 0.095, z],
      colour: 0x2a2a2c,
      chamfer: 0.3,
    }),
  ];
};

/** Pale rubber soles and a side stripe on each sneaker. */
const sneakers: ExtraBuilder<"sneakers"> = (ctx, { sole }) =>
  SIDES.flatMap((side) => {
    const [, , z] = ctx.joints[`foot${side}`];
    const width = ctx.p.calf * 0.85 + 0.01;
    return [
      part(`foot${side}`, {
        size: [0.262, 0.026, width + 0.012],
        at: [0.06, 0.013, z],
        colour: sole,
      }),
      part(`foot${side}`, {
        size: [0.09, 0.018, 0.004],
        at: [0.05, 0.05, z + sideSign(side) * (width / 2 + 0.001)],
        colour: sole,
      }),
    ];
  });

/** A band around the root of the ponytail. */
const hairTie: ExtraBuilder<"hairTie"> = (ctx, { colour }) => [
  part("head", {
    size: [0.085, 0.03, 0.085],
    at: ponytailPoint(ctx, 0.1),
    colour,
    rotation: [0, 0, PONYTAIL_TILT],
  }),
];

/** The builder of every kind of extra. */
const BUILDERS: { [K in Extra["kind"]]: ExtraBuilder<K> } = {
  sunglasses,
  goatee,
  muscles,
  tattoo,
  bracelet,
  vest,
  backpack,
  zip,
  flatCap,
  hood,
  pouch,
  buttons,
  collar,
  policeCap,
  bands,
  belt,
  holster,
  sneakers,
  hairTie,
};

/** The parts of one extra. */
function buildExtra<K extends Extra["kind"]>(
  ctx: PartContext,
  extra: ExtraOf<K>,
): RigPart[] {
  const builder = BUILDERS[extra.kind] as ExtraBuilder<K>;
  return builder(ctx, extra);
}

/**
 * The parts of every extra the look wears.
 *
 * @param ctx - The character's look, measurements and joints.
 * @returns Parts in bind pose, each bound to one bone.
 */
export function extraParts(ctx: PartContext): RigPart[] {
  return ctx.look.extras.flatMap((extra) => buildExtra(ctx, extra));
}
