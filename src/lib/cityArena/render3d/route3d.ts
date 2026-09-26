/**
 * The navigation route in 3D (spec §6.5, the 2D `drawNavigation`): a glowing band laid just above
 * the road along the route's points, in the 2D ribbon's cyan — the GPS line of a GTA street. The
 * band is built once per route and rebuilt only when the route changes.
 */
import { BufferAttribute, BufferGeometry, Mesh } from "three";
import { ROUTE_RGB } from "../render/palette";
import type { Point } from "../world/projection";
import { ROAD_Y_M } from "./buildCell";
import { createGlowMaterial } from "./glowMaterial";

/** Width of the band, metres. */
export const ROUTE_WIDTH_M = 1.2;
/** Height of the band above the road surface, metres: clear of the road without floating. */
export const ROUTE_LIFT_M = 0.1;
/** Strength of the glow at the band's centre line. */
const ROUTE_OPACITY = 0.75;
/** How sharply the band fades toward its edges. */
const ROUTE_EDGE_FADE = 0.8;
/** Points closer than this to the previous one are the same point, metres. */
const MIN_STEP_M = 0.01;
/** A sharp corner's join is widened at most this much, so a hairpin never spikes out. */
const MAX_MITER = 2;
/** Floats per vertex position, and vertices per route point (left and right edge). */
const XYZ = 3;
const EDGES = 2;

/** The band's buffers, ready for a geometry. */
export type RouteRibbon = {
  /** Two vertices per route point, left edge then right, in three.js space. */
  positions: Float32Array;
  /** u runs across the band (0 left, 1 right), v along it in metres. */
  uvs: Float32Array;
  /** Two triangles per stretch between points. */
  indices: Uint32Array;
};

/** The live route band. */
export type Route3d = {
  /** Add to the scene once; hidden while there is no route. */
  object: Mesh;
  /** Follows this frame's route, rebuilding the band only when it changed. */
  update(points: readonly Point[] | undefined): void;
  /** Frees the band and its material. */
  dispose(): void;
};

/** True when two points are the same place. */
function samePoint(a: Point, b: Point): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * Whether a route is the one already laid: the same list, or one of the same length with the same
 * start and end — a navigation refresh hands over a new list for an unchanged route.
 *
 * @param last - The route the band was built from.
 * @param next - This frame's route.
 * @returns True when the band can stay as it is.
 */
export function sameRoute(
  last: readonly Point[] | undefined,
  next: readonly Point[] | undefined,
): boolean {
  if (last === next) return true;
  if (!last || !next || last.length !== next.length) return false;
  if (last.length === 0) return true;
  return (
    samePoint(last[0], next[0]) &&
    samePoint(last[last.length - 1], next[next.length - 1])
  );
}

/** The route without points repeated in place. */
function distinctPoints(points: readonly Point[]): Point[] {
  const distinct: Point[] = [];
  for (const point of points) {
    const previous = distinct[distinct.length - 1];
    if (
      !previous ||
      Math.hypot(point[0] - previous[0], point[1] - previous[1]) >= MIN_STEP_M
    )
      distinct.push(point);
  }
  return distinct;
}

/** The unit normal (to the left of travel) of the stretch from `a` to `b`. */
function normalOf(a: Point, b: Point): Point {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return [-(b[1] - a[1]) / length, (b[0] - a[0]) / length];
}

/** The offset from point `index` to the band's left edge: the mitred normal times half the width. */
function edgeOffset(points: readonly Point[], index: number): Point {
  const before = index > 0 ? normalOf(points[index - 1], points[index]) : null;
  const after =
    index < points.length - 1
      ? normalOf(points[index], points[index + 1])
      : null;
  const along = after ?? before!;
  const sumX = (before?.[0] ?? 0) + (after?.[0] ?? 0);
  const sumY = (before?.[1] ?? 0) + (after?.[1] ?? 0);
  const sum = Math.hypot(sumX, sumY);
  const join: Point = sum < MIN_STEP_M ? along : [sumX / sum, sumY / sum];
  const cos = join[0] * along[0] + join[1] * along[1];
  const scale =
    (ROUTE_WIDTH_M / 2) * Math.min(MAX_MITER, 1 / Math.max(cos, 1e-6));
  return [join[0] * scale, join[1] * scale];
}

/** Two triangles per stretch, joining each point's edge pair to the next. */
function stripIndices(pointCount: number): Uint32Array {
  const indices = new Uint32Array(Math.max(0, pointCount - 1) * 6);
  for (let stretch = 0; stretch < pointCount - 1; stretch++) {
    const at = stretch * EDGES;
    indices.set([at, at + 1, at + 2, at + 1, at + 3, at + 2], stretch * 6);
  }
  return indices;
}

/**
 * The band along a route: {@link ROUTE_WIDTH_M} wide, {@link ROUTE_LIFT_M} above the road, mitred
 * at corners (a hairpin's join capped at twice the width).
 *
 * @param route - The route's points, world metres.
 * @returns Its buffers; empty when fewer than two distinct points remain.
 */
export function routeRibbon(route: readonly Point[]): RouteRibbon {
  const points = distinctPoints(route);
  const count = points.length < 2 ? 0 : points.length;
  const positions = new Float32Array(count * EDGES * XYZ);
  const uvs = new Float32Array(count * EDGES * 2);
  const height = ROAD_Y_M + ROUTE_LIFT_M;
  let along = 0;
  for (let index = 0; index < count; index++) {
    const [x, y] = points[index];
    if (index > 0)
      along += Math.hypot(x - points[index - 1][0], y - points[index - 1][1]);
    const [dx, dy] = edgeOffset(points, index);
    positions.set([x + dx, height, y + dy, x - dx, height, y - dy], index * 6);
    uvs.set([0, along, 1, along], index * 4);
  }
  return { positions, uvs, indices: stripIndices(count) };
}

/** A geometry holding a route's band. */
function ribbonGeometry(route: readonly Point[]): BufferGeometry {
  const { positions, uvs, indices } = routeRibbon(route);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, XYZ));
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
  geometry.setIndex(new BufferAttribute(indices, 1));
  return geometry;
}

/**
 * Creates the route band: additive and soft-edged in the 2D route's cyan, fading with the fog.
 *
 * @returns The band; call `update` every frame with the scene's route.
 */
export function createRoute3d(): Route3d {
  const material = createGlowMaterial({
    colour: `rgb(${ROUTE_RGB.join(",")})`,
    opacity: ROUTE_OPACITY,
    acrossFade: ROUTE_EDGE_FADE,
  });
  const mesh = new Mesh(new BufferGeometry(), material);
  mesh.name = "route";
  mesh.visible = false;
  let last: readonly Point[] | undefined;
  return {
    object: mesh,
    update(points) {
      const same = sameRoute(last, points);
      last = points;
      if (same) return;
      mesh.geometry.dispose();
      const drawn = points !== undefined && points.length >= 2;
      mesh.geometry = drawn ? ribbonGeometry(points) : new BufferGeometry();
      mesh.visible = drawn && mesh.geometry.index!.count > 0;
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
