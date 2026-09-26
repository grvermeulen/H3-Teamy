/**
 * A pitched roof that follows a footprint exactly, for footprints far from rectangular (the
 * churches and pools): the footprint is cut along a ridge line down its long axis, each half
 * rises as one plane from the eaves to the ridge, and gable walls close the ends from the eaves
 * up to the roof line.
 */
import type { BufferGeometry, Vector3Tuple } from "three";
import type { Point } from "../world/projection";
import { orientedBox } from "./footprint";
import {
  createMeshBuffers,
  pushPolygonSurface,
  pushTriangleFacing,
  pushVertex,
  toGeometry,
  vertexCount,
  type MeshBuffers,
  type UvMapping,
} from "./meshBuffers";
import { TEXTURE_REPEAT_M } from "./textures";

/** Below this, a gable wall (or one corner of it) is too low to build, metres. */
const MIN_GABLE_M = 0.01;

/**
 * The ridge: a point on it, the unit direction across it, the half width it rises over, and the
 * eaves height it rises from.
 */
type Ridge = { centre: Point; across: Point; half: number; eaves: number };

/** Signed distance of a point from the ridge line, positive on the `across` side. */
function acrossRidge(ridge: Ridge, [x, y]: Point): number {
  return (
    (x - ridge.centre[0]) * ridge.across[0] +
    (y - ridge.centre[1]) * ridge.across[1]
  );
}

/** The part of a ring on one side of the ridge line (Sutherland–Hodgman on a half-plane). */
function clipToSide(
  ring: readonly Point[],
  ridge: Ridge,
  side: 1 | -1,
): Point[] {
  const clipped: Point[] = [];
  ring.forEach((current, index) => {
    const previous = ring[(index + ring.length - 1) % ring.length];
    const [dc, dp] = [
      side * acrossRidge(ridge, current),
      side * acrossRidge(ridge, previous),
    ];
    if (dc >= 0 !== dp >= 0) {
      const t = dp / (dp - dc);
      clipped.push([
        previous[0] + (current[0] - previous[0]) * t,
        previous[1] + (current[1] - previous[1]) * t,
      ]);
    }
    if (dc >= 0) clipped.push(current);
  });
  return clipped;
}

/** Twice a ring's signed area: positive when it runs counter-clockwise in (x, y). */
function signedTwiceArea(ring: readonly Point[]): number {
  return ring.reduce((sum, [x1, y1], index) => {
    const [x2, y2] = ring[(index + 1) % ring.length];
    return sum + x1 * y2 - x2 * y1;
  }, 0);
}

/** One gable wall under the roof along a footprint edge, from the eaves up to the roof line. */
function pushGable(
  buffers: MeshBuffers,
  edge: [Point, Point],
  ridge: Ridge,
  heightAt: (point: Point) => number,
  outward: 1 | -1,
): void {
  const [a, b] = edge;
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const eaves = ridge.eaves;
  const tops: Point[] = [a, b];
  const peak = ridgeCrossing(ridge, edge);
  const highest = Math.max(
    heightAt(a),
    heightAt(b),
    peak ? heightAt(peak) : eaves,
  );
  if (length === 0 || highest - eaves < MIN_GABLE_M) return;
  if (peak) tops.splice(1, 0, peak);
  const normal: Vector3Tuple = [
    (outward * (b[1] - a[1])) / length,
    0,
    (-outward * (b[0] - a[0])) / length,
  ];
  const base = vertexCount(buffers);
  const uv = (point: Point, height: number): [number, number] => [
    Math.hypot(point[0] - a[0], point[1] - a[1]) / TEXTURE_REPEAT_M,
    height / TEXTURE_REPEAT_M,
  ];
  pushVertex(buffers, [a[0], eaves, a[1]], normal, uv(a, eaves));
  pushVertex(buffers, [b[0], eaves, b[1]], normal, uv(b, eaves));
  for (const point of [...tops].reverse()) {
    const height = heightAt(point);
    if (height - eaves < MIN_GABLE_M) continue;
    pushVertex(
      buffers,
      [point[0], height, point[1]],
      normal,
      uv(point, height),
    );
  }
  const corners = vertexCount(buffers) - base;
  for (let index = 1; index + 1 < corners; index++) {
    pushTriangleFacing(buffers, [base, base + index, base + index + 1], normal);
  }
}

/** Where an edge crosses the ridge line (the gable's peak), or null when it does not. */
function ridgeCrossing(ridge: Ridge, [a, b]: [Point, Point]): Point | null {
  const [da, db] = [acrossRidge(ridge, a), acrossRidge(ridge, b)];
  if (da === 0 || db === 0 || da > 0 === db > 0) return null;
  const t = da / (da - db);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * A pitched roof over a footprint, in the footprint's own frame (whatever origin its points use).
 * The ridge runs along the footprint's long axis through the middle of its oriented rectangle,
 * `rise` above the eaves; each side falls as one plane to the eaves at the rectangle's long sides.
 *
 * @param ring - The footprint, first point not repeated.
 * @param eaves - Height of the walls under the roof, metres.
 * @param rise - Height of the ridge above the eaves, metres.
 * @returns The roof slopes (normals up) and the gable walls closing the ends (normals out).
 */
export function pitchedRoofGeometry(
  ring: readonly Point[],
  eaves: number,
  rise: number,
): { slopes: BufferGeometry; gables: BufferGeometry } {
  const box = orientedBox(ring);
  const ridge: Ridge = {
    centre: box.centre,
    across: box.across,
    half: box.width / 2,
    eaves,
  };
  const heightAt = (point: Point): number =>
    eaves +
    rise * Math.max(0, 1 - Math.abs(acrossRidge(ridge, point)) / ridge.half);
  const uvOf: UvMapping = (x, y) => [
    x / TEXTURE_REPEAT_M,
    y / TEXTURE_REPEAT_M,
  ];
  const slopes = createMeshBuffers();
  const slope = rise / ridge.half;
  for (const side of [1, -1] as const) {
    const part = clipToSide(ring, ridge, side);
    if (part.length < 3) continue;
    const [nx, nz] = [
      side * slope * ridge.across[0],
      side * slope * ridge.across[1],
    ];
    const length = Math.hypot(nx, 1, nz);
    const normal: Vector3Tuple = [nx / length, 1 / length, nz / length];
    pushPolygonSurface(slopes, part, heightAt, normal, [0, 0], uvOf);
  }
  const gables = createMeshBuffers();
  const outward = signedTwiceArea(ring) > 0 ? 1 : -1;
  ring.forEach((point, index) => {
    const next = ring[(index + 1) % ring.length];
    pushGable(gables, [point, next], ridge, heightAt, outward);
  });
  return { slopes: toGeometry(slopes), gables: toGeometry(gables) };
}
