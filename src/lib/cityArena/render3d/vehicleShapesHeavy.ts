/**
 * The shapes of the working vehicles — city bus, tractor and tank — built with the same kit and
 * part tables as the passenger kinds (see `vehicleShapes.ts` for the frame and conventions).
 */
import { Group } from "three";
import {
  addBumpers,
  addParts,
  axle,
  DARK_HUB,
  GLASS,
  HEADLIGHT,
  STEEL_RIM,
  TAIL_LIGHT,
  TRIM,
  TYRE,
  type Part,
  type Shape,
} from "./vehicleShapes";
import type { WheelLook } from "./vehicleParts";
import { addPlates, addWheelArches } from "./vehicleTrim";

/** The blue skirt of the city bus, from its sprite. */
const BUS_BLUE = 0x3060a0;
/** The bus's roof-top air-conditioning units. */
const BUS_ROOF_UNIT = 0xa3a6a8;
/** The destination board's amber LEDs. */
const SIGN_AMBER = 0xffae1a;

/** The bus's white box, blue skirt and roof units (12 × 2.5 m, 3.1 m tall). */
const BUS_SHELL: readonly Part[] = [
  // Body, skirt, then the two roof units.
  {
    colour: "paint",
    shape: {
      x: [-5.97, 5.97],
      y: [0.32, 2.95],
      width: 2.4,
      taper: { side: 0.03, front: 0.04, rear: 0.03 },
    },
  },
  {
    colour: BUS_BLUE,
    shape: { x: [-5.985, 5.985], y: [0.32, 0.8], width: 2.44 },
  },
  {
    colour: BUS_ROOF_UNIT,
    shape: { x: [2.0, 3.6], y: [2.95, 3.1], width: 1.3 },
  },
  {
    colour: BUS_ROOF_UNIT,
    shape: { x: [-3.9, -2.3], y: [2.95, 3.1], width: 1.3 },
  },
];

/** The window band down both sides, the screens at each end and the doors on the kerb side. */
const BUS_GLAZING: readonly Part[] = [
  // Window band, windscreen, rear window, front door, middle door.
  {
    colour: GLASS,
    mirror: true,
    shape: { x: [-5.5, 5.1], y: [1.25, 2.5], width: 0.05, z: 1.195 },
  },
  { colour: GLASS, shape: { x: [5.94, 5.99], y: [0.95, 2.6], width: 2.2 } },
  { colour: GLASS, shape: { x: [-5.99, -5.94], y: [1.9, 2.6], width: 1.8 } },
  {
    colour: GLASS,
    shape: { x: [4.35, 5.45], y: [0.36, 2.5], width: 0.04, z: 1.22 },
  },
  {
    colour: GLASS,
    shape: { x: [0.1, 1.3], y: [0.36, 2.5], width: 0.04, z: 1.22 },
  },
];

/** Lamps, the destination board and the mirrors hanging forward at the screen's corners. */
const BUS_ENDS: readonly Part[] = [
  // Headlights, tail lights, destination board, mirrors.
  {
    colour: HEADLIGHT,
    glow: true,
    mirror: true,
    shape: { x: [5.93, 5.998], y: [0.5, 0.68], width: 0.36, z: 0.93 },
  },
  {
    colour: TAIL_LIGHT,
    glow: true,
    mirror: true,
    shape: { x: [-5.998, -5.93], y: [0.95, 1.55], width: 0.16, z: 1.11 },
  },
  { colour: TRIM, shape: { x: [5.94, 5.988], y: [2.62, 2.9], width: 1.7 } },
  {
    colour: TRIM,
    mirror: true,
    shape: { x: [5.75, 5.9], y: [2.0, 2.35], width: 0.08, z: 1.21 },
  },
];

/** Positions of the pillars between the side windows, along the body. */
const BUS_PILLARS_X = [-5.0, -3.8, -2.6, -1.4, -0.2, 1.0, 2.2, 3.4, 4.6];
/** Width of a window pillar. */
const BUS_PILLAR_M = 0.12;

/** A window pillar on both sides at `x`, standing just proud of the glass. */
function busPillar(x: number): Part {
  return {
    colour: "paint",
    mirror: true,
    shape: {
      x: [x - BUS_PILLAR_M / 2, x + BUS_PILLAR_M / 2],
      y: [1.25, 2.5],
      width: 0.05,
      z: 1.205,
    },
  };
}

