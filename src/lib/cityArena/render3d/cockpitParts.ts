/**
 * The geometry of the first-person cockpits (spec §4), built from a kind's {@link CockpitSpec} in
 * car space (+X forward, +Y up, +Z right, origin at the footprint centre on the ground). Pure
 * builders: `cockpit3d.ts` caches what they make per kind and turns the moving parts.
 *
 * Every part is a vertex-coloured low-poly block or rod (`lowPoly.ts`), so the static interior
 * merges into one geometry per kind; the body-coloured parts merge into one per kind and colour.
 */
import {
  BufferGeometry,
  Color,
  Euler,
  Float32BufferAttribute,
  Matrix4,
  Quaternion,
  TorusGeometry,
  Vector3,
} from "three";
import type { CockpitSpec, CockpitWheel } from "./cockpitSpecs";
import { block, mergeParts, rod, type Vec3 } from "./lowPoly";

/** Dark dashboard plastic. */
const DASH_PLASTIC = 0x26272b;
/** Pillars, header and the rear frame: dark interior trim. */
const TRIM = 0x3a3c41;
/** The pale roof lining. */
const HEADLINER = 0x8e8a82;
/** Door cards below the window line. */
const DOOR_TRIM = 0x2d2e32;
/** The speedometer's black face. */
const DIAL_FACE = 0x0c0d0f;
/** The rear-view mirror's glass. */
const MIRROR_GLASS = 0x93a8ba;
/** Steel of the tractor's cab frame and floor. */
const FRAME_STEEL = 0x2b2d30;
/** The tractor's exhaust stack. */
const EXHAUST_BLACK = 0x202225;
/** The tank's hatch coaming and lid. */
const HATCH_OLIVE = 0x3a4628;
/** The tank's vision blocks. */
const VISION_GLASS = 0x1d3036;
/** The steering wheel's rim. */
const RIM_BLACK = 0x18181a;
/** Spokes, hub and column. */
const HUB_GREY = 0x34363b;
/** The dial's lit scale. */
const TICK_WHITE = 0xf1efe4;
/** The speedometer needle. */
const NEEDLE_ORANGE = 0xff6a1f;

/** Pillars, bars and rails: square section, metres. */
const PILLAR_M = 0.07;
/** A beam's bevel as a share of its section. */
const BEAM_CHAMFER = 0.3;
/** The windscreen narrows by this much each side from its foot to the header (tumblehome). */
const PILLAR_LEAN_IN_M = 0.08;
/** The roof header across the top of the windscreen: depth along the car and height. */
const HEADER_DEPTH_M = 0.16;
const HEADER_HEIGHT_M = 0.07;
/** Thickness of the roof lining. */
const HEADLINER_M = 0.03;
/** The doors stand this far outside the windscreen's foot on each side. */
const DOOR_OUTSET_M = 0.06;
/** A door top's thickness across the car and height; the door card's drop below it. */
const DOOR_M = 0.1;
const DOOR_TOP_M = 0.09;
const DOOR_CARD_M = 0.32;
/** The B-pillar stands this far behind the eye. */
const B_PILLAR_BACK_M = 0.32;
/** The rear window's pillars are broader than the others. */
const C_PILLAR_M = 0.11;
/** Depth of the dashboard below its top surface. */
const DASH_DEPTH_M = 0.28;
/** The dashboard's top falls at most this much from its near edge to the windscreen. */
const DASH_SLOPE_M = 0.12;
/** The rear-view mirror: its glass size and the stem it hangs from. */
const MIRROR_SIZE: Vec3 = [0.03, 0.065, 0.24];
const MIRROR_DROP_M = 0.1;
const MIRROR_BACK_M = 0.1;
const MIRROR_STEM_M = 0.024;
/** The speedometer: radius, standoff from the dashboard's face, and drop below its top. */
const DIAL_RADIUS_M = 0.07;
const DIAL_STANDOFF_M = 0.04;
const DIAL_DROP_M = 0.075;
/** The dial housing behind the face: depth and how far past the dial it reaches. */
const DIAL_HOUSING_M = 0.06;
const DIAL_HOUSING_MARGIN_M = 0.025;
/** Lit marks on the scale, spread over {@link DIAL_SWEEP_RAD}. */
const DIAL_TICKS = 9;
/** The scale runs from lower left to lower right, radians. */
export const DIAL_SWEEP_RAD = (240 * Math.PI) / 180;
/** Faceting of round parts. */
const ROUND_SIDES = 14;
/** The wheel's rim section. */
const RIM_M = 0.03;
/** Rings (the rim, the hatch coaming): facets around and round the tube. */
const RING_SEGMENTS = 24;
const RING_TUBE_SIDES = 6;
/** Spoke section, hub radius and depth, column radius and length. */
const SPOKE_M = 0.024;
const HUB_RADIUS_M = 0.055;
const HUB_DEPTH_M = 0.05;
const COLUMN_RADIUS_M = 0.035;
const COLUMN_LENGTH_M = 0.3;
/** The bonnet's thickness under its top. */
const BONNET_THICKNESS_M = 0.1;
/** The glow strip of the police light bar runs down the windscreen's top this share of its height. */
const SIREN_STRIP_SHARE = 0.16;

