/**
 * The shapes of street clutter — a Dutch bicycle, a steel bike rack, a wheelie bin, a waste
 * container's drop pillar, an Amsterdammertje bollard, road signs on poles, a planter and a hedge —
 * built straight into a cell's vertex-coloured detail, so a street full of them costs no draw call
 * of its own. Every shape stands on the ground at a map point, turned to a heading.
 */
import {
  Color,
  InstancedMesh,
  Matrix4,
  type BufferGeometry,
  type Material,
  type Vector3Tuple,
} from "three";
import type { Point } from "../world/projection";
import { idUnit } from "./idHash";
import {
  axesAlong,
  createDetailBuffers,
  detailGeometry,
  pushDetailBox,
  pushDetailQuad,
  type BoxAxes,
  type DetailBuffers,
} from "./detailBuffers";

/** Where a shape stands: a map point, the unit direction it faces along, the ground height and the cell origin. */
export type Placement = {
  at: Point;
  direction: Point;
  ground: number;
  origin: Point;
};

/** A point of a placement's frame: `along` its direction, `up`, and `across` to its side, local metres. */
function framePoint(
  place: Placement,
  along: number,
  up: number,
  across: number,
): Vector3Tuple {
  const [dx, dy] = place.direction;
  return [
    place.at[0] + dx * along - dy * across - place.origin[0],
    place.ground + up,
    place.at[1] + dy * along + dx * across - place.origin[1],
  ];
}

/** The unit vector from one point to another. */
function unitBetween(from: Vector3Tuple, to: Vector3Tuple): Vector3Tuple {
  const delta: Vector3Tuple = [
    to[0] - from[0],
    to[1] - from[1],
    to[2] - from[2],
  ];
  const length = Math.hypot(...delta);
  return [delta[0] / length, delta[1] / length, delta[2] / length];
}

