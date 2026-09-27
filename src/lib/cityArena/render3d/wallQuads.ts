/**
 * Wall quads over a building's footprint, textured through the façade atlas. Every vertex carries
 * its atlas block (`facadeBlock`) and a UV in that block's units, so one geometry — one draw call —
 * holds every façade of a cell.
 *
 * Basic walls are the city's first walls exactly: one quad per edge from the ground to the eaves,
 * the module grid running on around the perimeter from a seeded offset. Detailed walls split off
 * the ground storey (its own block: doors, or a shopfront where the plan says so) and centre each
 * wall's windows on it, so no window straddles a corner and a narrow wall shows whole windows.
 */
import type { BufferGeometry, Vector3Tuple } from "three";
import type { DecodedBuilding } from "../world/decode";
import type { Point } from "../world/projection";
import {
  BLOCK_MODULES,
  FACADE_BLOCK_ATTRIBUTE,
  facadeBlockRect,
  type FacadeBlockKind,
} from "./facadeAtlas";
import { idHash } from "./idHash";
import {
  createMeshBuffers,
  float32Attribute,
  pushTriangleFacing,
  pushVertex,
  toGeometry,
  type MeshBuffers,
} from "./meshBuffers";
import { FACADE_MODULE_M } from "./textures";

/** Height of one storey, metres (a façade module is one storey tall). */
export const STOREY_M = 3.1;
/** Wall edges shorter than this are skipped, metres. */
export const MIN_EDGE_M = 0.05;
/** Modules across and storeys up on one upper-floor block; offsets shift the grid within it. */
const FACADE_GRID = 4;
/** Salts naming each seeded choice about a building's walls. */
const MODULE_SALT = 0x53;
const STOREY_SALT = 0x54;
const SHOP_ROW_SALT = 0x55;
/** Each module holds two windows, their centres a quarter and three quarters across. */
const WINDOW_SPACING_M = FACADE_MODULE_M / 2;
const FIRST_WINDOW_U = 0.25;
/** A window with its frame and sill is this wide, metres. */
const WINDOW_SPAN_M = 1.5;
/**
 * How far a window likes to keep from a wall's corner, metres; on a wall too short for that, a
 * window may reach the corner rather than leave a sliver of the next one showing.
 */
const CORNER_CLEAR_M = 0.3;
const MIN_CORNER_CLEAR_M = 0;

/** Mesh buffers with each vertex's atlas block. */
export type WallBuffers = MeshBuffers & { blocks: number[] };

/** One wall edge of a building, in world metres. */
export type WallEdge = {
  /** The edge's index in the ring (the edge from `ring[index]` to the next corner). */
  index: number;
  from: Point;
  to: Point;
  length: number;
  /** Unit direction from `from` to `to`. */
  direction: Point;
  /** Unit normal pointing out of the building. */
  outward: Point;
  /** Module count at `from`: a window centre falls at every `k + 0.25` and `k + 0.75`. */
  uStart: number;
  shop: boolean;
};

/**
 * Empty wall buffers.
 *
 * @returns Buffers for {@link pushBasicWalls} and {@link pushDetailedWalls}.
 */
export function createWallBuffers(): WallBuffers {
  return { ...createMeshBuffers(), blocks: [] };
}

/**
 * The buffers as a geometry: positions, normals, UVs, a white `color` for scorching and the
 * `facadeBlock` of every vertex.
 *
 * @param buffers - The filled buffers.
 * @returns A new indexed geometry.
 */
export function wallGeometry(buffers: WallBuffers): BufferGeometry {
  const geometry = toGeometry(buffers, true);
  geometry.setAttribute(
    FACADE_BLOCK_ATTRIBUTE,
    float32Attribute(buffers.blocks, 4),
  );
  return geometry;
}

