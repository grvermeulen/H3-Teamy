import type { Point } from "../world/projection";

/** Axis-aligned rectangle in the same unit as the points it is used with. */
export type Rect = { minX: number; minY: number; maxX: number; maxY: number };

/** Euclidean distance between two points. */
export function distance(a: Point, b: Point): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** Bounding rectangle of a non-empty point list. */
export function boundsOf(points: Point[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** Signed shoelace sum (twice the signed area). */
function shoelace(ring: Point[]): number {
  let sum = 0;
  for (let index = 0; index < ring.length; index++) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[(index + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum;
}

/** Absolute polygon area for a ring whose first point is not repeated. */
export function polygonArea(ring: Point[]): number {
  return Math.abs(shoelace(ring)) / 2;
}

/** Area-weighted centroid; falls back to the vertex average when the area is ~0. */
export function polygonCentroid(ring: Point[]): Point {
  const twiceArea = shoelace(ring);
  if (Math.abs(twiceArea) < 1e-9) {
    const sumX = ring.reduce((total, [x]) => total + x, 0);
    const sumY = ring.reduce((total, [, y]) => total + y, 0);
    return [sumX / ring.length, sumY / ring.length];
  }
  let centroidX = 0;
  let centroidY = 0;
  for (let index = 0; index < ring.length; index++) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[(index + 1) % ring.length];
    const cross = x1 * y2 - x2 * y1;
    centroidX += (x1 + x2) * cross;
    centroidY += (y1 + y2) * cross;
  }
  const factor = 1 / (3 * twiceArea);
  return [centroidX * factor, centroidY * factor];
}

/** Ray-casting point-in-polygon test. */
export function pointInPolygon(point: Point, ring: Point[]): boolean {
  const [px, py] = point;
  let inside = false;
  for (
    let index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index++
  ) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[previous];
    const crossesRay = y1 > py !== y2 > py;
    if (!crossesRay) continue;
    const intersectX = ((x2 - x1) * (py - y1)) / (y2 - y1) + x1;
    if (px < intersectX) inside = !inside;
  }
  return inside;
}

/** Distance from a point to the closest point on segment a–b. */
export function distancePointToSegment(
  point: Point,
  a: Point,
  b: Point,
): number {
  const segmentX = b[0] - a[0];
  const segmentY = b[1] - a[1];
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  if (lengthSquared === 0) return distance(point, a);
  const projection =
    ((point[0] - a[0]) * segmentX + (point[1] - a[1]) * segmentY) /
    lengthSquared;
  const clamped = Math.max(0, Math.min(1, projection));
  return distance(point, [
    a[0] + clamped * segmentX,
    a[1] + clamped * segmentY,
  ]);
}

/** Distance from a point to a polygon: 0 when inside, else the nearest edge distance. */
export function distancePointToPolygon(point: Point, ring: Point[]): number {
  if (pointInPolygon(point, ring)) return 0;
  let nearest = Infinity;
  for (let index = 0; index < ring.length; index++) {
    const edgeDistance = distancePointToSegment(
      point,
      ring[index],
      ring[(index + 1) % ring.length],
    );
    if (edgeDistance < nearest) nearest = edgeDistance;
  }
  return nearest;
}