/** The cross product of two vectors, normalised. */
function crossUnit(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple {
  const cross: Vector3Tuple = [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const length = Math.hypot(...cross);
  return [cross[0] / length, cross[1] / length, cross[2] / length];
}

/** A beam this close to upright takes its sideways axis from +X instead of from up (cosine). */
const NEAR_VERTICAL_COS = 0.9;

/** A square beam between two points, `thickness` across. */
function pushBeam(
  detail: DetailBuffers,
  from: Vector3Tuple,
  to: Vector3Tuple,
  thickness: number,
  colour: number,
): void {
  const u = unitBetween(from, to);
  const hint: Vector3Tuple =
    Math.abs(u[1]) > NEAR_VERTICAL_COS ? [1, 0, 0] : [0, 1, 0];
  const w = crossUnit(u, hint);
  const v = crossUnit(w, u);
  const centre: Vector3Tuple = [
    (from[0] + to[0]) / 2,
    (from[1] + to[1]) / 2,
    (from[2] + to[2]) / 2,
  ];
  const length = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  pushDetailBox(detail, {
    centre,
    axes: { u, v, w },
    size: [length, thickness, thickness],
    colour,
  });
}

/** An upright box standing on the ground in a placement's frame. */
function pushStanding(
  detail: DetailBuffers,
  place: Placement,
  box: {
    along: number;
    across: number;
    size: Vector3Tuple;
    base: number;
    colour: number;
  },
): void {
  pushDetailBox(detail, {
    centre: framePoint(
      place,
      box.along,
      box.base + box.size[1] / 2,
      box.across,
    ),
    axes: axesAlong(place.direction),
    size: box.size,
    colour: box.colour,
    openBottom: box.base === 0,
  });
}

/** A bicycle's measurements, metres: wheel radii and centres, and the frame's corners (along, up). */
const BIKE = {
  wheel: 0.34,
  rim: 0.3,
  hubs: [-0.53, 0.53] as const,
  bracket: [-0.05, 0.3] as const,
  seat: [-0.2, 0.86] as const,
  head: [0.4, 0.84] as const,
  tube: 0.035,
  bar: 0.56,
  barRise: 0.12,
  saddle: [0.22, 0.05, 0.12] as Vector3Tuple,
};
/** Segments around a wheel's ring. */
const WHEEL_SEGMENTS = 8;
/** Tyres and the handlebar and saddle. */
const TYRE = 0x161616;
const BIKE_BLACK = 0x1c1c1e;

/** One wheel: a ring of flat segments in the bike's plane, seen from both sides. */
function pushWheel(detail: DetailBuffers, place: Placement, hub: number): void {
  const side: Vector3Tuple = [-place.direction[1], 0, place.direction[0]];
  const back: Vector3Tuple = [-side[0], 0, -side[2]];
  for (let segment = 0; segment < WHEEL_SEGMENTS; segment++) {
    const [a, b] = [segment, segment + 1].map(
      (index) => (index / WHEEL_SEGMENTS) * Math.PI * 2,
    );
    const point = (angle: number, radius: number): Vector3Tuple =>
      framePoint(
        place,
        hub + Math.cos(angle) * radius,
        BIKE.wheel + Math.sin(angle) * radius,
        0,
      );
    const quad: [Vector3Tuple, Vector3Tuple, Vector3Tuple, Vector3Tuple] = [
      point(a, BIKE.rim),
      point(b, BIKE.rim),
      point(b, BIKE.wheel),
      point(a, BIKE.wheel),
    ];
    pushDetailQuad(detail, quad, side, TYRE);
    pushDetailQuad(detail, quad, back, TYRE);
  }
}

/**
 * A Dutch city bicycle: two wheels, a diamond frame in its colour, handlebar and saddle.
 *
 * @param detail - The cell's detail buffers.
 * @param place - Where it stands and which way its front wheel points.
 * @param colour - The frame's colour.
 */
export function pushBike(
  detail: DetailBuffers,
  place: Placement,
  colour: number,
): void {
  for (const hub of BIKE.hubs) pushWheel(detail, place, hub);
  const at = ([along, up]: readonly [number, number]): Vector3Tuple =>
    framePoint(place, along, up, 0);
  const [rear, front] = [
    at([BIKE.hubs[0], BIKE.wheel]),
    at([BIKE.hubs[1], BIKE.wheel]),
  ];
  const [bracket, seat, head] = [
    at(BIKE.bracket),
    at(BIKE.seat),
    at(BIKE.head),
  ];
  for (const [from, to] of [
    [bracket, seat],
    [bracket, head],
    [seat, head],
    [bracket, rear],
    [seat, rear],
    [head, front],
  ] as const) {
    pushBeam(detail, from, to, BIKE.tube, colour);
  }
  const bar = BIKE.bar / 2;
  pushBeam(
    detail,
    framePoint(place, BIKE.head[0], BIKE.head[1] + BIKE.barRise, -bar),
    framePoint(place, BIKE.head[0], BIKE.head[1] + BIKE.barRise, bar),
    BIKE.tube,
    BIKE_BLACK,
  );
  pushDetailBox(detail, {
    centre: framePoint(place, BIKE.seat[0], BIKE.seat[1] + BIKE.saddle[1], 0),
    axes: axesAlong(place.direction),
    size: BIKE.saddle,
    colour: BIKE_BLACK,
  });
}

/** The frame colour of the bicycle template: white, so each bike's instance colour shows as is. */
const TEMPLATE_FRAME = 0xffffff;

/**
 * One bicycle at the origin, front wheel toward +X, its frame white for tinting per instance.
 *
 * @returns A new vertex-coloured geometry.
 */
export function bikeGeometry(): BufferGeometry {
  const buffers = createDetailBuffers();
  pushBike(
    buffers,
    { at: [0, 0], direction: [1, 0], ground: 0, origin: [0, 0] },
    TEMPLATE_FRAME,
  );
  return detailGeometry(buffers);
}

/** A parked bicycle: where it stands, the way its front wheel points, and its frame colour. */
export type BikeSpot = { at: Point; direction: Point; colour: number };

/**
 * A cell's parked bicycles as one instanced mesh: one draw call however many there are, each
 * turned to its direction and tinted its colour.
 *
 * @param bikes - The bicycles.
 * @param material - The vertex-coloured detail material.
 * @param look - The ground height and the cell origin.
 * @returns The mesh (owning its template geometry), or null with no bikes.
 */
export function buildBikes(
  bikes: readonly BikeSpot[],
  material: Material,
  look: { ground: number; origin: Point },
): InstancedMesh | null {
  if (bikes.length === 0) return null;
  const mesh = new InstancedMesh(bikeGeometry(), material, bikes.length);
  const [matrix, turn, colour] = [new Matrix4(), new Matrix4(), new Color()];
  bikes.forEach((bike, index) => {
    turn.makeRotationY(Math.atan2(-bike.direction[1], bike.direction[0]));
    matrix
      .makeTranslation(
        bike.at[0] - look.origin[0],
        look.ground,
        bike.at[1] - look.origin[1],
      )
      .multiply(turn);
    mesh.setMatrixAt(index, matrix);
    mesh.setColorAt(index, colour.set(bike.colour));
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/** A steel bike hoop (nietje): two legs and a top bar, in the placement's plane. */
const RACK = { height: 0.72, width: 0.5, tube: 0.045, colour: 0x7c8388 };

/**
 * A steel bike hoop.
 *
 * @param detail - The cell's detail buffers.
 * @param place - Where it stands; its bar runs along the placement's direction.
 */
export function pushRack(detail: DetailBuffers, place: Placement): void {
  const half = RACK.width / 2;
  const [footA, footB] = [
    framePoint(place, -half, 0, 0),
    framePoint(place, half, 0, 0),
  ];
  const [topA, topB] = [
    framePoint(place, -half, RACK.height, 0),
    framePoint(place, half, RACK.height, 0),
  ];
  pushBeam(detail, footA, topA, RACK.tube, RACK.colour);
  pushBeam(detail, footB, topB, RACK.tube, RACK.colour);
  pushBeam(detail, topA, topB, RACK.tube, RACK.colour);
}

/** A wheelie bin (kliko): body, and a lid in the colour of what it takes. */
const BIN = {
  width: 0.58,
  height: 0.98,
  depth: 0.72,
  lid: 0.06,
  lidOverhang: 0.04,
  body: 0x4b504d,
};

/**
 * A wheelie bin.
 *
 * @param detail - The cell's detail buffers.
 * @param place - Where it stands and which way its front faces.
 * @param lid - The lid's colour: green for garden waste, grey, blue for paper, orange for plastic.
 */
export function pushBin(
  detail: DetailBuffers,
  place: Placement,
  lid: number,
): void {
  pushStanding(detail, place, {
    along: 0,
    across: 0,
    size: [BIN.depth, BIN.height, BIN.width],
    base: 0,
    colour: BIN.body,
  });
  const size: Vector3Tuple = [
    BIN.depth + BIN.lidOverhang,
    BIN.lid,
    BIN.width + BIN.lidOverhang,
  ];
  pushStanding(detail, place, {
    along: 0,
    across: 0,
    size,
    base: BIN.height,
    colour: lid,
  });
}

/** An underground container's drop pillar and its steel floor plate. */
const PILLAR = {
  side: 0.8,
  height: 1.25,
  cap: 0.08,
  capProud: 0.06,
  band: 0.2,
  bandAt: 0.6,
  bandProud: 0.02,
  plate: 1.9,
  plateHeight: 0.02,
  body: 0x5b6166,
  capColour: 0x2b2f33,
  plateColour: 0x3a3e42,
};

/**
 * An underground waste container's drop pillar on its steel plate.
 *
 * @param detail - The cell's detail buffers.
 * @param place - Where it stands.
 * @param band - The coloured band telling what it takes.
 */
export function pushContainer(
  detail: DetailBuffers,
  place: Placement,
  band: number,
): void {
  pushStanding(detail, place, {
    along: 0,
    across: 0,
    size: [PILLAR.plate, PILLAR.plateHeight, PILLAR.plate],
    base: 0,
    colour: PILLAR.plateColour,
  });
  pushStanding(detail, place, {
    along: 0,
    across: 0,
    size: [PILLAR.side, PILLAR.height, PILLAR.side],
    base: PILLAR.plateHeight,
    colour: PILLAR.body,
  });
  const bandHeight = PILLAR.height * PILLAR.band;
  pushStanding(detail, place, {
    along: 0,
    across: 0,
    size: [
      PILLAR.side + PILLAR.bandProud,
      bandHeight,
      PILLAR.side + PILLAR.bandProud,
    ],
    base: PILLAR.height * PILLAR.bandAt,
    colour: band,
  });
  pushStanding(detail, place, {
    along: 0,
    across: 0,
    size: [
      PILLAR.side + PILLAR.capProud,
      PILLAR.cap,
      PILLAR.side + PILLAR.capProud,
    ],
    base: PILLAR.plateHeight + PILLAR.height,
    colour: PILLAR.capColour,
  });
}

/** An Amsterdammertje: a slim oxblood post with a wider head. */
const BOLLARD = {
  side: 0.12,
  height: 0.82,
  head: 0.16,
  headHeight: 0.1,
  colour: 0x4b1c17,
};

/**
 * A bollard.
 *
 * @param detail - The cell's detail buffers.
 * @param place - Where it stands.
 */
export function pushBollard(detail: DetailBuffers, place: Placement): void {
  pushStanding(detail, place, {
    along: 0,
    across: 0,
    size: [BOLLARD.side, BOLLARD.height, BOLLARD.side],
    base: 0,
    colour: BOLLARD.colour,
  });
  pushStanding(detail, place, {
    along: 0,
    across: 0,
    size: [BOLLARD.head, BOLLARD.headHeight, BOLLARD.head],
    base: BOLLARD.height,
    colour: BOLLARD.colour,
  });
}

/** The Dutch road signs clutter uses: give way (triangle), no entry-ish zone (round) and pedestrian crossing (blue square). */
export type SignKind = "giveWay" | "zone" | "crossing";

/** A sign pole's height and thickness, the plate's size and depth, metres; and the pole grey. */
const SIGN = {
  pole: 2.6,
  poleSide: 0.06,
  plate: 0.64,
  depth: 0.03,
  poleColour: 0x8e959b,
  back: 0x6f757a,
};
/** Sign colours: red rim, white field, blue board. */
const SIGN_RED = 0xb3261e;
const SIGN_WHITE = 0xe9e6de;
const SIGN_BLUE = 0x1f4f9e;
/** How far in from its rim a sign's inner field starts, as a share of its size. */
const SIGN_RIM_SHARE = 0.18;
/** A square sign's white panel sits further in from its blue rim. */
const SQUARE_RIM_FACTOR = 1.6;
/** The top corners of a point-down triangle sit this share of its half size above its middle. */
const TRIANGLE_TOP = 0.73;
/** Sides of a round sign's plate. */
const ROUND_SIGN_SIDES = 8;

/** A flat polygon (convex, corners in order) in a sign's plane, facing out of its front. */
function pushPlate(
  detail: DetailBuffers,
  corners: readonly Vector3Tuple[],
  normal: Vector3Tuple,
  colour: number,
): void {
  for (let index = 1; index + 1 < corners.length; index++) {
    pushDetailQuad(
      detail,
      [corners[0], corners[index], corners[index + 1], corners[index + 1]],
      normal,
      colour,
    );
  }
}

/** The outline of a sign's plate in (across, up) around its middle, at a scale. */
function signOutline(kind: SignKind, scale: number): [number, number][] {
  const half = (SIGN.plate / 2) * scale;
  if (kind === "crossing")
    return [
      [-half, -half],
      [half, -half],
      [half, half],
      [-half, half],
    ];
  if (kind === "giveWay")
    return [
      [0, -half],
      [half, half * TRIANGLE_TOP],
      [-half, half * TRIANGLE_TOP],
    ];
  return Array.from({ length: ROUND_SIGN_SIDES }, (_, index) => {
    const angle = (index / ROUND_SIGN_SIDES) * Math.PI * 2;
    return [Math.cos(angle) * half, Math.sin(angle) * half];
  });
}

/**
 * A road sign on its pole, its face toward the placement's direction.
 *
 * @param detail - The cell's detail buffers.
 * @param place - Where the pole stands; the face looks along its direction.
 * @param kind - Which sign.
 */
export function pushSign(
  detail: DetailBuffers,
  place: Placement,
  kind: SignKind,
): void {
  pushStanding(detail, place, {
    along: 0,
    across: 0,
    size: [SIGN.poleSide, SIGN.pole, SIGN.poleSide],
    base: 0,
    colour: SIGN.poleColour,
  });
  const middle = SIGN.pole - SIGN.plate / 2;
  const face = (along: number, scale: number): Vector3Tuple[] =>
    signOutline(kind, scale).map(([across, up]) =>
      framePoint(place, along, middle + up, across),
    );
  const front: Vector3Tuple = [place.direction[0], 0, place.direction[1]];
  const back: Vector3Tuple = [-front[0], 0, -front[2]];
  const [outer, inner] =
    kind === "crossing" ? [SIGN_BLUE, SIGN_WHITE] : [SIGN_RED, SIGN_WHITE];
  pushPlate(detail, face(SIGN.poleSide, 1), front, outer);
  pushPlate(
    detail,
    face(
      SIGN.poleSide + SIGN.depth / 2,
      1 - SIGN_RIM_SHARE * (kind === "crossing" ? SQUARE_RIM_FACTOR : 1),
    ),
    front,
    inner,
  );
  pushPlate(detail, face(SIGN.poleSide - SIGN.depth, 1), back, SIGN.back);
}

/** A concrete planter with a clipped shrub on top. */
const PLANTER = {
  length: 1.1,
  width: 0.55,
  height: 0.5,
  shrub: 0.38,
  shrubShare: 0.88,
  concrete: 0x8a877f,
  green: 0x2e5a2b,
};

/**
 * A planter.
 *
 * @param detail - The cell's detail buffers.
 * @param place - Where it stands; its long side runs along the direction.
 */
export function pushPlanter(detail: DetailBuffers, place: Placement): void {
  pushStanding(detail, place, {
    along: 0,
    across: 0,
    size: [PLANTER.length, PLANTER.height, PLANTER.width],
    base: 0,
    colour: PLANTER.concrete,
  });
  const shrub: Vector3Tuple = [
    PLANTER.length * PLANTER.shrubShare,
    PLANTER.shrub,
    PLANTER.width * PLANTER.shrubShare,
  ];
  pushStanding(detail, place, {
    along: 0,
    across: 0,
    size: shrub,
    base: PLANTER.height,
    colour: PLANTER.green,
  });
}

/** A hedge's width and height, metres, and the length of one clipped section. */
const HEDGE = { width: 0.6, height: 1.05, section: 1.2 };
/** How much a section's height and width vary either way, metres. */
const HEDGE_JITTER = { height: 0.09, width: 0.05 };
/** The greens hedge sections are clipped in, alternating darker and lighter. */
const HEDGE_GREENS: readonly number[] = [0x2b4a25, 0x345a2c, 0x2f5128];
/** Salt of a section's variation. */
const HEDGE_SALT = 0xa1;
/** A section's middle, as a share of its length. */
const SECTION_MIDDLE = 0.5;
/** Keeps a section's seed apart from its neighbours'. */
const HEDGE_SEED_STRIDE = 7919;

/**
 * A clipped hedge between two map points, in sections of about a metre that each vary a little in
 * height, width and green, so it reads as a hedge rather than a slab.
 *
 * @param detail - The cell's detail buffers.
 * @param from - One end, map metres.
 * @param to - The other end.
 * @param look - The ground height and the cell origin.
 */
export function pushHedge(
  detail: DetailBuffers,
  from: Point,
  to: Point,
  look: { ground: number; origin: Point },
): void {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (length === 0) return;
  const direction: Point = [
    (to[0] - from[0]) / length,
    (to[1] - from[1]) / length,
  ];
  const axes: BoxAxes = axesAlong(direction);
  const sections = Math.max(1, Math.round(length / HEDGE.section));
  const step = length / sections;
  const seedBase =
    Math.floor(Math.abs(from[0] * HEDGE_SEED_STRIDE + from[1])) >>> 0;
  for (let section = 0; section < sections; section++) {
    const roll = (salt: number): number =>
      idUnit(seedBase + section, HEDGE_SALT + salt) * 2 - 1;
    const height = HEDGE.height + roll(0) * HEDGE_JITTER.height;
    const along = (section + SECTION_MIDDLE) * step;
    pushDetailBox(detail, {
      centre: [
        from[0] + direction[0] * along - look.origin[0],
        look.ground + height / 2,
        from[1] + direction[1] * along - look.origin[1],
      ],
      axes,
      size: [step, height, HEDGE.width + roll(1) * HEDGE_JITTER.width],
      colour: HEDGE_GREENS[section % HEDGE_GREENS.length],
      openBottom: true,
    });
  }
}
