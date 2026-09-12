import type { TreeSize } from "../world/mapTypes";
import type { Point } from "../world/projection";
import { boundsOf, pointInPolygon } from "./geometry";
import type { OsmTags } from "./osmTypes";

/** Ground per tree in a forest or wood, m². */
export const FOREST_TREE_AREA_M2 = 80;
/** Ground per tree in scrub, m²; scrub grows small trees only. */
export const SCRUB_TREE_AREA_M2 = 160;
/** Ground per tree in a park, m². */
export const PARK_TREE_AREA_M2 = 400;
/** Spacing of the trees along a mapped tree row, metres. */
export const TREE_ROW_SPACING_M = 8;
/** Two trees never stand closer than this, metres; the thinning pass keeps the earlier one. */
export const MIN_TREE_GAP_M = 3;
/** Share of large trees where both sizes grow. */
export const LARGE_TREE_SHARE = 0.5;
/** A row's last tree is planted when it lands this close past the end: projection round-off. */
const ROW_END_TOLERANCE_M = 1e-6;
/**
 * A scattered tree keeps this share of its grid cell from the cell's edges, so trees in
 * neighbouring cells stay {@link MIN_TREE_GAP_M} apart at the forest's cell size.
 */
const JITTER_MARGIN = 0.2;

/** How a ground polygon grows trees: metres of ground per tree, and the share of large ones. */
export type TreeBed = { areaPerTreeM2: number; largeShare: number };

/** A tree in metres; `mapped` says OpenStreetMap has it, which outranks a scattered one at the cap. */
export type ProjectedTree = { point: Point; size: TreeSize; mapped: boolean };

/**
 * The bed a ground polygon's tags call for, or null for ground that grows no trees: fields,
 * meadows, lawns and pitches.
 *
 * @param tags - The polygon's OSM tags.
 * @returns The bed, or null.
 */
export function treeBedFor(tags: OsmTags): TreeBed | null {
  if (tags.landuse === "forest" || tags.natural === "wood")
    return { areaPerTreeM2: FOREST_TREE_AREA_M2, largeShare: LARGE_TREE_SHARE };
  if (tags.natural === "scrub")
    return { areaPerTreeM2: SCRUB_TREE_AREA_M2, largeShare: 0 };
  if (tags.leisure === "park")
    return { areaPerTreeM2: PARK_TREE_AREA_M2, largeShare: LARGE_TREE_SHARE };
  return null;
}

/**
 * A hash of two integers and a salt to [0, 1), stable across runs and machines: what makes the
 * scatter deterministic, and the same for the same ground however it is cut into polygons.
 *
 * @param x - An integer.
 * @param y - An integer.
 * @param salt - Which of a cell's numbers is wanted.
 * @returns A number in [0, 1).
 */
export function cellNoise(x: number, y: number, salt: number): number {
  let hash =
    Math.imul(x, 0x9e3779b1) ^
    Math.imul(y, 0x85ebca77) ^
    Math.imul(salt + 1, 0xc2b2ae3d);
  hash = Math.imul(hash ^ (hash >>> 15), 0x2c1b3c6d);
  hash = Math.imul(hash ^ (hash >>> 12), 0x297a2d39);
  return ((hash ^ (hash >>> 15)) >>> 0) / 4294967296;
}

/** The size a tree at `point` gets, from the same noise, so a mapped tree's size never changes. */
export function treeSizeAt(point: Point, largeShare: number): TreeSize {
  return cellNoise(Math.round(point[0]), Math.round(point[1]), 3) < largeShare
    ? 1
    : 0;
}

/**
 * Scatters trees over a polygon: one per grid cell of the bed's area, jittered by a hash of the
 * cell. The grid is anchored to the world, so two polygons over the same ground put a tree in
 * the same spot (the thinning pass keeps one) and a polygon cut at a tile edge scatters exactly
 * as the whole would have.
 *
 * @param ring - The polygon, metres.
 * @param bed - How densely it grows.
 * @returns The trees, unmapped.
 */
export function scatterTrees(ring: Point[], bed: TreeBed): ProjectedTree[] {
  const step = Math.sqrt(bed.areaPerTreeM2);
  const bounds = boundsOf(ring);
  const trees: ProjectedTree[] = [];
  const span = 1 - 2 * JITTER_MARGIN;
  for (
    let cellY = Math.floor(bounds.minY / step);
    cellY * step <= bounds.maxY;
    cellY++
  ) {
    for (
      let cellX = Math.floor(bounds.minX / step);
      cellX * step <= bounds.maxX;
      cellX++
    ) {
      const point: Point = [
        (cellX + JITTER_MARGIN + cellNoise(cellX, cellY, 1) * span) * step,
        (cellY + JITTER_MARGIN + cellNoise(cellX, cellY, 2) * span) * step,
      ];
      if (!pointInPolygon(point, ring)) continue;
      trees.push({
        point,
        size: cellNoise(cellX, cellY, 3) < bed.largeShare ? 1 : 0,
        mapped: false,
      });
    }
  }
  return trees;
}

/**
 * Trees along a polyline every `spacing` metres, both ends included: a 40 m row grows six.
 *
 * @param points - The row's line, metres.
 * @param spacing - Metres between trees.
 * @returns The tree positions.
 */
export function treeRow(
  points: Point[],
  spacing = TREE_ROW_SPACING_M,
): Point[] {
  if (points.length === 0) return [];
  const trees: Point[] = [points[0]];
  let sinceLast = 0;
  for (let index = 1; index < points.length; index++) {
    const [ax, ay] = points[index - 1];
    const [bx, by] = points[index];
    const length = Math.hypot(bx - ax, by - ay);
    let along = spacing - sinceLast;
    while (along <= length + ROW_END_TOLERANCE_M) {
      trees.push([
        ax + ((bx - ax) * along) / length,
        ay + ((by - ay) * along) / length,
      ]);
      along += spacing;
    }
    sinceLast = length - (along - spacing);
  }
  return trees;
}

/**
 * Drops every tree within `minGap` of an earlier one, so the order of the list is its priority:
 * mapped trees before scattered ones, and the scattered ones nearest a zone before the rest.
 *
 * @param trees - The trees, in priority order.
 * @param minGap - The gap to keep, metres.
 * @returns The trees that stand.
 */
export function thinTrees(
  trees: ProjectedTree[],
  minGap = MIN_TREE_GAP_M,
): ProjectedTree[] {
  const kept: ProjectedTree[] = [];
  const cells = new Map<string, Point[]>();
  const keyOf = (x: number, y: number): string =>
    `${Math.floor(x / minGap)}:${Math.floor(y / minGap)}`;
  const crowded = (x: number, y: number): boolean => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        for (const other of cells.get(
          keyOf(x + dx * minGap, y + dy * minGap),
        ) ?? [])
          if (Math.hypot(other[0] - x, other[1] - y) < minGap) return true;
    return false;
  };
  for (const tree of trees) {
    const [x, y] = tree.point;
    if (crowded(x, y)) continue;
    kept.push(tree);
    const key = keyOf(x, y);
    const list = cells.get(key) ?? [];
    list.push(tree.point);
    cells.set(key, list);
  }
  return kept;
}