/**
 * "H3" in a 3 × 5 pixel font, as bars of lit cells `[col0, row0, col1, row1]` (inclusive; row 0
 * on top, column 0 on the reader's left). The H takes columns 0–2, the 3 columns 4–6.
 */
const H3_BARS: readonly (readonly [number, number, number, number])[] = [
  [0, 0, 0, 4],
  [2, 0, 2, 4],
  [1, 2, 1, 2],
  [4, 0, 6, 0],
  [4, 2, 6, 2],
  [4, 4, 6, 4],
  [6, 1, 6, 1],
  [6, 3, 6, 3],
];
/** Columns of the lettering: two glyphs of three and a gap. */
const SIGN_COLUMNS = 7;
/** Rows of the lettering. */
const SIGN_ROWS = 5;
/** Size of one LED cell. */
const SIGN_CELL_M = 0.05;
/** Middle of the destination board's face. */
const SIGN_CENTRE_Y_M = 2.76;
/** The lettering stands from here to the bus's nose, just proud of the board. */
const SIGN_FACE_X: readonly [number, number] = [5.985, 6.0];

/**
 * One bar of the "H3" lettering. A reader facing the bus's nose sees its right-hand side (+z) on
 * their left, so columns run from +z toward −z.
 */
function signBar(bar: readonly [number, number, number, number]): Part {
  const [col0, row0, col1, row1] = bar;
  const left = (SIGN_COLUMNS * SIGN_CELL_M) / 2;
  const top = SIGN_CENTRE_Y_M + (SIGN_ROWS * SIGN_CELL_M) / 2;
  return {
    colour: SIGN_AMBER,
    glow: true,
    shape: {
      x: SIGN_FACE_X,
      y: [top - (row1 + 1) * SIGN_CELL_M, top - row0 * SIGN_CELL_M],
      width: (col1 - col0 + 1) * SIGN_CELL_M,
      z: left - ((col0 + col1 + 1) * SIGN_CELL_M) / 2,
    },
  };
}

/** Height of the lower edge of the bus's bumpers. */
const BUS_BUMPER_Y_M = 0.25;
/** The bus's front axle, well back from the nose, behind the front door. */
const BUS_FRONT_AXLE_X_M = 3.3;
/** The bus's rear axle, with a long overhang behind it. */
const BUS_REAR_AXLE_X_M = -2.6;
/** The bus's wheel. */
const BUS_WHEEL: WheelLook = {
  radius: 0.5,
  width: 0.3,
  tyre: TYRE,
  rim: STEEL_RIM,
  hub: DARK_HUB,
};

/** Half the width of the bus's skirt, metres: where its arches stand. */
const BUS_SIDE_M = 1.22;
/** The bus's plates: the front one under the windscreen, the rear one over the bumper, metres. */
const BUS_PLATES = { front: 0.46, rear: 0.62 };

/** A white-and-blue city bus with a window band and an "H3" destination board. */
const busShape: Shape = (kit) => {
  addParts(kit, BUS_SHELL);
  addParts(kit, BUS_GLAZING);
  addParts(kit, BUS_PILLARS_X.map(busPillar));
  addParts(kit, BUS_ENDS);
  addParts(kit, H3_BARS.map(signBar));
  addBumpers(kit, BUS_BUMPER_Y_M);
  const axles = [
    axle(kit, BUS_FRONT_AXLE_X_M, BUS_WHEEL, true),
    axle(kit, BUS_REAR_AXLE_X_M, BUS_WHEEL, false),
  ];
  addWheelArches(kit, axles, BUS_SIDE_M);
  addPlates(kit, BUS_PLATES);
  return { axles };
};

/** Yellow rims, as on the tractor's sprite. */
const TRACTOR_RIM = 0xe0b52a;
/** The tractor cab's dark roof, from its sprite. */
const CAB_ROOF = 0x3a3c3e;

/** Bonnet, cab and fenders of the tractor (4 × 2.2 m, 2.6 m tall). */
const TRACTOR_BODY: readonly Part[] = [
  // Bonnet, cab base, rear fenders and their inner walls, glass cab, cab roof.
  {
    colour: "paint",
    shape: {
      x: [0.1, 1.8],
      y: [0.62, 1.42],
      width: 0.8,
      taper: { front: 0.14, side: 0.05 },
    },
  },
  { colour: "paint", shape: { x: [-1.45, 0.15], y: [0.62, 1.28], width: 1.2 } },
  {
    colour: "paint",
    mirror: true,
    shape: { x: [-1.92, -0.28], y: [1.58, 1.66], width: 0.5, z: 0.85 },
  },
  {
    colour: "paint",
    mirror: true,
    shape: { x: [-1.85, -0.35], y: [0.95, 1.62], width: 0.05, z: 0.62 },
  },
  {
    colour: GLASS,
    shape: {
      x: [-1.42, 0.12],
      y: [1.28, 2.44],
      width: 1.3,
      taper: { front: 0.08, side: 0.03 },
    },
  },
  { colour: CAB_ROOF, shape: { x: [-1.55, 0.25], y: [2.44, 2.6], width: 1.5 } },
];