/**
 * The driver's eye in car space.
 *
 * @param spec - The kind's cockpit.
 * @returns `[forward, height, right]`.
 */
export function eyeOf(spec: CockpitSpec): Vec3 {
  return [spec.eyeForwardM, spec.eyeHeightM, -spec.eyeLeftM];
}

/** Along +X, a part's own forward. */
const X_AXIS = new Vector3(1, 0, 0);

/**
 * A square bar between two points, bevelled.
 *
 * @param from - One end, car space.
 * @param to - The other end.
 * @param thickness - The bar's section, metres.
 * @param colour - sRGB hex colour.
 * @returns A new non-indexed geometry.
 */
function beam(
  from: Vec3,
  to: Vec3,
  thickness: number,
  colour: number,
): BufferGeometry {
  const direction = new Vector3(
    to[0] - from[0],
    to[1] - from[1],
    to[2] - from[2],
  );
  const length = direction.length();
  const turn = new Euler().setFromQuaternion(
    new Quaternion().setFromUnitVectors(X_AXIS, direction.normalize()),
  );
  return block({
    size: [length, thickness, thickness],
    at: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2],
    colour,
    chamfer: BEAM_CHAMFER,
    rotation: [turn.x, turn.y, turn.z],
  });
}

/** Turns a geometry built about the origin by `rotation` (XYZ Euler) and moves it to `at`. */
function placed(
  geometry: BufferGeometry,
  rotation: Vec3,
  at: Vec3,
): BufferGeometry {
  geometry.applyMatrix4(
    new Matrix4().makeRotationFromEuler(new Euler(...rotation)),
  );
  geometry.translate(at[0], at[1], at[2]);
  return geometry;
}

/** The windscreen's corners: foot and header along the car, heights, and half-widths. */
type Screen = {
  footX: number;
  headX: number;
  baseY: number;
  headY: number;
  footHalf: number;
  headHalf: number;
};

/**
 * Where a kind's windscreen stands, centred on the car's centre line.
 *
 * @param spec - The kind's cockpit.
 * @returns Its foot and header.
 */
function screenOf(spec: CockpitSpec): Screen {
  const footX = spec.eyeForwardM + spec.glass.aheadM;
  return {
    footX,
    headX: footX - spec.glass.rakeM,
    baseY: spec.glass.baseM,
    headY: spec.glass.headerM,
    footHalf: spec.glass.pillarHalfM,
    headHalf: spec.glass.pillarHalfM - PILLAR_LEAN_IN_M,
  };
}

/** Half the cab's width at the doors. */
function cabHalf(spec: CockpitSpec): number {
  return spec.glass.pillarHalfM + DOOR_OUTSET_M;
}

/**
 * A block whose top face runs from `near` to `far` (x, height pairs), hanging `depth` below it.
 * Dashboards and bonnets slope this way.
 */
