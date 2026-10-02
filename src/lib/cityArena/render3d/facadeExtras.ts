/**
 * What stands out of a detailed façade: balconies with railings on the long walls of flats, one
 * per module and storey above the ground, and canvas awnings over shopfronts, under the sign.
 * Both follow the wall's laid-out module grid, so a balcony sits under its two windows and an
 * awning over its display window.
 */
import type { Vector3Tuple } from "three";
import type { Point } from "../world/projection";
import {
  pushDetailBox,
  type BoxAxes,
  type DetailBuffers,
} from "./detailBuffers";
import { idUnit } from "./idHash";
import { FACADE_MODULE_M } from "./textures";
import { STOREY_M, type WallEdge } from "./wallQuads";

/** A balcony: width, depth, slab thickness, railing height, panel and top rail thickness, metres. */
const BALCONY = {
  width: 3.4,
  depth: 1.25,
  slab: 0.16,
  railing: 0.95,
  panel: 0.04,
  rail: 0.06,
};
/** Balconies keep this far from a wall's corners, metres. */
const BALCONY_CLEAR_M = 0.4;
/** Only walls at least this share of the building's longest wall get balconies. */
const BALCONY_WALL_SHARE = 0.6;
/** Balcony slabs, the two railings a block may have (dark steel, smoked glass) and the top rail. */
const BALCONY_SLAB = 0x8a8781;
const RAILINGS: readonly number[] = [0x2b2e33, 0x4f5b63];
const TOP_RAIL = 0x1f2124;
const RAILING_SALT = 0x69;
/** An awning: width, how far out it reaches, its top and front heights, valance, metres. */
const AWNING = {
  width: 4.4,
  reach: 1.2,
  top: 2.28,
  front: 1.98,
  thickness: 0.04,
  valance: 0.24,
};
/** How much darker the awning's valance is than its canvas. */
const VALANCE_SHADE = 0.72;
/** The middle of a module, in modules from its start. */
const MODULE_MIDDLE = 0.5;
/** Largest value of an 8-bit colour channel. */
const CHANNEL_MAX = 0xff;

/** A world point of a wall: `along` it from its start, `out` from its face, at a height, local. */
function wallPoint(
  edge: WallEdge,
  along: number,
  out: number,
  height: number,
  origin: Point,
): Vector3Tuple {
  return [
    edge.from[0] +
      edge.direction[0] * along +
      edge.outward[0] * out -
      origin[0],
    height,
    edge.from[1] +
      edge.direction[1] * along +
      edge.outward[1] * out -
      origin[1],
  ];
}

/** Upright axes along a wall: `u` along it, `v` up, `w` out of it. */
function wallAxes(edge: WallEdge): BoxAxes {
  return {
    u: [edge.direction[0], 0, edge.direction[1]],
    v: [0, 1, 0],
    w: [edge.outward[0], 0, edge.outward[1]],
  };
}

/**
 * The middles of the whole modules along a laid-out wall that leave `width` clear of its corners.
 *
 * @param edge - The wall, with its grid's start.
 * @param width - What must fit, metres.
 * @param clear - Room to keep from each corner, metres.
 * @returns Distances along the wall, metres.
 */
export function moduleMiddles(
  edge: WallEdge,
  width: number,
  clear: number,
): number[] {
  const middles: number[] = [];
  const first = Math.floor(edge.uStart);
  const last = Math.ceil(edge.uStart + edge.length / FACADE_MODULE_M);
  for (let moduleIndex = first; moduleIndex <= last; moduleIndex++) {
    const along = (moduleIndex + MODULE_MIDDLE - edge.uStart) * FACADE_MODULE_M;
    if (along - width / 2 >= clear && along + width / 2 <= edge.length - clear)
      middles.push(along);
  }
  return middles;
}

