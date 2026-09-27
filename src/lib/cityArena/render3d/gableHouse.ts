/**
 * The narrow Dutch terraced house seen from its street: a steep pitched roof whose ridge runs back
 * from the street, a stepped (trapgevel) or bell (klokgevel) gable standing proud of the roof on
 * the street end with a hoist window in it, and a plain gable closing the back. The gables are
 * walls: they wear the building's own façade sheet (its plain block), so the brick runs on up from
 * the storeys below, and they scorch with the building.
 */
import type { Vector3Tuple } from "three";
import type { DecodedBuilding } from "../world/decode";
import type { Point } from "../world/projection";
import { pushDetailBox, axesAlong, type DetailBuffers } from "./detailBuffers";
import { facadeBlockRect } from "./facadeAtlas";
import type { GablePlan } from "./facadePlan";
import { offsetPoint, orientedBox, type OrientedBox } from "./footprint";
import type { MeshBuffers } from "./meshBuffers";
import { pushTriangleFacing } from "./meshBuffers";
import {
  ROOF_OVERHANG_M,
  pushFascia,
  pushRoofFace,
  roofUv,
  type RoofCorner,
} from "./roofDetail";
import { FACADE_MODULE_M } from "./textures";
import { STOREY_M, pushWallVertex, type WallBuffers } from "./wallQuads";

/** The roof's pitch: steep, as narrow old houses have. */
const GABLE_PITCH = Math.tan((50 * Math.PI) / 180);
/** The highest the ridge rises above the eaves, metres. */
const GABLE_MAX_RISE_M = 5.5;
/** Thickness of the street gable, metres; the roof stops behind it. */
const GABLE_THICKNESS_M = 0.3;
/** The roof reaches this far past the back wall, metres. */
const BACK_OVERHANG_M = 0.2;
/** How far the gable's outline stands above the roof behind it, metres. */
const GABLE_MARGIN_M = 0.35;
/** Half the width of the gable's top, metres, and how far the step gable's top block rises. */
const TOP_HALF_M = 0.45;
const STEP_PEAK_M = 0.5;
/** Steps up each side of a stepped gable. */
const STEPS = 3;
/** The bell gable: its shoulder height, how far its top rises over the roof, its cornice. */
const BELL = {
  shoulder: 0.3,
  extra: 0.3,
  cornice: 0.12,
  corniceHeight: 0.18,
  segments: 6,
};
/** The hoist window: its bottom over the eaves, width, most height, frame and glass depth, metres. */
const HOIST = {
  bottom: 0.5,
  width: 0.9,
  height: 1.4,
  frame: 0.08,
  depth: 0.06,
  glass: 0.01,
};
const HOIST_FRAME = 0xe8e4da;
const HOIST_GLASS = 0x1b2230;

/** Everything a gable house writes into: roof tiles, walls and detail. */
export type GableTargets = {
  tiled: MeshBuffers;
  walls: WallBuffers;
  detail: DetailBuffers;
};

/** The gable's frame: its footprint box, street end, rise and eaves. */
type GableFrame = {
  box: OrientedBox;
  end: 1 | -1;
  half: number;
  rise: number;
  eaves: number;
  origin: Point;
  sheet: number;
};

/**
 * A stepped gable's outline as its right-hand chain in (across, up from the eaves), from the
 * bottom corner up to the middle of the top: three steps, each standing {@link GABLE_MARGIN_M}
 * over the roof line at its inner edge, and a block on top. The left side is its mirror image.
 *
 * @param half - Half the gable's width, metres.
 * @param rise - The roof's rise from the eaves to the ridge, metres.
 * @returns The chain's corners, heights never falling.
 */
export function stepOutline(half: number, rise: number): Point[] {
  const step = (half - TOP_HALF_M) / STEPS;
  const chain: Point[] = [[half, 0]];
  for (let index = 0; index < STEPS; index++) {
    const [outer, inner] = [half - index * step, half - (index + 1) * step];
    const top = rise * (1 - inner / half) + GABLE_MARGIN_M;
    chain.push([outer, top], [inner, top]);
  }
  const peak = rise + GABLE_MARGIN_M + STEP_PEAK_M;
  chain.push([TOP_HALF_M, peak], [0, peak]);
  return chain;
}

/**
 * A bell gable's outline as its right-hand chain in (across, up from the eaves), from the bottom
 * corner up to the middle of the top: a low shoulder, a quarter-ellipse swelling up to a narrow
 * top well over the roof line, and a small cornice. The left side is its mirror image.
 *
 * @param half - Half the gable's width, metres.
 * @param rise - The roof's rise from the eaves to the ridge, metres.
 * @returns The chain's corners, heights never falling.
 */
