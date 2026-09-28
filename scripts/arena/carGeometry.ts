/**
 * The car pack's geometry work, on plain triangle lists (no gltf-transform): turning a Kit model
 * into the game's frame, splitting its body's triangles into roles (paint, detail, lamps, the
 * police light bar's lenses), baking the atlas into vertex colours, and measuring what the view
 * needs — wheels, lamps, number plates and the flat flank a livery can go on.
 *
 * The Kit's frame is x to the left, y up, z forward; the game's is x forward, y up, z to the
 * right, so a point `(x, y, z)` becomes `(z, y, −x)` — a turn about y, which keeps the winding.
 */

import type { CarRole } from "../../src/lib/cityArena/carManifest";
import {
  SWATCH,
  linearOf,
  luminanceOf,
  sampleSwatch,
  swatchAt,
  swatchCentre,
  swatchMiddle,
  type Atlas,
  type SwatchKey,
} from "./carAtlas";

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
const XYZ = 3;
const UV = 2;
const CORNERS = 3;
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

/** How a car's body is split and coloured. */
export type BodyRules = {
  /** The swatch of the body paint, tinted per car in the view. */
  paint: SwatchKey;
  /** Swatches drawn in another colour, sRGB hex, their gradient kept. */
  recolour: Partial<Record<SwatchKey, number>>;
  /** The red and blue lamps on the roof are the light bar's two lenses. */
  lightBar: boolean;
};

/** Lamps are only lamps within this share of the length from their end. */
const LAMP_REACH_SHARE = 0.3;
/** A red or blue lamp above this share of the height is a light-bar lens. */
const LENS_HEIGHT_SHARE = 0.85;
/** A light-grey face this close to an end (in the file's units), facing it, is a number plate. */
const PLATE_REACH = 0.06;
/** A face whose normal is at least this much along an axis faces along it. */
const FACING_COSINE = 0.7;

/** Where a body triangle is: its middle, its normal and its swatch. */
type TriangleFacts = {
  centre: [number, number, number];
  normal: [number, number, number];
  swatch: SwatchKey;
};

/** The facts about one triangle of a soup. */
function factsOf(soup: Soup, triangle: number): TriangleFacts {
  return {
    centre: centroidOf(soup.positions, triangle),
    normal: normalOf(soup.positions, triangle),
    swatch: swatchOfTriangle(soup.uvs, triangle),
  };
}

/** The end a face is a number plate on, or null. */
function plateEndOf(
  facts: TriangleFacts,
  bounds: Bounds,
): "front" | "rear" | null {
  if (facts.swatch !== SWATCH.light) return null;
  const [x] = facts.centre;
  if (facts.normal[0] > FACING_COSINE && bounds.max[0] - x < PLATE_REACH)
    return "front";
  if (facts.normal[0] < -FACING_COSINE && x - bounds.min[0] < PLATE_REACH)
    return "rear";
  return null;
}

/** The light-bar lens a triangle is, or null. */
function lensOf(
  facts: TriangleFacts,
  rules: BodyRules,
  bounds: Bounds,
): CarRole | null {
  if (!rules.lightBar) return null;
  if (facts.swatch !== SWATCH.redLamp && facts.swatch !== SWATCH.blueLamp)
    return null;
  if (facts.centre[1] < bounds.max[1] * LENS_HEIGHT_SHARE) return null;
  return facts.centre[2] < 0 ? "lens-left" : "lens-right";
}

/** The lamp a triangle is, or null. */
function lampOf(facts: TriangleFacts, bounds: Bounds): CarRole | null {
  const reach = (bounds.max[0] - bounds.min[0]) * LAMP_REACH_SHARE;
  const [x] = facts.centre;
  if (facts.swatch === SWATCH.headLamp && x > bounds.max[0] - reach)
    return "head";
  if (facts.swatch === SWATCH.redLamp && x < bounds.min[0] + reach)
    return "tail";
  return null;
}

/** A body triangle's role and, for a number plate, its end. */
export type TriangleRole = { role: CarRole; plate: "front" | "rear" | null };

/**
 * What one body triangle is: a lens, a lamp, a number plate (drawn as detail), the paint, or
 * detail — in that order, so the police car's white paint never swallows its plates.
 *
 * @param soup - The body's triangles, in the game's frame.
 * @param triangle - Its index.
 * @param rules - The car's paint and light bar.
 * @param bounds - The whole model's bounds.
 * @returns Its role.
 */
