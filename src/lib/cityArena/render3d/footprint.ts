/**
 * Measurements of a building footprint the 3D builders shape roofs and landmark dressing by.
 */
import { polygonArea } from "../mapBuild/geometry";
import { longestEdgeAngle } from "../render/drawRoofs";
import type { Point } from "../world/projection";

/**
 * The rectangle around a footprint, turned to its longest edge (as the 2D roofs are).
 * `long` runs along the rectangle's longer side, `across` a quarter turn from it.
 */
export type OrientedBox = {
  centre: Point;
  long: Point;
  across: Point;
  length: number;
  width: number;
  /** The footprint's area as a share of the rectangle's: 1 for a rectangle. */
  fill: number;
};

/** The extent of a ring's projection on a unit direction. */
function extent(ring: readonly Point[], [ux, uy]: Point): [number, number] {
  const values = ring.map(([x, y]) => x * ux + y * uy);
  return [Math.min(...values), Math.max(...values)];
}

/**
 * The footprint's rectangle aligned with its longest edge.
 *
 * @param ring - The footprint, world metres.
 * @returns Its centre, unit axes (long side first), side lengths and fill.
 */
export function orientedBox(ring: readonly Point[]): OrientedBox {
  const angle = longestEdgeAngle([...ring]);
  const axis: Point = [Math.cos(angle), Math.sin(angle)];
  const normal: Point = [-axis[1], axis[0]];
  const [minA, maxA] = extent(ring, axis);
  const [minN, maxN] = extent(ring, normal);
  const [midA, midN] = [(minA + maxA) / 2, (minN + maxN) / 2];
  const centre: Point = [
    axis[0] * midA + normal[0] * midN,
    axis[1] * midA + normal[1] * midN,
  ];
  const [spanA, spanN] = [maxA - minA, maxN - minN];
  const fill = spanA * spanN > 0 ? polygonArea([...ring]) / (spanA * spanN) : 0;
  return spanA >= spanN
    ? { centre, long: axis, across: normal, length: spanA, width: spanN, fill }
    : { centre, long: normal, across: axis, length: spanN, width: spanA, fill };
}

/**
 * The footprint corner farthest from a point.
 *
 * @param ring - The footprint.
 * @param from - The point, e.g. the centroid.
 * @returns That corner.
 */
export function farthestVertex(ring: readonly Point[], from: Point): Point {
  let best = ring[0];
  let bestDistance = -1;
  for (const point of ring) {
    const distance = Math.hypot(point[0] - from[0], point[1] - from[1]);
    if (distance > bestDistance) {
      bestDistance = distance;
      best = point;
    }
  }
  return best;
}

/**
 * A point moved by a sum of scaled vectors.
 *
 * @param point - The start.
 * @param steps - `[vector, scale]` pairs.
 * @returns `point + Σ vector × scale`.
 */
export function offsetPoint(point: Point, ...steps: [Point, number][]): Point {
  return steps.reduce<Point>(
    ([x, y], [vector, scale]) => [x + vector[0] * scale, y + vector[1] * scale],
    point,
  );
}
