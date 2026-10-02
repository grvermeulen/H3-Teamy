/**
 * Geometry for a destroyed building (spec §6.8): the plain prism that sinks during the collapse and
 * the rubble mound shaped to the footprint that stays until the structure is rebuilt. Both are
 * built around the footprint's centre, so their mesh sits at that centre and turns about it.
 */
import {
  BufferAttribute,
  BufferGeometry,
  ExtrudeGeometry,
  Shape,
  ShapeUtils,
  Vector2,
} from "three";
import type { Point } from "../world/projection";
import { within, type Rng } from "./fxEmit";

/** Height of a rubble mound, metres (spec §6.8). */
export const RUBBLE_HEIGHT_M = 0.8;
/** How far each top vertex of a mound is jittered up or down, metres. */
export const RUBBLE_JITTER_M = 0.3;
/** Longest stretch of footprint edge without a vertex, so big mounds get bumps along their sides. */
const RUBBLE_MAX_EDGE_M = 3;
/**
 * The mound's raised rings: each is the footprint shrunk toward the centre by `scale` and lifted
 * `lift` above the mound's height, before jitter. The outer slope rises from the footprint itself.
 */
const RUBBLE_RINGS = [
  { scale: 0.85, lift: 0 },
  { scale: 0.45, lift: 0.15 },
] as const;
/** The first and last corner of a closed ring lie closer than this, metres. */
const SAME_CORNER_M = 1e-6;

/** A footprint centred on its middle. */
export type Footprint = {
  /** The middle of the corners, world metres. */
  centre: Point;
  /** The corners relative to the centre, without a repeated closing corner. */
  outline: Point[];
};

function closesOnItself(ring: readonly Point[]): boolean {
  const first = ring[0];
  const last = ring[ring.length - 1];
  return (
    ring.length > 1 &&
    Math.hypot(first[0] - last[0], first[1] - last[1]) < SAME_CORNER_M
  );
}

/**
 * Centres a footprint ring.
 *
 * @param ring - The footprint's corners in world metres, closed or open.
 * @returns Its centre and its corners relative to that centre.
 */
export function footprint(ring: readonly Point[]): Footprint {
  const corners = closesOnItself(ring) ? ring.slice(0, -1) : ring.slice();
  const cx = corners.reduce((sum, [x]) => sum + x, 0) / corners.length;
  const cy = corners.reduce((sum, [, y]) => sum + y, 0) / corners.length;
  return {
    centre: [cx, cy],
    outline: corners.map(([x, y]): Point => [x - cx, y - cy]),
  };
}

/**
 * A plain prism over a footprint, from the ground to `height`.
 *
 * @param outline - Corners relative to the footprint's centre, world metres (x east, y south).
 * @param height - Roof height, metres.
 * @returns Geometry in three.js space: the footprint on the ground, the roof at `height`.
 */
export function prismGeometry(
  outline: readonly Point[],
  height: number,
): BufferGeometry {
  // The shape lies in three's x/y plane and extrudes along +z; tipping it back by a quarter turn
  // stands it up, which sends shape y to −z — so world y goes in negated.
  const shape = new Shape(outline.map(([x, y]) => new Vector2(x, -y)));
  return new ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
  }).rotateX(-Math.PI / 2);
}

/** Adds corners along every edge longer than {@link RUBBLE_MAX_EDGE_M}. */
function subdivide(outline: readonly Point[]): Point[] {
  return outline.flatMap(([x, y], index): Point[] => {
    const [nx, ny] = outline[(index + 1) % outline.length];
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(nx - x, ny - y) / RUBBLE_MAX_EDGE_M),
    );
    return Array.from({ length: steps }, (_, step): Point => [
      x + ((nx - x) * step) / steps,
      y + ((ny - y) * step) / steps,
    ]);
  });
}

/** The outline wound so its shoelace sum is positive, which the index pattern below relies on. */
function wound(outline: Point[]): Point[] {
  const doubled = outline.reduce((sum, [x, y], index) => {
    const [nx, ny] = outline[(index + 1) % outline.length];
    return sum + x * ny - nx * y;
  }, 0);
  return doubled >= 0 ? outline : [...outline].reverse();
}

/** The mound's vertices: the footprint on the ground, then each raised ring with jittered heights. */
function moundPositions(base: readonly Point[], rng: Rng): Float32Array {
  const positions = new Float32Array(
    base.length * (RUBBLE_RINGS.length + 1) * 3,
  );
  base.forEach(([x, y], corner) => {
    positions[corner * 3] = x;
    positions[corner * 3 + 2] = y;
  });
  RUBBLE_RINGS.forEach(({ scale, lift }, ring) => {
    base.forEach(([x, y], corner) => {
      const at = ((ring + 1) * base.length + corner) * 3;
      positions[at] = x * scale;
      positions[at + 1] =
        RUBBLE_HEIGHT_M +
        lift +
        within(rng, [-RUBBLE_JITTER_M, RUBBLE_JITTER_M]);
      positions[at + 2] = y * scale;
    });
  });
  return positions;
}

/** Two triangles per edge between a ring and the smaller ring above it, facing up and out. */
function stripIndices(count: number, lower: number, upper: number): number[] {
  const indices: number[] = [];
  for (let corner = 0; corner < count; corner++) {
    const next = (corner + 1) % count;
    indices.push(lower + corner, upper + next, lower + next);
    indices.push(lower + corner, upper + corner, upper + next);
  }
  return indices;
}

/** The top ring's cap, each triangle turned to face up whatever order the triangulator gave. */
function capIndices(
  positions: Float32Array,
  first: number,
  count: number,
): number[] {
  const contour = Array.from(
    { length: count },
    (_, corner) =>
      new Vector2(
        positions[(first + corner) * 3],
        positions[(first + corner) * 3 + 2],
      ),
  );
  return ShapeUtils.triangulateShape(contour, []).flatMap(([a, b, c]) => {
    const [pa, pb, pc] = [contour[a], contour[b], contour[c]];
    const up = (pb.y - pa.y) * (pc.x - pa.x) - (pb.x - pa.x) * (pc.y - pa.y);
    return up > 0
      ? [first + a, first + b, first + c]
      : [first + a, first + c, first + b];
  });
}

/**
 * A rubble mound over a footprint: sloped sides rising from the footprint to a lumpy top about
 * {@link RUBBLE_HEIGHT_M} high, every top vertex jittered by the generator.
 *
 * @param outline - Corners relative to the footprint's centre, world metres (x east, y south).
 * @param rng - Seeded by the structure's id, so a ruin looks the same on every screen.
 * @returns Geometry in three.js space, standing on the ground.
 */
export function rubbleGeometry(
  outline: readonly Point[],
  rng: Rng,
): BufferGeometry {
  const base = wound(subdivide(outline));
  const count = base.length;
  const positions = moundPositions(base, rng);
  const indices: number[] = [];
  for (let ring = 0; ring < RUBBLE_RINGS.length; ring++)
    indices.push(...stripIndices(count, ring * count, (ring + 1) * count));
  indices.push(...capIndices(positions, RUBBLE_RINGS.length * count, count));
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