function slopedSlab(
  near: readonly [number, number],
  far: readonly [number, number],
  depth: number,
  across: { width: number; z: number },
  colour: number,
): BufferGeometry {
  const slope = Math.atan2(far[1] - near[1], far[0] - near[0]);
  const length = Math.hypot(far[0] - near[0], far[1] - near[1]);
  const drop = depth / 2;
  return block({
    size: [length, depth, across.width],
    at: [
      (near[0] + far[0]) / 2 + Math.sin(slope) * drop,
      (near[1] + far[1]) / 2 - Math.cos(slope) * drop,
      across.z,
    ],
    colour,
    chamfer: BEAM_CHAMFER,
    rotation: [0, 0, slope],
    gradient: 0,
  });
}

/** Where the speedometer sits and how far it tips back to face the eye. */
export type DialPose = { at: Vec3; tiltRad: number };

/**
 * The speedometer's centre, standing just proud of the dashboard's near face under its top, and
 * its tilt: the face turned up toward the driver's eye.
 *
 * @param spec - The kind's cockpit.
 * @returns Its centre in car space and its tilt back from upright, radians.
 */
export function dialPose(spec: CockpitSpec): DialPose {
  const eye = eyeOf(spec);
  const at: Vec3 = [
    eye[0] + spec.dash.aheadM - DIAL_STANDOFF_M,
    spec.dash.heightM - DIAL_DROP_M,
    eye[2],
  ];
  return { at, tiltRad: Math.atan2(eye[1] - at[1], at[0] - eye[0]) };
}

/** The dashboard: its top sloping down to the windscreen's foot, `width` across at `z`. */
function dashParts(
  spec: CockpitSpec,
  across: { width: number; z: number },
): BufferGeometry[] {
  const eye = eyeOf(spec);
  const near: [number, number] = [eye[0] + spec.dash.aheadM, spec.dash.heightM];
  const farY = Math.max(spec.glass.baseM, spec.dash.heightM - DASH_SLOPE_M);
  const far: [number, number] = [screenOf(spec).footX, farY];
  return [
    slopedSlab(near, far, DASH_DEPTH_M, across, DASH_PLASTIC),
    ...dialParts(spec),
  ];
}

/** The speedometer's housing and black face, turned up toward the eye. */
function dialParts(spec: CockpitSpec): BufferGeometry[] {
  const dial = dialPose(spec);
  const housing = DIAL_RADIUS_M * 2 + DIAL_HOUSING_MARGIN_M * 2;
  return [
    placed(
      block({
        size: [DIAL_HOUSING_M, housing, housing],
        at: [DIAL_HOUSING_M / 2, 0, 0],
        colour: DASH_PLASTIC,
        chamfer: BEAM_CHAMFER,
      }),
      [0, 0, -dial.tiltRad],
      dial.at,
    ),
    placed(
      rod({
        radius: DIAL_RADIUS_M,
        length: DIAL_HOUSING_M / 4,
        at: [0, 0, 0],
        axis: "x",
        colour: DIAL_FACE,
        sides: ROUND_SIDES,
        gradient: 0,
      }),
      [0, 0, -dial.tiltRad],
      dial.at,
    ),
  ];
}

/** The A-pillars, the roof header across the windscreen's top and the rear-view mirror. */
function screenFrameParts(spec: CockpitSpec): BufferGeometry[] {
  const screen = screenOf(spec);
  const { footX, headX, baseY, headY, footHalf, headHalf } = screen;
  const parts = [-1, 1].map((side) =>
    beam(
      [footX, baseY, side * footHalf],
      [headX, headY, side * headHalf],
      PILLAR_M,
      TRIM,
    ),
  );
  parts.push(
    block({
      size: [HEADER_DEPTH_M, HEADER_HEIGHT_M, 2 * headHalf + PILLAR_M],
      at: [headX - HEADER_DEPTH_M / 2, headY + HEADER_HEIGHT_M / 2, 0],
      colour: TRIM,
      chamfer: BEAM_CHAMFER,
    }),
    block({
      size: MIRROR_SIZE,
      at: [headX - MIRROR_BACK_M, headY - MIRROR_DROP_M, 0],
      colour: MIRROR_GLASS,
      chamfer: BEAM_CHAMFER,
      gradient: 0,
    }),
    beam(
      [headX - MIRROR_BACK_M, headY - MIRROR_DROP_M, 0],
      [headX - MIRROR_BACK_M, headY, 0],
      MIRROR_STEM_M,
      TRIM,
    ),
  );
  return parts;
}

