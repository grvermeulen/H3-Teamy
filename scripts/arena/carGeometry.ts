/**
 * The car pack's geometry work, on plain triangle lists (no gltf-transform): turning a Kit model
 * into the game's frame, boxes, bounds, and each triangle's centre, normal, area and atlas swatch.
 * Splitting a body into its roles and baking its colours is `carBody.ts`.
 *
 * The Kit's frame is x to the left, y up, z forward; the game's is x forward, y up, z to the
 * right, so a point `(x, y, z)` becomes `(z, y, −x)` — a turn about y, which keeps the winding.
 */

import { swatchAt, swatchCentre, type SwatchKey } from "./carAtlas";

/** Triangles, three vertices each and unindexed: positions (xyz) and atlas UVs (uv). */
export type Soup = { positions: number[]; uvs: number[] };

/** Triangles with a linear RGB colour per vertex. */
export type Coloured = { positions: number[]; colours: number[] };

/** An axis-aligned box. */
export type Bounds = {
  min: [number, number, number];
  max: [number, number, number];
};

/** Floats per vertex position, per UV, and vertices per triangle. */
export const XYZ = 3;
export const UV = 2;
export const CORNERS = 3;
/** Twice the area below which a triangle counts as a line (in the file's units squared). */
const DEGENERATE_CROSS = 1e-9;

/**
 * Turns Kit-frame triangles into the game's frame: `(x, y, z)` → `(z, y, −x)`.
 *
 * @param soup - Triangles in the Kit's frame.
 * @returns The same triangles, x forward and z to the right.
 */
export function toCarFrame(soup: Soup): Soup {
  const positions: number[] = [];
  for (let index = 0; index < soup.positions.length; index += XYZ)
    positions.push(
      soup.positions[index + 2],
      soup.positions[index + 1],
      -soup.positions[index],
    );
  return { positions, uvs: [...soup.uvs] };
}

/**
 * Several triangle lists as one.
 *
 * @param soups - The lists.
 * @returns Their triangles, in order.
 */
export function concatSoups(soups: readonly Soup[]): Soup {
  return {
    positions: soups.flatMap((soup) => soup.positions),
    uvs: soups.flatMap((soup) => soup.uvs),
  };
}

/** A box face's corners in its own (u, v) axes, counter-clockwise seen from outside. */
const FACE_CORNERS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];
/** A quad's two triangles, as corner indices. */
const QUAD_TRIANGLES = [0, 1, 2, 0, 2, 3] as const;

/**
 * A box of twelve triangles facing out, every vertex pointing at one swatch: a lamp the pack adds
 * where a model has none.
 *
 * @param at - The box's middle.
 * @param size - Its size along each axis.
 * @param swatch - The swatch it is painted from.
 * @returns The triangles.
 */
export function boxSoup(
  at: readonly [number, number, number],
  size: readonly [number, number, number],
  swatch: SwatchKey,
): Soup {
  const soup: Soup = { positions: [], uvs: [] };
  const uv = swatchCentre(swatch);
  for (let axis = 0; axis < XYZ; axis += 1)
    for (const sign of [-1, 1]) {
      const [uAxis, vAxis] = [(axis + 1) % XYZ, (axis + 2) % XYZ];
      const order = sign > 0 ? FACE_CORNERS : [...FACE_CORNERS].reverse();
      const corners = order.map(([u, v]) => {
        const point = [...at];
        point[axis] += (sign * size[axis]) / 2;
        point[uAxis] += (u * size[uAxis]) / 2;
        point[vAxis] += (v * size[vAxis]) / 2;
        return point;
      });
      for (const corner of QUAD_TRIANGLES) {
        soup.positions.push(...corners[corner]);
        soup.uvs.push(...uv);
      }
    }
  return soup;
}

/**
 * The box round some positions.
 *
 * @param positions - xyz triples.
 * @returns Their bounds.
 */
export function boundsOf(positions: readonly number[]): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += XYZ)
    for (let axis = 0; axis < XYZ; axis += 1) {
      min[axis] = Math.min(min[axis], positions[index + axis]);
      max[axis] = Math.max(max[axis], positions[index + axis]);
    }
  return { min, max };
}

/**
 * The shift that puts a model's footprint centre at the origin and its lowest point on the
 * ground.
 *
 * @param bounds - The whole model's bounds.
 * @returns What to add to every position.
 */