export function bellOutline(half: number, rise: number): Point[] {
  const top = rise + GABLE_MARGIN_M + BELL.extra;
  const chain: Point[] = [
    [half, 0],
    [half, BELL.shoulder],
  ];
  for (let index = 1; index <= BELL.segments; index++) {
    const angle = (index / BELL.segments) * (Math.PI / 2);
    chain.push([
      TOP_HALF_M + (half - TOP_HALF_M) * Math.cos(angle),
      BELL.shoulder + (top - BELL.shoulder) * Math.sin(angle),
    ]);
  }
  const cornice = TOP_HALF_M + BELL.cornice;
  const crest = top + BELL.corniceHeight;
  chain.push([cornice, top], [cornice, crest], [0, crest]);
  return chain;
}

/** A point of the gable plane: `across` from the end's centre, `up` over the eaves, `inset` back. */
function gablePoint(
  frame: GableFrame,
  across: number,
  up: number,
  inset: number,
): Vector3Tuple {
  const { box, end } = frame;
  const at = offsetPoint(
    box.centre,
    [box.long, end * (box.length / 2 - inset)],
    [box.across, across],
  );
  return [at[0] - frame.origin[0], frame.eaves + up, at[1] - frame.origin[1]];
}

/** The plain block's UV at a point of the gable plane. */
function gableUv(across: number, height: number): [number, number] {
  return [across / FACADE_MODULE_M, height / STOREY_M];
}

/** Pushes a wall quad (corners in order round its rim) facing `normal`, UVs given. */
function pushGableQuad(
  walls: WallBuffers,
  corners: readonly Vector3Tuple[],
  normal: Vector3Tuple,
  uvs: readonly [number, number][],
  block: readonly number[],
): void {
  const base = walls.positions.length / 3;
  corners.forEach((corner, at) =>
    pushWallVertex(walls, corner, normal, uvs[at], block),
  );
  pushTriangleFacing(walls, [base, base + 1, base + 2], normal);
  pushTriangleFacing(walls, [base, base + 2, base + 3], normal);
}

/**
 * One face of the gable, `inset` behind the street plane and facing `sign` along the axis, as a
 * stack of horizontal bands: each rising step of the chain and its mirror make one trapezoid.
 */
function pushOutlineFace(
  walls: WallBuffers,
  frame: GableFrame,
  chain: readonly Point[],
  inset: number,
  sign: 1 | -1,
): void {
  const block = facadeBlockRect("plain", frame.sheet);
  const normal: Vector3Tuple = [
    frame.box.long[0] * frame.end * sign,
    0,
    frame.box.long[1] * frame.end * sign,
  ];
  for (let index = 1; index < chain.length; index++) {
    const [[x0, h0], [x1, h1]] = [chain[index - 1], chain[index]];
    if (h1 <= h0) continue;
    const band: Point[] = [
      [-x0, h0],
      [x0, h0],
      [x1, h1],
      [-x1, h1],
    ];
    pushGableQuad(
      walls,
      band.map(([s, h]) => gablePoint(frame, s, h, inset)),
      normal,
      band.map(([s, h]) => gableUv(s, frame.eaves + h)),
      block,
    );
  }
}

/**
 * The sides of the extruded outline — step tops, risers, the bell's curve — for every chain edge
 * and its mirror. Walking up the right chain the solid lies to the left, so its outward normal is
 * `(dh, −ds)`; the mirror's is `(−dh, −ds)`.
 */
function pushOutlineSides(
  walls: WallBuffers,
  frame: GableFrame,
  chain: readonly Point[],
): void {
  const block = facadeBlockRect("plain", frame.sheet);
  const { box } = frame;
  const depth = GABLE_THICKNESS_M / STOREY_M;
  for (let index = 1; index < chain.length; index++) {
    const [a, b] = [chain[index - 1], chain[index]];
    const [ds, dh] = [b[0] - a[0], b[1] - a[1]];
    const length = Math.hypot(ds, dh);
    if (length === 0) continue;
    const run = length / FACADE_MODULE_M;
    for (const mirror of [1, -1]) {
      const across = (mirror * dh) / length;
      const normal: Vector3Tuple = [
        box.across[0] * across,
        -ds / length,
        box.across[1] * across,
      ];
      const [sa, sb] = [a[0] * mirror, b[0] * mirror];
      pushGableQuad(
        walls,
        [
          gablePoint(frame, sa, a[1], 0),
          gablePoint(frame, sb, b[1], 0),
          gablePoint(frame, sb, b[1], GABLE_THICKNESS_M),
          gablePoint(frame, sa, a[1], GABLE_THICKNESS_M),
        ],
        normal,
        [
          [0, 0],
          [run, 0],
          [run, depth],
          [0, depth],
        ],
        block,
      );
    }
  }
}