/** One balcony: its slab at floor height and a railing round its three open sides. */
function pushBalcony(
  detail: DetailBuffers,
  edge: WallEdge,
  along: number,
  floor: number,
  look: { railing: number; origin: Point },
): void {
  const axes = wallAxes(edge);
  const { width, depth, slab, railing, panel } = BALCONY;
  const at = (out: number, height: number, alongAt = along): Vector3Tuple =>
    wallPoint(edge, alongAt, out, height, look.origin);
  pushDetailBox(detail, {
    centre: at(depth / 2, floor + slab / 2),
    axes,
    size: [width, slab, depth],
    colour: BALCONY_SLAB,
  });
  const panelHeight = railing - BALCONY.rail;
  const panelMiddle = floor + slab + panelHeight / 2;
  const railMiddle = floor + slab + railing - BALCONY.rail / 2;
  pushDetailBox(detail, {
    centre: at(depth - panel / 2, panelMiddle),
    axes,
    size: [width, panelHeight, panel],
    colour: look.railing,
    openBottom: true,
  });
  pushDetailBox(detail, {
    centre: at(depth - BALCONY.rail / 2, railMiddle),
    axes,
    size: [width, BALCONY.rail, BALCONY.rail],
    colour: TOP_RAIL,
  });
  for (const side of [-1, 1]) {
    const sideAlong = along + side * (width / 2 - panel / 2);
    pushDetailBox(detail, {
      centre: at(depth / 2, panelMiddle, sideAlong),
      axes,
      size: [panel, panelHeight, depth - panel],
      colour: look.railing,
      openBottom: true,
    });
  }
}

/**
 * Balconies on the long walls of a block of flats: one per whole module and storey above the
 * ground floor, on every wall at least 60 % as long as the longest.
 *
 * @param detail - The cell's detail buffers.
 * @param edges - The building's walls as laid out.
 * @param levels - Its storeys.
 * @param look - The building's id (for its railings) and the cell origin.
 */
export function pushBalconies(
  detail: DetailBuffers,
  edges: readonly WallEdge[],
  levels: number,
  look: { id: number; origin: Point },
): void {
  const longest = Math.max(0, ...edges.map((edge) => edge.length));
  const railing =
    RAILINGS[Math.floor(idUnit(look.id, RAILING_SALT) * RAILINGS.length)];
  for (const edge of edges) {
    if (edge.length < longest * BALCONY_WALL_SHARE) continue;
    for (const along of moduleMiddles(edge, BALCONY.width, BALCONY_CLEAR_M)) {
      for (let storey = 1; storey < levels; storey++) {
        pushBalcony(detail, edge, along, storey * STOREY_M, {
          railing,
          origin: look.origin,
        });
      }
    }
  }
}

/** A colour's channels scaled. */
function darker(colour: number, factor: number): number {
  const channel = (shift: number): number =>
    Math.round(((colour >> shift) & CHANNEL_MAX) * factor);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/** One awning over a module: the sloping canvas and the valance hanging from its front. */
function pushAwning(
  detail: DetailBuffers,
  edge: WallEdge,
  along: number,
  look: { colour: number; origin: Point },
): void {
  const { reach, top, front, thickness, valance, width } = AWNING;
  const drop = top - front;
  const slope = Math.hypot(reach, drop);
  const out: Vector3Tuple = [edge.outward[0], 0, edge.outward[1]];
  const w: Vector3Tuple = [
    (out[0] * reach) / slope,
    -drop / slope,
    (out[2] * reach) / slope,
  ];
  const u: Vector3Tuple = [edge.direction[0], 0, edge.direction[1]];
  const v: Vector3Tuple = [
    u[1] * w[2] - u[2] * w[1],
    u[2] * w[0] - u[0] * w[2],
    u[0] * w[1] - u[1] * w[0],
  ];
  const flipped = v[1] < 0;
  const axes: BoxAxes = { u, v: flipped ? [-v[0], -v[1], -v[2]] : v, w };
  const centre = wallPoint(
    edge,
    along,
    reach / 2,
    (top + front) / 2,
    look.origin,
  );
  pushDetailBox(detail, {
    centre,
    axes,
    size: [width, thickness, slope],
    colour: look.colour,
  });
  pushDetailBox(detail, {
    centre: wallPoint(edge, along, reach, front - valance / 2, look.origin),
    axes: wallAxes(edge),
    size: [width, valance, thickness],
    colour: darker(look.colour, VALANCE_SHADE),
  });
}

/**
 * Awnings over every whole shopfront module of a building's shop walls.
 *
 * @param detail - The cell's detail buffers.
 * @param edges - The building's walls as laid out.
 * @param look - The canvas colour and the cell origin.
 */
export function pushAwnings(
  detail: DetailBuffers,
  edges: readonly WallEdge[],
  look: { colour: number; origin: Point },
): void {
  for (const edge of edges) {
    if (!edge.shop) continue;
    for (const along of moduleMiddles(edge, AWNING.width, 0))
      pushAwning(detail, edge, along, look);
  }
}
