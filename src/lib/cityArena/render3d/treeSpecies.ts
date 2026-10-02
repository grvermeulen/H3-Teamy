/**
 * The three tree species of a detailed cell and their shapes: a round broadleaf (lime, oak) whose
 * crown is a main clump with lobes round it, a tall narrow poplar, and a conifer of stacked cones.
 * Each shape is a unit template the tree layer instances: crowns are white with a darker underside
 * baked into their vertex colours, and take their green from each tree's instance colour.
 */
import {
  BufferGeometry,
  ConeGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { idUnit } from "./idHash";

/** The tree species. */
export type TreeSpecies = "broadleaf" | "poplar" | "conifer";

/** Every species, in a stable order. */
export const TREE_SPECIES: readonly TreeSpecies[] = [
  "broadleaf",
  "poplar",
  "conifer",
];

/** How often each species grows, in {@link TREE_SPECIES} order. */
const SPECIES_SHARES: readonly number[] = [0.62, 0.2, 0.18];
/** Salt of the species choice. */
const SPECIES_SALT = 0x73;
/** Subdivisions of a broadleaf's main clump and of its lobes. */
const MAIN_DETAIL = 1;
const LOBE_DETAIL = 0;
/** A broadleaf's lobes: how many, their radius and how far out and up they sit (unit crown). */
const LOBES = {
  count: 4,
  radius: 0.62,
  out: 0.52,
  up: 0.12,
  topUp: 0.5,
  topRadius: 0.55,
};
/** A poplar's crown: its width against its height, and the smaller top clump. */
const POPLAR = { width: 0.42, topRadius: 0.62, topUp: 0.62 };
/** A conifer's stacked cones: each one's radius and height and where its middle sits (unit crown). */
const CONIFER_CONES: readonly [number, number, number][] = [
  [1, 1.1, 0.55],
  [0.75, 0.95, 1.2],
  [0.48, 0.8, 1.8],
];
/** Sides of a conifer cone. */
const CONE_SIDES = 8;
/** How dark a crown's underside is against its top, as the vertex colour's share. */
const UNDERSIDE_SHADE = 0.62;

/**
 * The species a tree grows as, seeded by its id: mostly broadleaf, some poplar and conifer.
 *
 * @param id - The tree's stable id.
 * @returns Its species.
 */
export function speciesOf(id: number): TreeSpecies {
  const roll = idUnit(id, SPECIES_SALT);
  let sum = 0;
  for (let index = 0; index < TREE_SPECIES.length; index++) {
    sum += SPECIES_SHARES[index];
    if (roll < sum) return TREE_SPECIES[index];
  }
  return TREE_SPECIES[TREE_SPECIES.length - 1];
}

/** Paints a geometry white on top fading to {@link UNDERSIDE_SHADE} at its bottom. */
function shadeUnderside(geometry: BufferGeometry): BufferGeometry {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const span = box.max.y - box.min.y || 1;
  const position = geometry.getAttribute("position");
  const colours = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index++) {
    const up = (position.getY(index) - box.min.y) / span;
    colours.fill(
      UNDERSIDE_SHADE + (1 - UNDERSIDE_SHADE) * up,
      index * 3,
      index * 3 + 3,
    );
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  return geometry;
}

/** Merges parts (each with position and normal only) into one geometry and frees them. */
function mergeParts(parts: BufferGeometry[]): BufferGeometry {
  for (const part of parts) part.deleteAttribute("uv");
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return merged;
}

/** A broadleaf crown of radius about 1: a main clump, lobes round it and one on top. */
function broadleafCrown(): BufferGeometry {
  const parts: BufferGeometry[] = [new IcosahedronGeometry(1, MAIN_DETAIL)];
  for (let lobe = 0; lobe < LOBES.count; lobe++) {
    const angle = (lobe / LOBES.count) * Math.PI * 2;
    parts.push(
      new IcosahedronGeometry(LOBES.radius, LOBE_DETAIL).translate(
        Math.cos(angle) * LOBES.out,
        LOBES.up * (lobe % 2 === 0 ? 1 : -1),
        Math.sin(angle) * LOBES.out,
      ),
    );
  }
  parts.push(
    new IcosahedronGeometry(LOBES.topRadius, LOBE_DETAIL).translate(
      0,
      LOBES.topUp,
      0,
    ),
  );
  return shadeUnderside(mergeParts(parts));
}

/** A poplar crown about 1 tall (radius units) and narrow: a stretched clump and a top. */
function poplarCrown(): BufferGeometry {
  const body = new IcosahedronGeometry(1, MAIN_DETAIL).scale(
    POPLAR.width,
    1,
    POPLAR.width,
  );
  const top = new IcosahedronGeometry(
    POPLAR.width * POPLAR.topRadius,
    LOBE_DETAIL,
  ).translate(0, POPLAR.topUp, 0);
  return shadeUnderside(mergeParts([body, top]));
}

/** A conifer crown: three cones stacked, narrowing upward, its foot at 0. */
function coniferCrown(): BufferGeometry {
  const cones = CONIFER_CONES.map(([radius, height, middle]) =>
    new ConeGeometry(radius, height, CONE_SIDES).translate(0, middle, 0),
  );
  return shadeUnderside(mergeParts(cones));
}

/**
 * The unit crown of each species, for instancing: broadleaf and poplar centred on their middle,
 * the conifer standing on its foot.
 *
 * @returns A new geometry per species; free them with the layer.
 */
export function crownGeometries(): Record<TreeSpecies, BufferGeometry> {
  return {
    broadleaf: broadleafCrown(),
    poplar: poplarCrown(),
    conifer: coniferCrown(),
  };
}