/** One side of the cab (−1 left, 1 right): roof rail, door top and card, B- and C-pillar. */
function cabSide(spec: CockpitSpec, side: number): BufferGeometry[] {
  const { footX, headX, baseY, headY, headHalf } = screenOf(spec);
  const half = cabHalf(spec);
  const backX = spec.eyeForwardM - spec.cabinBackM;
  const pillarX = spec.eyeForwardM - B_PILLAR_BACK_M;
  const doorLength = footX - backX;
  return [
    beam(
      [headX, headY, side * headHalf],
      [backX, headY, side * headHalf],
      PILLAR_M,
      TRIM,
    ),
    block({
      size: [doorLength, DOOR_TOP_M, DOOR_M],
      at: [backX + doorLength / 2, baseY - DOOR_TOP_M / 2, side * half],
      colour: TRIM,
      chamfer: BEAM_CHAMFER,
    }),
    block({
      size: [doorLength, DOOR_CARD_M, DOOR_M / 2],
      at: [
        backX + doorLength / 2,
        baseY - DOOR_TOP_M - DOOR_CARD_M / 2,
        side * half,
      ],
      colour: DOOR_TRIM,
    }),
    beam(
      [pillarX, baseY, side * half],
      [pillarX, headY, side * headHalf],
      PILLAR_M,
      TRIM,
    ),
    beam(
      [backX, baseY, side * half],
      [backX, headY, side * headHalf],
      C_PILLAR_M,
      TRIM,
    ),
  ];
}

/** Roof lining, both sides of the cab, and the rear window's sill and header. */
function cabinParts(spec: CockpitSpec): BufferGeometry[] {
  const { headX, baseY, headY, headHalf } = screenOf(spec);
  const half = cabHalf(spec);
  const backX = spec.eyeForwardM - spec.cabinBackM;
  const liningLength = headX - backX;
  return [
    block({
      size: [liningLength, HEADLINER_M, 2 * headHalf],
      at: [backX + liningLength / 2, headY + HEADLINER_M, 0],
      colour: HEADLINER,
      gradient: 0,
    }),
    ...cabSide(spec, -1),
    ...cabSide(spec, 1),
    beam([backX, baseY, -half], [backX, baseY, half], PILLAR_M, TRIM),
    beam([backX, headY, -headHalf], [backX, headY, headHalf], PILLAR_M, TRIM),
  ];
}

/** A closed car's cab: dashboard across the cab, windscreen frame and the cabin around it. */
function carShell(spec: CockpitSpec): BufferGeometry[] {
  return [
    ...dashParts(spec, { width: 2 * cabHalf(spec), z: 0 }),
    ...screenFrameParts(spec),
    ...cabinParts(spec),
  ];
}

/** The tractor's exhaust stack beside the bonnet, from its model. */
const TRACTOR_EXHAUST = {
  at: [1.1, 1.92, -0.3] as Vec3,
  length: 1,
  radius: 0.05,
};
/** The instrument console on the tractor's steering column: width and depth. */
const CONSOLE_WIDTH_M = 0.46;
const CONSOLE_DEPTH_M = 0.22;
/** The console's pedestal reaches this far down to the cab floor. */
const CONSOLE_PEDESTAL_M = 0.6;

