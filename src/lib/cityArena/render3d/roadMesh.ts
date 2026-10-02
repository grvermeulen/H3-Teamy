/**
 * Streets of the 3D city: flat ribbons along the road centre lines (mitred at bends, round at the
 * road's own ends), dashed centre markings, and the street lamps set out along the pavements.
 * Everything is built in a cell's local frame and owned by the cell its centre line runs through.
 */
import type { Rect } from "../mapBuild/geometry";
import type { Point } from "../world/projection";
import {
  UP,
  pushTriangleFacing,
  pushVertex,
  vertexCount,
  type MeshBuffers,
  type UvMapping,
} from "./meshBuffers";

/** Width of the dashed centre line, metres (as the 2D map strokes it). */
export const CENTRE_LINE_WIDTH_M = 0.3;
/** Length of one centre-line dash, metres. */
export const DASH_LENGTH_M = 3;
/** A dash plus the gap after it, metres. */
export const DASH_PERIOD_M = 6;
/** Spacing of the street lamps along a road with pavements, metres; they alternate sides. */
export const LAMP_SPACING_M = 34;
/** How far past the kerb a street lamp stands, metres (inside the 2 m pavement). */
export const LAMP_KERB_OFFSET_M = 0.6;
/** No lamp this close to either end of a road piece, where it would stand in a junction. */
const JUNCTION_CLEARANCE_M = 9;
/** The sharpest bend a mitre follows: below this cosine the corner is clamped, not spiked. */
const MIN_MITRE_COS = 0.5;
/** Rim segments of the disc that rounds off a road's end. */
const CAP_SEGMENTS = 8;
/** Shorter than this, a segment is a repeated point and is dropped, metres. */
const MIN_SEGMENT_M = 1e-3;

/** A centre line cut to one cell, and whether each end is the road's own end (a cap goes there). */
export type RoadPiece = { points: Point[]; capStart: boolean; capEnd: boolean };

/** A point on a polyline and the unit direction it runs there. */
type Station = { point: Point; direction: Point };

/** A street lamp's position and the heading of its arm, toward the road. */
export type LampPlacement = { x: number; y: number; heading: number };

/**
 * The polyline without zero-length segments.
 *
 * @param points - The polyline.
 * @returns Its points, repeats dropped.
 */
export function distinctPoints(points: readonly Point[]): Point[] {
  return points.filter(
    (point, index) =>
      index === 0 ||
      Math.hypot(
        point[0] - points[index - 1][0],
        point[1] - points[index - 1][1],
      ) > MIN_SEGMENT_M,
  );
}

/** The unit direction from one point to another. */
function unit(from: Point, to: Point): Point {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  return [(to[0] - from[0]) / length, (to[1] - from[1]) / length];
}

/** A direction turned a quarter to its left in (x, y). */
function perpendicular([x, y]: Point): Point {
  return [-y, x];
}

/**
 * The mitred offset at vertex `index` of a polyline: the unit direction across it (to its left in
 * (x, y)) and how far to stretch an offset there so the edges stay parallel, clamped at sharp bends.
 *
 * @param points - The polyline, without repeated points.
 * @param index - The vertex.
 * @returns The direction across and its stretch.
 */
export function mitre(
  points: readonly Point[],
  index: number,
): { across: Point; stretch: number } {
  const before =
    index > 0 ? perpendicular(unit(points[index - 1], points[index])) : null;
  const after =
    index < points.length - 1
      ? perpendicular(unit(points[index], points[index + 1]))
      : null;
  if (!before || !after)
    return { across: (before ?? after) as Point, stretch: 1 };
  const sum: Point = [before[0] + after[0], before[1] + after[1]];
  const length = Math.hypot(...sum);
  if (length < MIN_SEGMENT_M) return { across: after, stretch: 1 };
  const across: Point = [sum[0] / length, sum[1] / length];
  const cos = across[0] * after[0] + across[1] * after[1];
  return { across, stretch: 1 / Math.max(cos, MIN_MITRE_COS) };
}

