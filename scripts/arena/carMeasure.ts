/**
 * What the 3D view needs to know about a packed car besides its triangles, measured from them in
 * the game's frame (x forward, y up, z to the right): each wheel's middle, radius and width; each
 * head and tail lamp's face; each number plate's face; and the flat stretch of flank between the
 * wheel arches where the police livery goes.
 */

import type { CarEntry } from "../../src/lib/cityArena/carManifest";
import {
  areaOf,
  bakeTriangle,
  boundsOf,
  centroidOf,
  emptyColoured,
  normalOf,
  shiftPositions,
  swatchOfTriangle,
  triangleCount,
  trianglePositions,
  type Coloured,
  type Soup,
} from "./carGeometry";
import type { Atlas, SwatchKey } from "./carAtlas";

/** A wheel as the manifest records it. */
export type WheelEntry = CarEntry["wheels"][number];
/** A lamp as the manifest records it. */
export type LampEntry = CarEntry["lamps"][number];
/** A number plate as the manifest records it. */
export type PlateEntry = NonNullable<CarEntry["plates"]["front"]>;
/** A livery band as the manifest records it. */
export type LiveryEntry = NonNullable<CarEntry["livery"]>;

/** Along, up and across, as axes. */
const ALONG_AXIS = 0;
const UP_AXIS = 1;
const ACROSS_AXIS = 2;
/** The two sides of the centre line: left (−z), then right (+z). */
const SIDES = [-1, 1] as const;

/** The middle of an interval. */
function middle(from: number, to: number): number {
  return (from + to) / 2;
}

/** The triangles of a list whose middles pass `keep`, their positions back to back. */
function positionsWhere(
  list: Coloured,
  keep: (triangle: number) => boolean,
): number[] {
  const positions: number[] = [];
  for (
    let triangle = 0;
    triangle < triangleCount(list.positions);
    triangle += 1
  )
    if (keep(triangle))
      positions.push(...trianglePositions(list.positions, triangle));
  return positions;
}

/**
 * The face of each lamp in a list of lamp triangles: one lamp per side of the centre line.
 *
 * @param lamps - The head or tail lamps' triangles.
 * @param tail - Whether they are tail lamps (facing backward) or headlamps.
 * @returns Up to two lamps, left first.
 */
export function lampsOf(lamps: Coloured, tail: boolean): LampEntry[] {
  const onSide = (side: number) => (triangle: number) =>
    Math.sign(centroidOf(lamps.positions, triangle)[ACROSS_AXIS]) === side;
  return SIDES.map((side) => positionsWhere(lamps, onSide(side)))
    .filter((positions) => positions.length > 0)
    .map((positions) => {
      const { min, max } = boundsOf(positions);
      return {
        at: [
          tail ? min[ALONG_AXIS] : max[ALONG_AXIS],
          middle(min[UP_AXIS], max[UP_AXIS]),
          middle(min[ACROSS_AXIS], max[ACROSS_AXIS]),
        ],
        facing: tail ? -1 : 1,
        tail,
      };
    });
}

/**
 * The face and height of a number plate from its triangles.
 *
 * @param plate - The plate's triangles.
 * @param end - Front (+1) or rear (−1).
 * @returns The plate, or null when the end has none.
 */
export function plateOf(plate: Coloured, end: 1 | -1): PlateEntry | null {
  if (plate.positions.length === 0) return null;
  const { min, max } = boundsOf(plate.positions);
  return {
    face: end > 0 ? max[ALONG_AXIS] : min[ALONG_AXIS],
    height: middle(min[UP_AXIS], max[UP_AXIS]),
  };
}

/** A face whose normal is this much across the car faces a side. */
const SIDE_COSINE = 0.9;
/** The livery keeps this share of a wheel's radius clear of its axle, past the arch. */
const ARCH_CLEARANCE_SHARE = 1.25;
/** Side faces whose distances from the centre line round to the same step (in the file's units) are one plane. */
const FLANK_TOLERANCE = 0.01;

/** The stretch between the arches: from the rear arch's front edge to the front arch's rear edge. */
function betweenArches(wheels: readonly WheelEntry[]): [number, number] {
  const edge = (wheel: WheelEntry, sign: number): number =>
    wheel.at[ALONG_AXIS] + sign * wheel.radius * ARCH_CLEARANCE_SHARE;
  const front = wheels.filter((wheel) => wheel.steers);
  const rear = wheels.filter((wheel) => !wheel.steers);
  return [
    Math.max(...rear.map((wheel) => edge(wheel, 1))),
    Math.min(...front.map((wheel) => edge(wheel, -1))),
  ];
}