/** The tractor's open frame: corner posts and a top frame without a roof, back to `backX`. */
function openFrameParts(spec: CockpitSpec, backX: number): BufferGeometry[] {
  const { footX, headX, baseY, headY, footHalf } = screenOf(spec);
  const parts = [
    beam(
      [headX, headY, -footHalf],
      [headX, headY, footHalf],
      PILLAR_M,
      FRAME_STEEL,
    ),
    beam(
      [backX, headY, -footHalf],
      [backX, headY, footHalf],
      PILLAR_M,
      FRAME_STEEL,
    ),
  ];
  for (const side of [-1, 1]) {
    const z = side * footHalf;
    parts.push(
      beam([footX, baseY, z], [headX, headY, z], PILLAR_M, FRAME_STEEL),
      beam([backX, baseY, z], [backX, headY, z], PILLAR_M, FRAME_STEEL),
      beam([headX, headY, z], [backX, headY, z], PILLAR_M, FRAME_STEEL),
    );
  }
  return parts;
}

/** The tractor's open cab: the open frame, floor, console on the column, exhaust. */
function openShell(spec: CockpitSpec): BufferGeometry[] {
  const { footX, baseY, footHalf } = screenOf(spec);
  const eye = eyeOf(spec);
  const backX = spec.eyeForwardM - spec.cabinBackM;
  const consoleX = eye[0] + spec.dash.aheadM + CONSOLE_DEPTH_M / 2;
  return [
    ...dialParts(spec),
    block({
      size: [CONSOLE_DEPTH_M, CONSOLE_PEDESTAL_M, CONSOLE_WIDTH_M],
      at: [consoleX, spec.dash.heightM - CONSOLE_PEDESTAL_M / 2, eye[2]],
      colour: DASH_PLASTIC,
      chamfer: BEAM_CHAMFER,
    }),
    block({
      size: [footX - backX, PILLAR_M, 2 * footHalf],
      at: [(footX + backX) / 2, baseY - PILLAR_M / 2, 0],
      colour: FRAME_STEEL,
      gradient: 0,
    }),
    rod({ ...TRACTOR_EXHAUST, axis: "y", colour: EXHAUST_BLACK }),
    ...openFrameParts(spec, backX),
  ];
}

/** Section of the coaming ring. */
const COAMING_M = 0.07;
/** A vision block's size: along the car, up, across; its bottom stands on the deck. */
const VISION_BLOCK_SIZE: Vec3 = [0.1, 0.12, 0.16];
/** The vision blocks stand this far ahead of the eye, on the deck in front of the hatch. */
const VISION_BLOCK_AHEAD_M = 0.78;
/** The glass slit on a vision block's face toward the driver. */
const VISION_SLIT_SIZE: Vec3 = [0.012, 0.035, 0.11];
/** The open hatch lid behind the driver: its size, and how far it leans back from upright. */
const HATCH_LID_SIZE: Vec3 = [0.05, 0.62, 0.62];
const HATCH_LID_LEAN_RAD = 0.35;

/**
 * A faceted ring about `axis` through `at`, for the steering wheel's rim and the hatch coaming.
 * Non-indexed with flat normals and one colour, so it merges with the block and rod parts.
 */