/** Pushes one flat vertex at a world point. */
function pushFlatVertex(
  buffers: MeshBuffers,
  [x, y]: Point,
  height: number,
  origin: Point,
  uvOf: UvMapping,
): number {
  return pushVertex(
    buffers,
    [x - origin[0], height, y - origin[1]],
    UP,
    uvOf(x, y),
  );
}

/**
 * A flat disc of `radius` around a world point, facing up.
 *
 * @param buffers - The layer's buffers.
 * @param centre - The disc's centre, world metres.
 * @param radius - Its radius, metres.
 * @param height - Metres above the ground.
 * @param origin - The world point that is the buffers' local zero.
 * @param uvOf - The UV at a world point.
 */
export function pushDisc(
  buffers: MeshBuffers,
  centre: Point,
  radius: number,
  height: number,
  origin: Point,
  uvOf: UvMapping,
): void {
  const middle = pushFlatVertex(buffers, centre, height, origin, uvOf);
  for (let step = 0; step < CAP_SEGMENTS; step++) {
    const angle = (step / CAP_SEGMENTS) * 2 * Math.PI;
    const rim: Point = [
      centre[0] + Math.cos(angle) * radius,
      centre[1] + Math.sin(angle) * radius,
    ];
    pushFlatVertex(buffers, rim, height, origin, uvOf);
  }
  for (let step = 0; step < CAP_SEGMENTS; step++) {
    const next = ((step + 1) % CAP_SEGMENTS) + 1;
    pushTriangleFacing(buffers, [middle, middle + step + 1, middle + next], UP);
  }
}

/**
 * A flat ribbon `width` wide along a road piece, facing up: mitred at every bend (clamped at
 * sharp ones), with a round cap on each end that is the road's own end rather than a cut.
 *
 * @param buffers - The layer's buffers.
 * @param piece - The centre line and its caps.
 * @param width - Full width, metres.
 * @param height - Metres above the ground.
 * @param origin - The world point that is the buffers' local zero.
 * @param uvOf - The UV at a world point.
 */
export function pushRibbon(
  buffers: MeshBuffers,
  piece: RoadPiece,
  width: number,
  height: number,
  origin: Point,
  uvOf: UvMapping,
): void {
  const points = distinctPoints(piece.points);
  if (points.length < 2) return;
  const half = width / 2;
  const first = vertexCount(buffers);
  points.forEach((point, index) => {
    const { across, stretch } = mitre(points, index);
    const reach = half * stretch;
    const left: Point = [
      point[0] + across[0] * reach,
      point[1] + across[1] * reach,
    ];
    const right: Point = [
      point[0] - across[0] * reach,
      point[1] - across[1] * reach,
    ];
    pushFlatVertex(buffers, left, height, origin, uvOf);
    pushFlatVertex(buffers, right, height, origin, uvOf);
  });
  for (let index = 0; index + 1 < points.length; index++) {
    const [left, right] = [first + index * 2, first + index * 2 + 1];
    pushTriangleFacing(buffers, [left, right, right + 2], UP);
    pushTriangleFacing(buffers, [left, right + 2, left + 2], UP);
  }
  if (piece.capStart) pushDisc(buffers, points[0], half, height, origin, uvOf);
  if (piece.capEnd)
    pushDisc(buffers, points[points.length - 1], half, height, origin, uvOf);
}

/**
 * Calls `visit` at every multiple of `spacing` (plus `phase`) along a polyline, with the point
 * there and the direction the line runs.
 */
function forEachStation(
  points: readonly Point[],
  spacing: number,
  phase: number,
  visit: (
    station: Station,
    distance: number,
    total: number,
    index: number,
  ) => void,
): void {
  const line = distinctPoints(points);
  const lengths = line
    .slice(1)
    .map((point, index) =>
      Math.hypot(point[0] - line[index][0], point[1] - line[index][1]),
    );
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let segment = 0;
  let start = 0;
  for (
    let index = 0, at = phase;
    at <= total;
    index++, at = phase + index * spacing
  ) {
    while (segment < lengths.length - 1 && start + lengths[segment] < at) {
      start += lengths[segment];
      segment += 1;
    }
    const direction = unit(line[segment], line[segment + 1]);
    const along = Math.min(at - start, lengths[segment]);
    const point: Point = [
      line[segment][0] + direction[0] * along,
      line[segment][1] + direction[1] * along,
    ];
    visit({ point, direction }, at, total, index);
  }
}