/** Twice a ring's signed area: positive when it runs counter-clockwise in (x, y). */
export function signedTwiceArea(ring: readonly Point[]): number {
  let sum = 0;
  ring.forEach(([x1, y1], index) => {
    const [x2, y2] = ring[(index + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  });
  return sum;
}

/** A vertical quad along an edge between two heights, in a block, with UVs in module/storey units. */
type QuadSpec = {
  edge: WallEdge;
  bottom: number;
  top: number;
  kind: FacadeBlockKind;
  sheet: number;
  /** Module counts at the edge's two ends. */
  u: [number, number];
  /** Storey counts at the quad's bottom and top. */
  v: [number, number];
};

/**
 * Pushes one wall vertex with its atlas block.
 *
 * @param buffers - The wall buffers.
 * @param position - Local position, metres.
 * @param normal - Unit normal.
 * @param uv - UV in the block's units.
 * @param block - The block's {@link FacadeBlockRect}.
 * @returns The vertex's index.
 */
export function pushWallVertex(
  buffers: WallBuffers,
  position: Vector3Tuple,
  normal: Vector3Tuple,
  uv: [number, number],
  block: readonly number[],
): number {
  buffers.blocks.push(block[0], block[1], block[2], block[3]);
  return pushVertex(buffers, position, normal, uv);
}

/**
 * Pushes a vertical wall quad facing out of the building.
 *
 * @param buffers - The wall buffers.
 * @param quad - The edge, heights, block and UV ranges.
 * @param origin - The world point that is the buffers' local zero.
 */
function pushQuad(buffers: WallBuffers, quad: QuadSpec, origin: Point): void {
  const { edge } = quad;
  const [cols, rows] = BLOCK_MODULES[quad.kind];
  const block = facadeBlockRect(quad.kind, quad.sheet);
  const [px, pz] = [edge.from[0] - origin[0], edge.from[1] - origin[1]];
  const [qx, qz] = [edge.to[0] - origin[0], edge.to[1] - origin[1]];
  const normal: Vector3Tuple = [edge.outward[0], 0, edge.outward[1]];
  const [u0, u1] = [quad.u[0] / cols, quad.u[1] / cols];
  const [v0, v1] = [quad.v[0] / rows, quad.v[1] / rows];
  const base = pushWallVertex(
    buffers,
    [px, quad.bottom, pz],
    normal,
    [u0, v0],
    block,
  );
  pushWallVertex(buffers, [qx, quad.bottom, qz], normal, [u1, v0], block);
  pushWallVertex(buffers, [qx, quad.top, qz], normal, [u1, v1], block);
  pushWallVertex(buffers, [px, quad.top, pz], normal, [u0, v1], block);
  pushTriangleFacing(buffers, [base, base + 1, base + 2], normal);
  pushTriangleFacing(buffers, [base, base + 2, base + 3], normal);
}

/**
 * A building's wall edges, skipping the degenerate ones, each with its outward normal.
 *
 * @param building - The building.
 * @returns The edges in ring order, `uStart` 0 and no shops.
 */
export function wallEdges(building: DecodedBuilding): WallEdge[] {
  const { ring } = building;
  const sign = signedTwiceArea(ring) > 0 ? 1 : -1;
  return ring.flatMap((from, index): WallEdge[] => {
    const to = ring[(index + 1) % ring.length];
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (length < MIN_EDGE_M) return [];
    const direction: Point = [
      (to[0] - from[0]) / length,
      (to[1] - from[1]) / length,
    ];
    const outward: Point = [sign * direction[1], -sign * direction[0]];
    return [
      { index, from, to, length, direction, outward, uStart: 0, shop: false },
    ];
  });
}

/**
 * The first walls, unchanged in shape: one quad per edge from the ground to the eaves, modules
 * running on around the perimeter from a seeded whole-module offset, storeys up from a seeded
 * whole-storey offset, all in the sheet's upper-floor block.
 *
 * @param buffers - The wall buffers.
 * @param building - The building.
 * @param sheet - Its façade sheet.
 * @param height - Eaves height, metres.
 * @param origin - The world point that is the buffers' local zero.
 */
export function pushBasicWalls(
  buffers: WallBuffers,
  building: DecodedBuilding,
  sheet: number,
  height: number,
  origin: Point,
): void {
  const uOffset = idHash(building.structureId, MODULE_SALT) % FACADE_GRID;
  const vOffset = idHash(building.structureId, STOREY_SALT) % FACADE_GRID;
  let along = 0;
  for (const edge of wallEdges(building)) {
    const u: [number, number] = [
      uOffset + along / FACADE_MODULE_M,
      uOffset + (along + edge.length) / FACADE_MODULE_M,
    ];
    const v: [number, number] = [vOffset, vOffset + height / STOREY_M];
    pushQuad(
      buffers,
      { edge, bottom: 0, top: height, kind: "upper", sheet, u, v },
      origin,
    );
    along += edge.length;
  }
}

/** How many whole windows fit on a wall keeping `clear` from each corner. */
function windowsFitting(length: number, clear: number): number {
  const room = length - 2 * clear - WINDOW_SPAN_M;
  return room < 0 ? 0 : Math.floor(room / WINDOW_SPACING_M) + 1;
}

/**
 * Where a wall's module grid starts so its windows sit centred on it: as many whole windows as
 * fit clear of the corners, spaced evenly about the middle. The grid's next window out must stay
 * off the wall too; where it would show a sliver at a corner, one more window squeezes in closer
 * to the corners instead. A wall too short for any is centred on the plain gap between modules.
 *
 * @param length - The wall's length, metres.
 * @returns The module count at the wall's start (before any whole-module shift).
 */
export function centredStart(length: number): number {
  let windows = windowsFitting(length, CORNER_CLEAR_M);
  if (windows === 0) windows = windowsFitting(length, MIN_CORNER_CLEAR_M);
  if (windows === 0) return -length / 2 / FACADE_MODULE_M;
  let first = (length - (windows - 1) * WINDOW_SPACING_M) / 2;
  if (first - WINDOW_SPACING_M + WINDOW_SPAN_M / 2 > 0)
    first -= WINDOW_SPACING_M / 2;
  return FIRST_WINDOW_U - first / FACADE_MODULE_M;
}

/** The storey count at the ground storey's top for shopfront rows 0 or 1. */
function shopRow(building: DecodedBuilding): number {
  return idHash(building.structureId, SHOP_ROW_SALT) % BLOCK_MODULES.shop[1];
}

/**
 * Detailed walls: per edge a ground storey (the sheet's ground floor, or a shopfront on the edges
 * the plan names) and the floors above in the upper block, each wall's windows centred on it and
 * the grid shifted by a seeded whole module so neighbours differ.
 *
 * @param buffers - The wall buffers.
 * @param building - The building.
 * @param plan - Its sheet and shopfront edges.
 * @param height - Eaves height, metres.
 * @param origin - The world point that is the buffers' local zero.
 * @returns The edges as laid out, for the detail placed along them.
 */
export function pushDetailedWalls(
  buffers: WallBuffers,
  building: DecodedBuilding,
  plan: { sheet: number; shopEdges: ReadonlySet<number> },
  height: number,
  origin: Point,
): WallEdge[] {
  const shift = idHash(building.structureId, MODULE_SALT) % FACADE_GRID;
  const storeyShift = idHash(building.structureId, STOREY_SALT) % FACADE_GRID;
  const row = shopRow(building);
  const { sheet } = plan;
  return wallEdges(building).map((edge) => {
    const shop = plan.shopEdges.has(edge.index);
    const start =
      (shop
        ? -(edge.length % FACADE_MODULE_M) / 2 / FACADE_MODULE_M
        : centredStart(edge.length)) + shift;
    const laid = { ...edge, uStart: start, shop };
    const u: [number, number] = [start, start + edge.length / FACADE_MODULE_M];
    const ground = shop
      ? { kind: "shop" as const, v: [row, row + 1] as [number, number] }
      : { kind: "ground" as const, v: [0, 1] as [number, number] };
    pushQuad(
      buffers,
      { edge: laid, bottom: 0, top: STOREY_M, sheet, u, ...ground },
      origin,
    );
    const v: [number, number] = [
      storeyShift + 1,
      storeyShift + height / STOREY_M,
    ];
    pushQuad(
      buffers,
      { edge: laid, bottom: STOREY_M, top: height, kind: "upper", sheet, u, v },
      origin,
    );
    return laid;
  });
}