function ringPart(
  radius: number,
  tube: number,
  axis: "x" | "y",
  at: Vec3,
  colour: number,
): BufferGeometry {
  const torus = new TorusGeometry(radius, tube, RING_TUBE_SIDES, RING_SEGMENTS);
  const geometry = torus.toNonIndexed();
  torus.dispose();
  geometry.deleteAttribute("uv");
  geometry.deleteAttribute("normal");
  if (axis === "x") geometry.rotateY(Math.PI / 2);
  else geometry.rotateX(Math.PI / 2);
  geometry.translate(at[0], at[1], at[2]);
  const { r, g, b } = new Color(colour);
  const count = geometry.getAttribute("position").count;
  const colours = new Float32Array(count * 3);
  for (let index = 0; index < count; index++) colours.set([r, g, b], index * 3);
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** The two vision blocks on the deck ahead of the hatch, each with a glass slit toward the eye. */
function visionBlocks(spec: CockpitSpec): BufferGeometry[] {
  const eye = eyeOf(spec);
  const x = eye[0] + VISION_BLOCK_AHEAD_M;
  const y = spec.glass.baseM + VISION_BLOCK_SIZE[1] / 2;
  return [-1, 1].flatMap((side) => {
    const z = eye[2] + side * spec.glass.pillarHalfM;
    return [
      block({
        size: VISION_BLOCK_SIZE,
        at: [x, y, z],
        colour: HATCH_OLIVE,
        chamfer: BEAM_CHAMFER,
      }),
      block({
        size: VISION_SLIT_SIZE,
        at: [x - VISION_BLOCK_SIZE[0] / 2, y, z],
        colour: VISION_GLASS,
        gradient: 0,
      }),
    ];
  });
}

/** The tank's driver hatch: the coaming ring, two framed vision blocks and the open lid. */
function hatchShell(spec: CockpitSpec): BufferGeometry[] {
  const eye = eyeOf(spec);
  const radius = spec.dash.aheadM;
  const ringY = spec.dash.heightM - COAMING_M / 2;
  return [
    ...visionBlocks(spec),
    ringPart(radius, COAMING_M / 2, "y", [eye[0], ringY, eye[2]], HATCH_OLIVE),
    block({
      size: HATCH_LID_SIZE,
      at: [
        eye[0] - radius - HATCH_LID_SIZE[0],
        ringY + HATCH_LID_SIZE[1] / 2,
        eye[2],
      ],
      colour: HATCH_OLIVE,
      chamfer: BEAM_CHAMFER,
      rotation: [0, 0, HATCH_LID_LEAN_RAD],
    }),
  ];
}

/** Where the tank driver's hands hold the grips, ahead of the eye and either side of it. */
const GRIP_AHEAD_M = 0.45;
const GRIP_DROP_M = 0.24;
const GRIP_SIDE_M = 0.2;

/** A grip bar rises this far to the hand from the hatch's depths, leaning forward by this much. */
const GRIP_RISE_M = 0.34;
const GRIP_LEAN_M = 0.11;
/** A grip bar's section. */
const GRIP_BAR_M = 0.036;

/**
 * Where the tank driver's hands hold the two grips, car space.
 *
 * @param spec - The tank's cockpit.
 * @returns The left and right hand's grip points.
 */
export function gripPoints(spec: CockpitSpec): [Vec3, Vec3] {
  const eye = eyeOf(spec);
  const at = (side: number): Vec3 => [
    eye[0] + GRIP_AHEAD_M,
    eye[1] - GRIP_DROP_M,
    eye[2] + side * GRIP_SIDE_M,
  ];
  return [at(-1), at(1)];
}

/** The two grip bars rising to where the hands hold them. */
function gripBars(spec: CockpitSpec): BufferGeometry[] {
  return gripPoints(spec).map((grip) =>
    beam(
      [grip[0] - GRIP_LEAN_M, grip[1] - GRIP_RISE_M, grip[2]],
      grip,
      GRIP_BAR_M,
      HUB_GREY,
    ),
  );
}

/**
 * The static interior of a kind: dashboard, pillars and cabin for a car, the open frame for the
 * tractor, the hatch and grips for the tank. Vertex-coloured, for the lit character material.
 *
 * @param spec - The kind's cockpit.
 * @returns One merged geometry.
 */
export function shellGeometry(spec: CockpitSpec): BufferGeometry {
  if (spec.frame === "hatch")
    return mergeParts([...hatchShell(spec), ...gripBars(spec)]);
  if (spec.frame === "open") return mergeParts(openShell(spec));
  return mergeParts(carShell(spec));
}

/** Rows of the tractor's rear-wheel fenders, from its model: along, height, width, off-centre. */
const TRACTOR_FENDER = {
  x: [-1.92, -0.28],
  y: [1.58, 1.66],
  width: 0.5,
  z: 0.85,
} as const;
/** The tank's flat deck runs this far back from the glacis around the hatch. */
const TANK_DECK_BACK_M = 1.6;

/** The bonnet, or the tank's glacis: from the windscreen's foot toward the nose, falling by `dropM`. */
function bonnetPart(spec: CockpitSpec, colour: number): BufferGeometry {
  const { lengthM, widthM, heightM, dropM } = spec.bonnet;
  const footX = screenOf(spec).footX;
  return slopedSlab(
    [footX, heightM],
    [footX + lengthM, heightM - dropM],
    BONNET_THICKNESS_M,
    { width: widthM, z: 0 },
    colour,
  );
}

/** The kind's own extras in the body colour: the tractor's fenders, the tank's deck. */
function paintExtras(spec: CockpitSpec, colour: number): BufferGeometry[] {
  if (spec.frame === "open") {
    const { x, y, width, z } = TRACTOR_FENDER;
    return [-1, 1].map((side) =>
      block({
        size: [x[1] - x[0], y[1] - y[0], width],
        at: [(x[0] + x[1]) / 2, (y[0] + y[1]) / 2, side * z],
        colour,
        gradient: 0,
      }),
    );
  }
  if (spec.frame !== "hatch") return [];
  const footX = screenOf(spec).footX;
  const { heightM, widthM } = spec.bonnet;
  return [
    block({
      size: [TANK_DECK_BACK_M, BONNET_THICKNESS_M, widthM],
      at: [footX - TANK_DECK_BACK_M / 2, heightM - BONNET_THICKNESS_M / 2, 0],
      colour,
      gradient: 0,
    }),
  ];
}

/**
 * The parts in the car's own paint: the bonnet running to the nose (the tank's glacis and deck,
 * the tractor's fenders too), evenly coloured so it reads as the body everyone else sees.
 *
 * @param spec - The kind's cockpit.
 * @param colour - The body colour, `0xrrggbb` (see `bodyColour`).
 * @returns One merged geometry, or `null` for a flat-fronted bus with nothing to show.
 */
export function paintGeometry(
  spec: CockpitSpec,
  colour: number,
): BufferGeometry | null {
  const parts = paintExtras(spec, colour);
  if (spec.bonnet.lengthM > 0) parts.push(bonnetPart(spec, colour));
  return parts.length > 0 ? mergeParts(parts) : null;
}

/**
 * A steering wheel about its own centre: the rim in the YZ plane (+Y up, +Z right as the driver
 * sees it), three spokes, the hub, and the column running forward along +X into the dashboard.
 *
 * @param wheel - The kind's wheel.
 * @returns One merged geometry.
 */
export function wheelGeometry(wheel: CockpitWheel): BufferGeometry {
  const radius = wheel.radiusM;
  const rimAt = (angle: number): Vec3 => [
    0,
    Math.cos(angle) * radius,
    Math.sin(angle) * radius,
  ];
  const parts = [ringPart(radius, RIM_M / 2, "x", [0, 0, 0], RIM_BLACK)];
  for (const angle of [Math.PI / 2, Math.PI, (Math.PI * 3) / 2])
    parts.push(beam([0, 0, 0], rimAt(angle), SPOKE_M, HUB_GREY));
  parts.push(
    rod({
      radius: HUB_RADIUS_M,
      length: HUB_DEPTH_M,
      at: [0, 0, 0],
      axis: "x",
      colour: HUB_GREY,
      sides: ROUND_SIDES,
    }),
    rod({
      radius: COLUMN_RADIUS_M,
      length: COLUMN_LENGTH_M,
      at: [COLUMN_LENGTH_M / 2, 0, 0],
      axis: "x",
      colour: HUB_GREY,
      sides: ROUND_SIDES,
    }),
  );
  return mergeParts(parts);
}

/** A lit mark on the scale: through the face, along the radius, across; and its reach from the pivot. */
const TICK_SIZE: Vec3 = [0.004, 0.016, 0.005];
const TICK_RADIUS_SHARE = 0.78;
/** How far the scale, the needle and its cap stand proud of the face, toward the eye. */
const TICK_PROUD_M = 0.012;
const NEEDLE_PROUD_M = 0.016;
const NEEDLE_CAP_PROUD_M = 0.018;
/** The needle's section and its reach as a share of the dial's radius. */
const NEEDLE_SECTION: readonly [number, number] = [0.004, 0.006];
const NEEDLE_LENGTH_SHARE = 0.82;
/** The cap over the needle's pivot: radius, depth and facets. */
const NEEDLE_CAP_RADIUS_M = 0.009;
const NEEDLE_CAP_DEPTH_M = 0.008;
const NEEDLE_CAP_SIDES = 8;

/**
 * The lit marks round the speedometer's scale, in the dial's frame (face toward −X).
 *
 * @returns One merged geometry, for the unlit glow material.
 */
export function dialTickGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const radius = DIAL_RADIUS_M * TICK_RADIUS_SHARE;
  for (let index = 0; index < DIAL_TICKS; index++) {
    const angle =
      -DIAL_SWEEP_RAD / 2 + (index / (DIAL_TICKS - 1)) * DIAL_SWEEP_RAD;
    parts.push(
      block({
        size: TICK_SIZE,
        at: [-TICK_PROUD_M, Math.cos(angle) * radius, Math.sin(angle) * radius],
        colour: TICK_WHITE,
        rotation: [angle, 0, 0],
        gradient: 0,
      }),
    );
  }
  return mergeParts(parts);
}