/** True when a point lies in a rectangle, minimum edges in and maximum edges out. */
export function inRegion([x, y]: Point, region: Rect): boolean {
  return (
    x >= region.minX && x < region.maxX && y >= region.minY && y < region.maxY
  );
}

/**
 * The dashes of a road's centre line whose middle falls in `region`: 3 m dashes every 6 m
 * counted from the road's start, so they run on unbroken from one cell into the next.
 *
 * @param buffers - The markings layer's buffers.
 * @param points - The whole centre line (not a cut piece), so the dash phase is the road's own.
 * @param region - The part of the world this cell owns.
 * @param height - Metres above the ground.
 * @param origin - The world point that is the buffers' local zero.
 * @param uvOf - The UV at a world point.
 */
export function pushDashes(
  buffers: MeshBuffers,
  points: readonly Point[],
  region: Rect,
  height: number,
  origin: Point,
  uvOf: UvMapping,
): void {
  if (distinctPoints(points).length < 2) return;
  const half = CENTRE_LINE_WIDTH_M / 2;
  forEachStation(
    points,
    DASH_PERIOD_M,
    0,
    ({ point, direction }, at, total) => {
      const length = Math.min(DASH_LENGTH_M, total - at);
      const middle: Point = [
        point[0] + direction[0] * (length / 2),
        point[1] + direction[1] * (length / 2),
      ];
      if (length <= 0 || !inRegion(middle, region)) return;
      const [ax, ay] = perpendicular(direction);
      const end: Point = [
        point[0] + direction[0] * length,
        point[1] + direction[1] * length,
      ];
      const corners: Point[] = [
        [point[0] + ax * half, point[1] + ay * half],
        [point[0] - ax * half, point[1] - ay * half],
        [end[0] - ax * half, end[1] - ay * half],
        [end[0] + ax * half, end[1] + ay * half],
      ];
      const base = vertexCount(buffers);
      for (const corner of corners)
        pushFlatVertex(buffers, corner, height, origin, uvOf);
      pushTriangleFacing(buffers, [base, base + 1, base + 2], UP);
      pushTriangleFacing(buffers, [base, base + 2, base + 3], UP);
    },
  );
}

/**
 * Street lamps along a road with pavements: one every {@link LAMP_SPACING_M} (half a spacing in
 * from the start), alternating sides, just past the kerb, the arm turned toward the road; none
 * within {@link JUNCTION_CLEARANCE_M} of either end. Only lamps standing in `region` are returned,
 * so each is placed by exactly one cell: the cell it stands in, which may not be the cell its road
 * runs through (pass every road within the lamp's reach of the region).
 *
 * @param points - The whole centre line.
 * @param roadWidth - The carriageway's width, metres.
 * @param region - The part of the world this cell owns.
 * @returns The lamps, in order along the road.
 */
export function lampsAlong(
  points: readonly Point[],
  roadWidth: number,
  region: Rect,
): LampPlacement[] {
  const lamps: LampPlacement[] = [];
  if (distinctPoints(points).length < 2) return lamps;
  const reach = roadWidth / 2 + LAMP_KERB_OFFSET_M;
  forEachStation(
    points,
    LAMP_SPACING_M,
    LAMP_SPACING_M / 2,
    ({ point, direction }, at, total, index) => {
      if (at < JUNCTION_CLEARANCE_M || at > total - JUNCTION_CLEARANCE_M)
        return;
      const side = index % 2 === 0 ? 1 : -1;
      const [ax, ay] = perpendicular(direction);
      const x = point[0] + ax * reach * side;
      const y = point[1] + ay * reach * side;
      if (!inRegion([x, y], region)) return;
      lamps.push({ x, y, heading: Math.atan2(-ay * side, -ax * side) });
    },
  );
  return lamps;
}