/** Chassis, grille, front weight, front axle, tow hitch, exhaust stack and lamps. */
const TRACTOR_RUNNING_GEAR: readonly Part[] = [
  // Chassis, grille, front weight, front axle, hitch; then exhaust and lamps.
  { colour: TRIM, shape: { x: [-0.4, 1.85], y: [0.42, 0.64], width: 0.62 } },
  { colour: TRIM, shape: { x: [1.74, 1.86], y: [0.66, 1.26], width: 0.62 } },
  { colour: TRIM, shape: { x: [1.84, 2.0], y: [0.42, 0.66], width: 0.86 } },
  { colour: TRIM, shape: { x: [1.38, 1.52], y: [0.36, 0.48], width: 1.26 } },
  { colour: TRIM, shape: { x: [-2.0, -1.45], y: [0.5, 0.6], width: 0.14 } },
  {
    colour: TRIM,
    shape: {
      radius: 0.05,
      length: 1.0,
      axis: "y",
      at: [1.1, 1.92, -0.3],
      segments: 8,
    },
  },
  {
    colour: HEADLIGHT,
    glow: true,
    mirror: true,
    shape: { x: [1.78, 1.9], y: [1.1, 1.24], width: 0.14, z: 0.24 },
  },
  {
    colour: TAIL_LIGHT,
    glow: true,
    mirror: true,
    shape: { x: [-1.97, -1.91], y: [1.46, 1.56], width: 0.12, z: 0.95 },
  },
];

/** The tractor's big driven rear wheel. */
const TRACTOR_REAR_WHEEL: WheelLook = {
  radius: 0.8,
  width: 0.44,
  tyre: TYRE,
  rim: TRACTOR_RIM,
  hub: DARK_HUB,
};
/** Where the tractor's rear axle sits. */
const TRACTOR_REAR_AXLE_X_M = -1.1;
/** The tractor's small steered front wheel. */
const TRACTOR_FRONT_WHEEL: WheelLook = {
  radius: 0.42,
  width: 0.24,
  tyre: TYRE,
  rim: TRACTOR_RIM,
  hub: DARK_HUB,
};
/** Where the tractor's front axle sits. */
const TRACTOR_FRONT_AXLE_X_M = 1.45;
/** The front wheels stand on a narrower track than the rear ones. */
const TRACTOR_FRONT_TRACK_M = 0.68;

/** A green farm tractor with a glass cab and big rear wheels. */
const tractorShape: Shape = (kit) => {
  addParts(kit, TRACTOR_BODY);
  addParts(kit, TRACTOR_RUNNING_GEAR);
  return {
    axles: [
      axle(
        kit,
        TRACTOR_FRONT_AXLE_X_M,
        TRACTOR_FRONT_WHEEL,
        true,
        TRACTOR_FRONT_TRACK_M,
      ),
      axle(kit, TRACTOR_REAR_AXLE_X_M, TRACTOR_REAR_WHEEL, false),
    ],
  };
};

/** The tank's tracks. */
const TANK_TRACK = 0x262626;
/** The road wheels seen along the tracks. */
const TANK_ROAD_WHEEL = 0x3a3d33;
/** The dark olive of hatch, fume extractor and muzzle. */
const TANK_DARK_OLIVE = 0x3a4628;
/** A lighter olive on the sprocket rims, so the dark hub cross shows them turning. */
const TANK_SPROCKET_RIM = 0x5b6b3c;