export function recentring(bounds: Bounds): [number, number, number] {
  return [
    -(bounds.min[0] + bounds.max[0]) / 2,
    -bounds.min[1],
    -(bounds.min[2] + bounds.max[2]) / 2,
  ];
}

/**
 * Moves every position by `shift`, in place.
 *
 * @param positions - xyz triples.
 * @param shift - What to add.
 */
export function shiftPositions(
  positions: number[],
  shift: readonly number[],
): void {
  for (let index = 0; index < positions.length; index += XYZ)
    for (let axis = 0; axis < XYZ; axis += 1)
      positions[index + axis] += shift[axis];
}

/**
 * How many triangles a list holds.
 *
 * @param positions - xyz triples, three per triangle.
 * @returns The count.
 */
export function triangleCount(positions: readonly number[]): number {
  return positions.length / (XYZ * CORNERS);
}

/**
 * One triangle's nine coordinates.
 *
 * @param positions - xyz triples, three per triangle.
 * @param triangle - Its index.
 * @returns Its three corners' xyz, back to back.
 */
export function trianglePositions(
  positions: readonly number[],
  triangle: number,
): number[] {
  const base = triangle * XYZ * CORNERS;
  return positions.slice(base, base + XYZ * CORNERS);
}

/**
 * The middle of one triangle.
 *
 * @param positions - xyz triples, three per triangle.
 * @param triangle - Its index.
 * @returns Its centroid.
 */
export function centroidOf(
  positions: readonly number[],
  triangle: number,
): [number, number, number] {
  const base = triangle * XYZ * CORNERS;
  const centre: [number, number, number] = [0, 0, 0];
  for (let corner = 0; corner < CORNERS; corner += 1)
    for (let axis = 0; axis < XYZ; axis += 1)
      centre[axis] += positions[base + corner * XYZ + axis] / CORNERS;
  return centre;
}

/**
 * One triangle's unit normal (by its winding), or zero for a degenerate one.
 *
 * @param positions - xyz triples, three per triangle.
 * @param triangle - Its index.
 * @returns The normal.
 */
export function normalOf(
  positions: readonly number[],
  triangle: number,
): [number, number, number] {
  const base = triangle * XYZ * CORNERS;
  const edge = (corner: number, axis: number): number =>
    positions[base + corner * XYZ + axis] - positions[base + axis];
  const cross: [number, number, number] = [
    edge(1, 1) * edge(2, 2) - edge(1, 2) * edge(2, 1),
    edge(1, 2) * edge(2, 0) - edge(1, 0) * edge(2, 2),
    edge(1, 0) * edge(2, 1) - edge(1, 1) * edge(2, 0),
  ];
  const length = Math.hypot(...cross);
  return length < DEGENERATE_CROSS
    ? [0, 0, 0]
    : [cross[0] / length, cross[1] / length, cross[2] / length];
}

/**
 * One triangle's area.
 *
 * @param positions - xyz triples, three per triangle.
 * @param triangle - Its index.
 * @returns The area, in the file's units squared.
 */
export function areaOf(positions: readonly number[], triangle: number): number {
  const [a, b, c] = [0, 1, 2].map((corner) =>
    positions.slice(
      (triangle * CORNERS + corner) * XYZ,
      (triangle * CORNERS + corner + 1) * XYZ,
    ),
  );
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return (
    Math.hypot(
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ) / 2
  );
}

/**
 * Whether a triangle has no area (the Kit models carry a few): it is dropped.
 *
 * @param positions - xyz triples, three per triangle.
 * @param triangle - Its index.
 * @returns `true` for a triangle whose corners are in a line.
 */
export function isDegenerate(
  positions: readonly number[],
  triangle: number,
): boolean {
  return normalOf(positions, triangle).every((component) => component === 0);
}

/**
 * The swatch one triangle is painted from: the one its UVs' middle falls in.
 *
 * @param uvs - uv pairs, three per triangle.
 * @param triangle - Its index.
 * @returns The swatch.
 */
export function swatchOfTriangle(
  uvs: readonly number[],
  triangle: number,
): SwatchKey {
  const base = triangle * UV * CORNERS;
  let u = 0;
  let v = 0;
  for (let corner = 0; corner < CORNERS; corner += 1) {
    u += uvs[base + corner * UV] / CORNERS;
    v += uvs[base + corner * UV + 1] / CORNERS;
  }
  return swatchAt(u, v);
}
