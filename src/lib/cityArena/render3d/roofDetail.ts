/**
 * Tiled house roofs and what sits on them: the low hip over a near-rectangular footprint (with a
 * 0.25 m overhang, fascia boards and soffits on a detailed cell), chimneys on the ridge and dormers
 * on a long slope. Roof faces go into the tiled-roof buffers (the 2D roof art along the longest
 * edge); boards, chimneys and dormers into the cell's vertex-coloured detail.
 */
import type { Vector3Tuple } from "three";
import { longestEdgeAngle } from "../render/drawRoofs";
import type { Point } from "../world/projection";
import {
  axesAlong,
  pushDetailBox,
  pushDetailQuad,
  type DetailBuffers,
} from "./detailBuffers";
import { offsetPoint, orientedBox, type OrientedBox } from "./footprint";
import {
  pushTriangleFacing,
  pushVertex,
  vertexCount,
  type MeshBuffers,
  type UvMapping,
} from "./meshBuffers";
import { TEXTURE_REPEAT_M } from "./textures";

/** A footprint filling this share of its oriented rectangle gets a hip over that rectangle. */
export const HIP_MIN_FILL = 0.9;
/** A hip's pitch as rise per run: 30°, a low Dutch roof. */
const HIP_SLOPE = Math.tan(Math.PI / 6);
/** The highest a hip rises above the eaves, metres. */
const HIP_MAX_RISE_M = 2.5;
/** How far a detailed roof overhangs the walls, metres. */
export const ROOF_OVERHANG_M = 0.25;
/** Depth of the fascia board along the eaves, metres. */
const FASCIA_M = 0.2;
/** Closer than this, two roof corners are one point, metres. */
const SAME_POINT_M = 1e-6;
/** A chimney: its side, how far it rises over the ridge, and its cap. */
const CHIMNEY = { side: 0.55, above: 0.7, cap: 0.72, capHeight: 0.1 };
const CHIMNEY_BRICK = 0x5c2f23;
const CHIMNEY_CAP = 0x2e2e30;
/** A dormer: width, how far toward the eaves its front stands (share of the half width), metres. */
const DORMER = {
  width: 2.2,
  front: 0.62,
  belowRidge: 0.35,
  roof: 0.08,
  roofOverhang: 0.12,
};
/** The dormer's window: width and height, metres, and how far it stands proud of the front. */
const DORMER_WINDOW = { width: 1.3, height: 0.55, proud: 0.02 };
/** Dormer cladding, its roof and its dark glass. */
const DORMER_CLADDING = 0xd9d4c8;
const DORMER_ROOF = 0x2f3033;
const DORMER_GLASS = 0x1b2230;

/** A roof corner: a world point and its height. */
export type RoofCorner = { point: Point; height: number };

/**
 * Roof UVs as the 2D map lays its roof art: world metres / 8, turned to the longest edge and
 * anchored at the first corner, so the tile rows run along the building.
 *
 * @param ring - The footprint.
 * @returns The mapping.
 */
export function roofUv(ring: readonly Point[]): UvMapping {
  const angle = longestEdgeAngle([...ring]);
  const cos = Math.cos(angle) / TEXTURE_REPEAT_M;
  const sin = Math.sin(angle) / TEXTURE_REPEAT_M;
  const [ax, ay] = ring[0];
  return (x, y) => [
    (x - ax) * cos + (y - ay) * sin,
    (y - ay) * cos - (x - ax) * sin,
  ];
}