/** The tank's hull with a sloped glacis, its tracks, engine deck and lamps (7 × 3.4 m). */
const TANK_HULL: readonly Part[] = [
  // Hull, tracks, engine deck grille, headlights, tail lights.
  {
    colour: "paint",
    shape: {
      x: [-3.5, 2.3],
      y: [0.32, 1.38],
      width: 1.9,
      taper: { front: 0.95, rear: 0.1, side: 0.08 },
    },
  },
  {
    colour: TANK_TRACK,
    mirror: true,
    shape: { x: [-2.95, 1.75], y: [0.02, 1.0], width: 0.8, z: 1.28 },
  },
  {
    colour: TANK_DARK_OLIVE,
    shape: { x: [-3.2, -2.5], y: [1.38, 1.4], width: 1.2 },
  },
  {
    colour: HEADLIGHT,
    glow: true,
    mirror: true,
    shape: { x: [1.72, 1.9], y: [0.88, 1.0], width: 0.18, z: 0.62 },
  },
  {
    colour: TAIL_LIGHT,
    glow: true,
    mirror: true,
    shape: { x: [-3.5, -3.44], y: [1.1, 1.22], width: 0.18, z: 0.62 },
  },
];

/** Where the road wheels sit along the tracks, between the sprockets. */
const TANK_ROAD_WHEELS_X = [-2.0, -1.3, -0.6, 0.1, 0.8];

/** A road wheel on the outer face of both tracks at `x`. */
function roadWheel(x: number): Part {
  return {
    colour: TANK_ROAD_WHEEL,
    mirror: true,
    shape: {
      radius: 0.3,
      length: 0.02,
      axis: "z",
      at: [x, 0.4, 1.69],
      segments: 10,
    },
  };
}

/** Turret shell, mantlet, barrel with fume extractor and muzzle, and the commander's hatch. */
const TURRET_PARTS: readonly Part[] = [
  // Shell, mantlet, barrel, fume extractor, muzzle, hatch.
  {
    colour: "paint",
    shape: {
      radius: 1.05,
      radiusTop: 0.88,
      length: 0.66,
      axis: "y",
      at: [0, 0.33, 0],
      segments: 10,
      stretchX: 1.25,
    },
  },
  {
    colour: "paint",
    shape: {
      x: [1.05, 1.5],
      y: [0.14, 0.56],
      width: 0.72,
      taper: { front: 0.08 },
    },
  },
  {
    colour: "paint",
    shape: {
      radius: 0.1,
      length: 2.17,
      axis: "x",
      at: [2.535, 0.35, 0],
      segments: 8,
    },
  },
  {
    colour: TANK_DARK_OLIVE,
    shape: {
      radius: 0.14,
      length: 0.45,
      axis: "x",
      at: [2.5, 0.35, 0],
      segments: 8,
    },
  },
  {
    colour: TANK_DARK_OLIVE,
    shape: {
      radius: 0.14,
      length: 0.33,
      axis: "x",
      at: [3.785, 0.35, 0],
      segments: 8,
    },
  },
  {
    colour: TANK_DARK_OLIVE,
    shape: {
      radius: 0.3,
      length: 0.21,
      axis: "y",
      at: [-0.3, 0.765, 0.38],
      segments: 10,
    },
  },
];

/** Where the turret turns along the hull: a little behind the middle, as on the sprite. */
const TURRET_PIVOT_X_M = -0.45;
/** The turret sits on the hull roof. */
const TURRET_PIVOT_Y_M = 1.38;
/** The drive sprocket at the front of each track and the idler at the back. */
const TANK_SPROCKET: WheelLook = {
  radius: 0.5,
  width: 0.8,
  tyre: TANK_TRACK,
  rim: TANK_SPROCKET_RIM,
  hub: DARK_HUB,
};
/** Where the sprockets sit along the body: drive at the front, idler at the back. */
const TANK_SPROCKET_X_M: readonly [number, number] = [1.75, -2.95];
/** Distance of each track's centre from the centre line. */
const TANK_TRACK_Z_M = 1.28;

/** An olive main battle tank; its sprockets are its "wheels", and it steers by its tracks. */
const tankShape: Shape = (kit) => {
  addParts(kit, TANK_HULL);
  addParts(kit, TANK_ROAD_WHEELS_X.map(roadWheel));
  const turret = new Group();
  turret.name = "turret";
  turret.position.set(TURRET_PIVOT_X_M, TURRET_PIVOT_Y_M, 0);
  turret.add(kit.assemble("turret-shell", TURRET_PARTS));
  return {
    axles: TANK_SPROCKET_X_M.map((x) =>
      axle(kit, x, TANK_SPROCKET, false, TANK_TRACK_Z_M),
    ),
    turret,
  };
};

/** Every working kind's shape. */
export const HEAVY_SHAPES = {
  bus: busShape,
  tractor: tractorShape,
  tank: tankShape,
} satisfies Record<string, Shape>;
