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

/** True when two rectangles overlap or touch. */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY
  );
}

/** Douglas-Peucker simplification; endpoints are always kept. */
export function simplifyPolyline(
  points: Point[],
  toleranceMetres: number,
): Point[] {
  if (points.length <= 2) return points.slice();
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const pending: Array<[number, number]> = [[0, points.length - 1]];
  while (pending.length > 0) {
    const range = pending.pop();
    if (!range) break;
    const [start, end] = range;
    let farthestDistance = 0;
    let farthestIndex = -1;
    for (let index = start + 1; index < end; index++) {
      const candidate = distancePointToSegment(
        points[index],
        points[start],
        points[end],
      );
      if (candidate > farthestDistance) {
        farthestDistance = candidate;
        farthestIndex = index;
      }
    }
    if (farthestIndex === -1 || farthestDistance <= toleranceMetres) continue;
    keep[farthestIndex] = true;
    pending.push([start, farthestIndex], [farthestIndex, end]);
  }
  return points.filter((_, index) => keep[index]);
}

/** Simplifies a closed ring (first point not repeated); returns the input when < 3 points would remain. */
export function simplifyRing(ring: Point[], toleranceMetres: number): Point[] {
  if (ring.length <= 3) return ring.slice();
  const closed = simplifyPolyline([...ring, ring[0]], toleranceMetres);
  const open = closed.slice(0, -1);
  return open.length >= 3 ? open : ring.slice();
}

function intersectVertical(a: Point, b: Point, x: number): Point {
  const t = (x - a[0]) / (b[0] - a[0]);
  return [x, a[1] + t * (b[1] - a[1])];
}

function intersectHorizontal(a: Point, b: Point, y: number): Point {
  const t = (y - a[1]) / (b[1] - a[1]);
  return [a[0] + t * (b[0] - a[0]), y];
}

type ClipEdge = {
  inside: (point: Point) => boolean;
  intersect: (a: Point, b: Point) => Point;
};

/** Sutherland-Hodgman clipping of a ring against a rectangle; `[]` when nothing remains. */
export function clipPolygonToRect(ring: Point[], rect: Rect): Point[] {
  const edges: ClipEdge[] = [
    {
      inside: (point) => point[0] >= rect.minX,
      intersect: (a, b) => intersectVertical(a, b, rect.minX),
    },
    {
      inside: (point) => point[0] <= rect.maxX,
      intersect: (a, b) => intersectVertical(a, b, rect.maxX),
    },
    {
      inside: (point) => point[1] >= rect.minY,
      intersect: (a, b) => intersectHorizontal(a, b, rect.minY),
    },
    {
      inside: (point) => point[1] <= rect.maxY,
      intersect: (a, b) => intersectHorizontal(a, b, rect.maxY),
    },
  ];
  let output = ring;
  for (const edge of edges) {
    if (output.length === 0) return [];
    const input = output;
    output = [];
    for (let index = 0; index < input.length; index++) {
      const current = input[index];
      const previous = input[(index + input.length - 1) % input.length];
      const currentInside = edge.inside(current);
      const previousInside = edge.inside(previous);
      if (currentInside) {
        if (!previousInside) output.push(edge.intersect(previous, current));
        output.push(current);
      } else if (previousInside) {
        output.push(edge.intersect(previous, current));
      }
    }
  }
  return output.length >= 3 ? output : [];
}

/** Liang-Barsky clip of one segment; `null` when fully outside. */
function clipSegmentToRect(
  a: Point,
  b: Point,
  rect: Rect,
): [Point, Point] | null {
  const deltaX = b[0] - a[0];
  const deltaY = b[1] - a[1];
  let tEnter = 0;
  let tExit = 1;
  const checks: Array<[number, number]> = [
    [-deltaX, a[0] - rect.minX],
    [deltaX, rect.maxX - a[0]],
    [-deltaY, a[1] - rect.minY],
    [deltaY, rect.maxY - a[1]],
  ];
  for (const [denominator, numerator] of checks) {
    if (denominator === 0) {
      if (numerator < 0) return null;
      continue;
    }
    const ratio = numerator / denominator;
    if (denominator < 0) {
      if (ratio > tExit) return null;
      if (ratio > tEnter) tEnter = ratio;
    } else {
      if (ratio < tEnter) return null;
      if (ratio < tExit) tExit = ratio;
    }
  }
  const start: Point =
    tEnter === 0 ? a : [a[0] + tEnter * deltaX, a[1] + tEnter * deltaY];
  const end: Point =
    tExit === 1 ? b : [a[0] + tExit * deltaX, a[1] + tExit * deltaY];
  return [start, end];
}

/** Clips a polyline to a rectangle, returning the pieces that remain inside (each ≥ 2 points). */
export function clipPolylineToRect(points: Point[], rect: Rect): Point[][] {
  const pieces: Point[][] = [];
  let current: Point[] = [];
  for (let index = 0; index + 1 < points.length; index++) {
    const clipped = clipSegmentToRect(points[index], points[index + 1], rect);
    if (!clipped) {
      if (current.length >= 2) pieces.push(current);
      current = [];
      continue;
    }
    const [start, end] = clipped;
    if (current.length === 0) {
      current.push(start);
    } else {
      const last = current[current.length - 1];
      const continuous = last[0] === start[0] && last[1] === start[1];
      if (!continuous) {
        pieces.push(current);
        current = [start];
      }
    }
    current.push(end);
  }
  if (current.length >= 2) pieces.push(current);
  return pieces;
}