/** The two roof slopes, from the back overhang to the street gable's back face. */
function pushGableRoof(
  tiled: MeshBuffers,
  frame: GableFrame,
  ring: readonly Point[],
): number {
  const { box, end, half, rise, eaves } = frame;
  const drop = ROOF_OVERHANG_M * (rise / half);
  const front = end * (box.length / 2 - GABLE_THICKNESS_M);
  const back = -end * (box.length / 2 + BACK_OVERHANG_M);
  const at = (along: number, across: number, height: number): RoofCorner => ({
    point: offsetPoint(box.centre, [box.long, along], [box.across, across]),
    height,
  });
  const uvOf = roofUv(ring);
  for (const side of [-1, 1]) {
    const reach = side * (half + ROOF_OVERHANG_M);
    pushRoofFace(
      tiled,
      [
        at(back, 0, eaves + rise),
        at(front, 0, eaves + rise),
        at(front, reach, eaves - drop),
        at(back, reach, eaves - drop),
      ],
      frame.origin,
      uvOf,
    );
  }
  return eaves - drop;
}

/** The plain triangle closing the back under the roof. */
function pushBackGable(walls: WallBuffers, frame: GableFrame): void {
  const back: GableFrame = { ...frame, end: frame.end === 1 ? -1 : 1 };
  pushOutlineFace(
    walls,
    back,
    [
      [frame.half, 0],
      [0, frame.rise],
    ],
    0,
    1,
  );
}

/** The hoist window in the street gable: a white frame with dark glass, standing just proud. */
function pushHoistWindow(detail: DetailBuffers, frame: GableFrame): void {
  const height = Math.min(
    HOIST.height,
    frame.rise - HOIST.bottom - GABLE_MARGIN_M,
  );
  if (height <= 0) return;
  const middle = HOIST.bottom + height / 2;
  const axes = axesAlong([frame.box.across[0], frame.box.across[1]]);
  pushDetailBox(detail, {
    centre: gablePoint(frame, 0, middle, -HOIST.depth / 2),
    axes,
    size: [
      HOIST.width + 2 * HOIST.frame,
      height + 2 * HOIST.frame,
      HOIST.depth,
    ],
    colour: HOIST_FRAME,
  });
  pushDetailBox(detail, {
    centre: gablePoint(frame, 0, middle, -HOIST.depth - HOIST.glass / 2),
    axes,
    size: [HOIST.width, height, HOIST.glass],
    colour: HOIST_GLASS,
  });
}

/**
 * A narrow house's gable roof and gables: steep slopes up to a ridge along the footprint's long
 * axis (overhanging the eaves and the back), fascia boards along the eaves, the street gable in
 * its stepped or bell outline, the plain back gable, and a hoist window in the street gable.
 *
 * @param targets - The tiled-roof, wall and detail buffers.
 * @param building - The house.
 * @param gable - Which end faces the street and the gable's outline.
 * @param look - Eaves height, façade sheet, fascia colour and the cell origin.
 * @returns The ridge height, metres (for a chimney).
 */
export function pushGableHouse(
  targets: GableTargets,
  building: DecodedBuilding,
  gable: GablePlan,
  look: { eaves: number; sheet: number; fascia: number; origin: Point },
): number {
  const box = orientedBox(building.ring);
  const half = box.width / 2;
  const rise = Math.min(GABLE_MAX_RISE_M, half * GABLE_PITCH);
  const frame: GableFrame = {
    box,
    end: gable.end,
    half,
    rise,
    eaves: look.eaves,
    origin: look.origin,
    sheet: look.sheet,
  };
  const edge = pushGableRoof(targets.tiled, frame, building.ring);
  pushFascia(
    targets.detail,
    box,
    { long: true, ends: false },
    {
      colour: look.fascia,
      overhang: ROOF_OVERHANG_M,
      edge,
      origin: look.origin,
    },
  );
  const outline =
    gable.kind === "step" ? stepOutline(half, rise) : bellOutline(half, rise);
  pushOutlineFace(targets.walls, frame, outline, 0, 1);
  pushOutlineFace(targets.walls, frame, outline, GABLE_THICKNESS_M, -1);
  pushOutlineSides(targets.walls, frame, outline);
  pushBackGable(targets.walls, frame);
  pushHoistWindow(targets.detail, frame);
  return look.eaves + rise;
}