export function roleOf(
  soup: Soup,
  triangle: number,
  rules: BodyRules,
  bounds: Bounds,
): TriangleRole {
  const facts = factsOf(soup, triangle);
  const special = lensOf(facts, rules, bounds) ?? lampOf(facts, bounds);
  if (special) return { role: special, plate: null };
  const plate = plateEndOf(facts, bounds);
  if (plate) return { role: "detail", plate };
  return { role: facts.swatch === rules.paint ? "paint" : "detail", plate };
}

/** The colour a number plate's own face is drawn in: the view mounts a Dutch plate over it. */
export const PLATE_RECESS = 0x26282c;
/** White: the paint's shading is stored as a grey the view multiplies its colour by. */
const WHITE = 0xffffff;

/** The linear colour of a vertex: its atlas colour, or `target` shaded as the swatch is. */
function vertexColour(
  atlas: Atlas,
  swatch: SwatchKey,
  uv: readonly [number, number],
  target: number | null,
): [number, number, number] {
  const sample = linearOf(sampleSwatch(atlas, swatch, uv[0], uv[1]));
  if (target === null) return sample;
  const middle = luminanceOf(linearOf(swatchMiddle(atlas, swatch)));
  const shade = middle > 0 ? luminanceOf(sample) / middle : 1;
  return linearOf(target).map((channel) => channel * shade) as [
    number,
    number,
    number,
  ];
}

/** What colour a triangle's vertices are baked in: their own, or a target shaded like the swatch. */
function targetOf(
  role: TriangleRole,
  swatch: SwatchKey,
  rules: BodyRules,
): number | null {
  if (role.role === "paint") return WHITE;
  if (role.plate) return PLATE_RECESS;
  if (role.role !== "detail") return null;
  return rules.recolour[swatch] ?? null;
}

/**
 * Copies one triangle into a coloured list, baking its vertex colours.
 *
 * @param into - The list to add to.
 * @param soup - The source triangles.
 * @param triangle - Which one.
 * @param colour - The atlas and what to paint it: its own colours (`null`) or a target, shaded.
 */
export function bakeTriangle(
  into: Coloured,
  soup: Soup,
  triangle: number,
  colour: { atlas: Atlas; target: number | null },
): void {
  const swatch = swatchOfTriangle(soup.uvs, triangle);
  for (let corner = 0; corner < CORNERS; corner += 1) {
    const vertex = triangle * CORNERS + corner;
    into.positions.push(
      ...soup.positions.slice(vertex * XYZ, vertex * XYZ + XYZ),
    );
    const uv: [number, number] = [
      soup.uvs[vertex * UV],
      soup.uvs[vertex * UV + 1],
    ];
    into.colours.push(...vertexColour(colour.atlas, swatch, uv, colour.target));
  }
}

/** An empty coloured list. */
export function emptyColoured(): Coloured {
  return { positions: [], colours: [] };
}

/** A body split into roles, and each plate's triangles. */
export type SplitBody = {
  roles: Record<CarRole, Coloured>;
  plates: { front: Coloured; rear: Coloured };
};

/**
 * Splits a body's triangles into roles and bakes their colours.
 *
 * @param soup - The body, in the game's frame and recentred.
 * @param rules - The car's paint, recolours and light bar.
 * @param bounds - The whole model's bounds (wheels included).
 * @param atlas - The decoded atlas.
 * @returns The coloured triangles per role, and the plates' faces.
 */
export function splitBody(
  soup: Soup,
  rules: BodyRules,
  bounds: Bounds,
  atlas: Atlas,
): SplitBody {
  const split: SplitBody = {
    roles: {
      paint: emptyColoured(),
      detail: emptyColoured(),
      head: emptyColoured(),
      tail: emptyColoured(),
      "lens-left": emptyColoured(),
      "lens-right": emptyColoured(),
    },
    plates: { front: emptyColoured(), rear: emptyColoured() },
  };
  for (
    let triangle = 0;
    triangle < triangleCount(soup.positions);
    triangle += 1
  ) {
    if (isDegenerate(soup.positions, triangle)) continue;
    const role = roleOf(soup, triangle, rules, bounds);
    const swatch = swatchOfTriangle(soup.uvs, triangle);
    const target = targetOf(role, swatch, rules);
    bakeTriangle(split.roles[role.role], soup, triangle, { atlas, target });
    if (role.plate)
      bakeTriangle(split.plates[role.plate], soup, triangle, { atlas, target });
  }
  return split;
}
