/**
 * The car pack's body work: which role each triangle of a Kit body plays (paint, detail, lamps, the
 * police light bar's lenses, the number-plate faces), and baking the atlas into vertex colours for
 * each role's mesh.
 */

import type { CarRole } from "../../src/lib/cityArena/carManifest";
import {
  SWATCH,
  linearOf,
  luminanceOf,
  sampleSwatch,
  swatchMiddle,
  type Atlas,
  type SwatchKey,
} from "./carAtlas";
import {
  CORNERS,
  UV,
  XYZ,
  centroidOf,
  isDegenerate,
  normalOf,
  swatchOfTriangle,
  triangleCount,
  type Bounds,
  type Coloured,
  type Soup,
} from "./carGeometry";

/** How a car's body is split and coloured. */
export type BodyRules = {
  /** The swatches of the body paint, tinted per car in the view. */
  paint: readonly SwatchKey[];
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
  const painted = rules.paint.includes(facts.swatch);
  return { role: painted ? "paint" : "detail", plate };
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