/**
 * The speedometer's needle pointing up (+Y) from its pivot, in the dial's frame, with a cap over
 * the pivot.
 *
 * @returns One merged geometry, for the unlit glow material.
 */
export function needleGeometry(): BufferGeometry {
  const length = DIAL_RADIUS_M * NEEDLE_LENGTH_SHARE;
  return mergeParts([
    block({
      size: [NEEDLE_SECTION[0], length, NEEDLE_SECTION[1]],
      at: [-NEEDLE_PROUD_M, length / 2, 0],
      colour: NEEDLE_ORANGE,
      gradient: 0,
    }),
    rod({
      radius: NEEDLE_CAP_RADIUS_M,
      length: NEEDLE_CAP_DEPTH_M,
      at: [-NEEDLE_CAP_PROUD_M, 0, 0],
      axis: "x",
      colour: NEEDLE_ORANGE,
      sides: NEEDLE_CAP_SIDES,
      gradient: 0,
    }),
  ]);
}

/**
 * A quad on the windscreen between two shares of its height, `v` running 0 at `from` to 1 at
 * `to`, and across from `zFrom` to `zTo` (shares of the half-width, −1 left … 1 right).
 */
function screenQuad(
  screen: Screen,
  from: number,
  to: number,
  across: readonly [number, number],
): BufferGeometry {
  const point = (share: number, side: number): number[] => {
    const half = screen.footHalf + (screen.headHalf - screen.footHalf) * share;
    return [
      screen.footX + (screen.headX - screen.footX) * share,
      screen.baseY + (screen.headY - screen.baseY) * share,
      side * half,
    ];
  };
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(
      [
        ...point(from, across[0]),
        ...point(from, across[1]),
        ...point(to, across[1]),
        ...point(to, across[0]),
      ],
      3,
    ),
  );
  geometry.setAttribute(
    "uv",
    new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

/**
 * The windscreen as one quad for the glass's faint sheen, `v` rising from its foot.
 *
 * @param spec - The kind's cockpit.
 * @returns The quad, or `null` for the tank's open hatch.
 */
export function glassGeometry(spec: CockpitSpec): BufferGeometry | null {
  if (spec.frame === "hatch") return null;
  return screenQuad(screenOf(spec), 0, 1, [-1, 1]);
}

/**
 * The police light bar's glow on the top of the windscreen: the blue lens's half on the left, the
 * red one's on the right, `v` falling from the header so the glow fades downward.
 *
 * @param spec - The police car's cockpit.
 * @returns The left and right strips.
 */
export function sirenStripGeometry(spec: CockpitSpec): {
  left: BufferGeometry;
  right: BufferGeometry;
} {
  const screen = screenOf(spec);
  return {
    left: screenQuad(screen, 1, 1 - SIREN_STRIP_SHARE, [-1, 0]),
    right: screenQuad(screen, 1, 1 - SIREN_STRIP_SHARE, [0, 1]),
  };
}