/** The side-facing paint triangles between the arches. */
function flankTriangles(
  paint: Coloured,
  span: readonly [number, number],
): number[] {
  const flank: number[] = [];
  for (
    let triangle = 0;
    triangle < triangleCount(paint.positions);
    triangle += 1
  ) {
    const along = centroidOf(paint.positions, triangle)[ALONG_AXIS];
    const across = Math.abs(normalOf(paint.positions, triangle)[ACROSS_AXIS]);
    if (across > SIDE_COSINE && along > span[0] && along < span[1])
      flank.push(triangle);
  }
  return flank;
}

/** The side-facing triangles grouped by how far out they stand, with each group's area. */
function flankPlanes(
  paint: Coloured,
  flank: readonly number[],
): Map<number, { area: number; triangles: Set<number> }> {
  const planes = new Map<number, { area: number; triangles: Set<number> }>();
  for (const triangle of flank) {
    const reach = Math.abs(centroidOf(paint.positions, triangle)[ACROSS_AXIS]);
    const key = Math.round(reach / FLANK_TOLERANCE) * FLANK_TOLERANCE;
    const plane = planes.get(key) ?? { area: 0, triangles: new Set() };
    plane.area += areaOf(paint.positions, triangle);
    plane.triangles.add(triangle);
    planes.set(key, plane);
  }
  return planes;
}

/**
 * The flat stretch of painted flank between the wheel arches: of the side-facing paint between
 * them, the plane (by its distance from the centre line) with the most area — the doors — where
 * the police livery's band of stripes goes.
 *
 * @param paint - The body paint's triangles.
 * @param wheels - The car's wheels.
 * @returns The band, or null when no paint faces the side there.
 */
export function liveryOf(
  paint: Coloured,
  wheels: readonly WheelEntry[],
): LiveryEntry | null {
  const span = betweenArches(wheels);
  const planes = flankPlanes(paint, flankTriangles(paint, span));
  const widest = [...planes.entries()].sort(
    (first, second) => second[1].area - first[1].area,
  )[0];
  if (!widest) return null;
  const [side, { triangles }] = widest;
  const { min, max } = boundsOf(
    positionsWhere(paint, (triangle) => triangles.has(triangle)),
  );
  return {
    x: [Math.max(min[ALONG_AXIS], span[0]), Math.min(max[ALONG_AXIS], span[1])],
    y: [min[UP_AXIS], max[UP_AXIS]],
    side,
  };
}

/** A wheel's triangles about its own middle, and where it sits. */
export type MeasuredWheel = { entry: WheelEntry; geometry: Coloured };

/**
 * Measures one wheel and moves its triangles about its own middle. A wheel ahead of the model's
 * middle steers.
 *
 * @param node - The wheel's node name.
 * @param soup - Its triangles, in the game's frame and recentred.
 * @param colour - The atlas and the swatches drawn in another colour.
 * @returns The wheel and its geometry.
 */
export function measureWheel(
  node: WheelEntry["node"],
  soup: Soup,
  colour: { atlas: Atlas; recolour: Partial<Record<SwatchKey, number>> },
): MeasuredWheel {
  const geometry = emptyColoured();
  for (
    let triangle = 0;
    triangle < triangleCount(soup.positions);
    triangle += 1
  ) {
    const target = colour.recolour[swatchOfTriangle(soup.uvs, triangle)];
    bakeTriangle(geometry, soup, triangle, {
      atlas: colour.atlas,
      target: target ?? null,
    });
  }
  const { min, max } = boundsOf(geometry.positions);
  const at: [number, number, number] = [
    middle(min[ALONG_AXIS], max[ALONG_AXIS]),
    middle(min[UP_AXIS], max[UP_AXIS]),
    middle(min[ACROSS_AXIS], max[ACROSS_AXIS]),
  ];
  shiftPositions(geometry.positions, [-at[0], -at[1], -at[2]]);
  return {
    entry: {
      node,
      at,
      radius: (max[UP_AXIS] - min[UP_AXIS]) / 2,
      width: max[ACROSS_AXIS] - min[ACROSS_AXIS],
      steers: at[ALONG_AXIS] > 0,
    },
    geometry,
  };
}