/** The unit normal of a triangle's plane, turned to point up. */
function upwardNormal(
  a: Vector3Tuple,
  b: Vector3Tuple,
  c: Vector3Tuple,
): Vector3Tuple {
  const [ux, uy, uz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const [vx, vy, vz] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cross: Vector3Tuple = [
    uy * vz - uz * vy,
    uz * vx - ux * vz,
    ux * vy - uy * vx,
  ];
  const sign = cross[1] < 0 ? -1 : 1;
  const length = Math.hypot(...cross) * sign;
  return [cross[0] / length, cross[1] / length, cross[2] / length];
}

/**
 * One planar roof face, its own vertices sharing its upward normal; fans from the first corner.
 *
 * @param buffers - The roof buffers.
 * @param corners - The face's corners in order.
 * @param origin - The world point that is the buffers' local zero.
 * @param uvOf - The UV at a world point.
 */
export function pushRoofFace(
  buffers: MeshBuffers,
  corners: readonly RoofCorner[],
  origin: Point,
  uvOf: UvMapping,
): void {
  const unique = corners.filter(
    (corner, index) =>
      index === 0 ||
      Math.hypot(
        corner.point[0] - corners[index - 1].point[0],
        corner.point[1] - corners[index - 1].point[1],
      ) > SAME_POINT_M,
  );
  const local = unique.map(({ point, height }): Vector3Tuple => [
    point[0] - origin[0],
    height,
    point[1] - origin[1],
  ]);
  const normal = upwardNormal(local[0], local[1], local[2]);
  const first = vertexCount(buffers);
  local.forEach((position, index) =>
    pushVertex(buffers, position, normal, uvOf(...unique[index].point)),
  );
  for (let index = 1; index + 1 < local.length; index++) {
    pushTriangleFacing(
      buffers,
      [first, first + index, first + index + 1],
      normal,
    );
  }
}

/** A hip's ridge height over given eaves, from the box's half width. */
function hipRidge(box: OrientedBox, eaves: number): number {
  return eaves + Math.min(HIP_MAX_RISE_M, (box.width / 2) * HIP_SLOPE);
}

/** A point of the box's frame: `along` the long side and `across` it from the centre. */
function boxPoint(box: OrientedBox, along: number, across: number): Point {
  return offsetPoint(box.centre, [box.long, along], [box.across, across]);
}

/**
 * A low hip over a near-rectangular footprint: two sloping sides up to a ridge along the long side
 * and two hipped ends, the ridge `min(2.5, half width × tan 30°)` above the eaves. With an
 * overhang the four slopes run on past the walls, dropping with their pitch.
 *
 * @param buffers - The tiled-roof buffers.
 * @param ring - The footprint.
 * @param eaves - Height of the walls under the roof, metres.
 * @param origin - The world point that is the buffers' local zero.
 * @param overhang - How far the roof reaches past the walls, metres (0 on a basic cell).
 * @returns False when the footprint is not rectangular enough for a hip.
 */
export function pushHip(
  buffers: MeshBuffers,
  ring: readonly Point[],
  eaves: number,
  origin: Point,
  overhang = 0,
): boolean {
  const box = orientedBox(ring);
  if (box.fill < HIP_MIN_FILL) return false;
  const half = box.width / 2;
  const ridge = hipRidge(box, eaves);
  const low = eaves - overhang * ((ridge - eaves) / half);
  const [length, width] = [box.length / 2 + overhang, half + overhang];
  const corner = (along: number, side: number): RoofCorner => ({
    point: boxPoint(box, along * length, side * width),
    height: low,
  });
  const ridgeEnd = (along: number): RoofCorner => ({
    point: boxPoint(box, along * (box.length / 2 - half), 0),
    height: ridge,
  });
  const [c00, c10, c11, c01] = [
    corner(-1, -1),
    corner(1, -1),
    corner(1, 1),
    corner(-1, 1),
  ];
  const [r0, r1] = [ridgeEnd(-1), ridgeEnd(1)];
  const uvOf = roofUv(ring);
  for (const face of [
    [c00, c10, r1, r0],
    [c11, c01, r0, r1],
    [c01, c00, r0],
    [c10, c11, r1],
  ]) {
    pushRoofFace(buffers, face, origin, uvOf);
  }
  return true;
}

/** A world point at a height, in the cell's local frame. */
function local(point: Point, height: number, origin: Point): Vector3Tuple {
  return [point[0] - origin[0], height, point[1] - origin[1]];
}

/** One side's eaves: the rectangle it runs along, where along, its wall line and outward side. */
type EaveRun = {
  box: OrientedBox;
  along: [number, number];
  wall: number;
  sign: 1 | -1;
};

/** How an eave's boards look: colour, overhang, the roof edge's height, and the cell origin. */
type EaveLook = {
  colour: number;
  overhang: number;
  edge: number;
  origin: Point;
};

/** One side's fascia board (facing out) and soffit (facing down, back to the wall). */
function pushEaveBoard(
  detail: DetailBuffers,
  run: EaveRun,
  look: EaveLook,
): void {
  const { box, along, wall, sign } = run;
  const outer = wall + sign * look.overhang;
  const [a, b] = [
    boxPoint(box, along[0], outer),
    boxPoint(box, along[1], outer),
  ];
  const [c, d] = [boxPoint(box, along[0], wall), boxPoint(box, along[1], wall)];
  const bottom = look.edge - FASCIA_M;
  const at = (point: Point, height: number): Vector3Tuple =>
    local(point, height, look.origin);
  const out: Vector3Tuple = [box.across[0] * sign, 0, box.across[1] * sign];
  pushDetailQuad(
    detail,
    [at(a, bottom), at(b, bottom), at(b, look.edge), at(a, look.edge)],
    out,
    look.colour,
  );
  pushDetailQuad(
    detail,
    [at(c, bottom), at(d, bottom), at(b, bottom), at(a, bottom)],
    [0, -1, 0],
    look.colour,
  );
}

/**
 * The fascia boards and soffits under an overhanging roof: along each overhanging side, a board
 * down from the roof's edge facing out, and the underside from the wall out to it facing down.
 *
 * @param detail - The cell's detail buffers.
 * @param box - The footprint's oriented rectangle.
 * @param sides - Which sides overhang: `long` (both eaves) and/or `ends` (both short ends).
 * @param look - Board colour, overhang, the roof edge's height and the cell origin.
 */
export function pushFascia(
  detail: DetailBuffers,
  box: OrientedBox,
  sides: { long: boolean; ends: boolean },
  look: EaveLook,
): void {
  const ends = sides.ends ? look.overhang : 0;
  const span: [number, number] = [
    -box.length / 2 - ends,
    box.length / 2 + ends,
  ];
  const signs: (1 | -1)[] = [-1, 1];
  if (sides.long) {
    for (const sign of signs)
      pushEaveBoard(
        detail,
        { box, along: span, wall: (sign * box.width) / 2, sign },
        look,
      );
  }
  if (!sides.ends) return;
  const turned: OrientedBox = {
    ...box,
    long: box.across,
    across: box.long,
    length: box.width,
    width: box.length,
  };
  const endSpan: [number, number] = [
    -box.width / 2 - look.overhang,
    box.width / 2 + look.overhang,
  ];
  for (const sign of signs)
    pushEaveBoard(
      detail,
      { box: turned, along: endSpan, wall: (sign * box.length) / 2, sign },
      look,
    );
}

/**
 * A brick chimney through a roof, capped, standing on the ridge line: from the eaves (hidden in
 * the roof) to {@link CHIMNEY}`.above` over the ridge.
 *
 * @param detail - The cell's detail buffers.
 * @param box - The footprint's rectangle.
 * @param heights - The eaves and the ridge, metres.
 * @param origin - The cell origin.
 * @param along - Where along the ridge from the footprint's centre, metres.
 */
export function pushChimney(
  detail: DetailBuffers,
  box: OrientedBox,
  heights: { eaves: number; ridge: number },
  origin: Point,
  along: number,
): void {
  const at = boxPoint(box, along, 0);
  const top = heights.ridge + CHIMNEY.above;
  const axes = axesAlong(box.long);
  const middle = (heights.eaves + top) / 2;
  pushDetailBox(detail, {
    centre: local(at, middle, origin),
    axes,
    size: [CHIMNEY.side, top - heights.eaves, CHIMNEY.side],
    colour: CHIMNEY_BRICK,
    openBottom: true,
  });
  pushDetailBox(detail, {
    centre: local(at, top + CHIMNEY.capHeight / 2, origin),
    axes,
    size: [CHIMNEY.cap, CHIMNEY.capHeight, CHIMNEY.cap],
    colour: CHIMNEY_CAP,
  });
}

/**
 * A flat-roofed dormer on one slope of a hip: its front stands part way to the eaves, its body
 * runs back into the roof (hidden below the tiles), a dark window in its front.
 *
 * @param detail - The cell's detail buffers.
 * @param box - The footprint's rectangle.
 * @param heights - The eaves and the ridge, metres.
 * @param origin - The cell origin.
 * @param side - Which slope: +1 or −1 across the ridge.
 */
export function pushDormer(
  detail: DetailBuffers,
  box: OrientedBox,
  heights: { eaves: number; ridge: number },
  origin: Point,
  side: 1 | -1,
): void {
  const front = (box.width / 2) * DORMER.front;
  const top = heights.ridge - DORMER.belowRidge;
  const axes = axesAlong(box.long);
  const centre = boxPoint(box, 0, (side * front) / 2);
  pushDetailBox(detail, {
    centre: local(centre, (heights.eaves + top) / 2, origin),
    axes,
    size: [DORMER.width, top - heights.eaves, front],
    colour: DORMER_CLADDING,
    openBottom: true,
  });
  const roofDepth = front + DORMER.roofOverhang;
  pushDetailBox(detail, {
    centre: local(
      boxPoint(box, 0, (side * roofDepth) / 2),
      top + DORMER.roof / 2,
      origin,
    ),
    axes,
    size: [DORMER.width + 2 * DORMER.roofOverhang, DORMER.roof, roofDepth],
    colour: DORMER_ROOF,
  });
  const slopeAtFront =
    heights.ridge - front * ((heights.ridge - heights.eaves) / (box.width / 2));
  const windowMiddle = (slopeAtFront + top) / 2;
  const glass = boxPoint(box, 0, side * (front + DORMER_WINDOW.proud));
  pushDetailBox(detail, {
    centre: local(glass, windowMiddle, origin),
    axes,
    size: [
      DORMER_WINDOW.width,
      Math.min(DORMER_WINDOW.height, top - slopeAtFront),
      DORMER_WINDOW.proud,
    ],
    colour: DORMER_GLASS,
  });
}

/**
 * The ridge height a hip over this footprint rises to.
 *
 * @param ring - The footprint.
 * @param eaves - The eaves height, metres.
 * @returns The ridge height, metres.
 */
export function hipRidgeHeight(ring: readonly Point[], eaves: number): number {
  return hipRidge(orientedBox(ring), eaves);
}
