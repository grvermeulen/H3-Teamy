import { boundsOf } from "../mapBuild/geometry";
import type { CollisionGrid } from "./collisionGrid";
import type { Point } from "./projection";

/** Crossing point of segments a–b and c–d, or `null` when they do not cross (parallel counts as no crossing). */
export function segmentIntersection(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
): Point | null {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const denominator = rx * sy - ry * sx;
  if (denominator === 0) return null;
  const qx = c[0] - a[0];
  const qy = c[1] - a[1];
  const t = (qx * sy - qy * sx) / denominator;
  const u = (qx * ry - qy * rx) / denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [a[0] + t * rx, a[1] + t * ry];
}

/** The crossing of from→to with a ring's edges that lies closest to `from`, or `null`. */
export function firstRingHit(
  from: Point,
  to: Point,
  ring: Point[],
): Point | null {
  let best: Point | null = null;
  let bestDistance = Infinity;
  for (let index = 0; index < ring.length; index++) {
    const hit = segmentIntersection(
      from,
      to,
      ring[index],
      ring[(index + 1) % ring.length],
    );
    if (!hit) continue;
    const distance = Math.hypot(hit[0] - from[0], hit[1] - from[1]);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = hit;
    }
  }
  return best;
}

/** First building outline crossed by from→to (water never stops bullets), or `null`. */
export function firstBuildingHit(
  collision: Pick<CollisionGrid, "query">,
  from: Point,
  to: Point,
): Point | null {
  let best: Point | null = null;
  let bestDistance = Infinity;
  for (const obstacle of collision.query(boundsOf([from, to]))) {
    if (obstacle.kind !== "building") continue;
    const hit = firstRingHit(from, to, obstacle.ring);
    if (!hit) continue;
    const distance = Math.hypot(hit[0] - from[0], hit[1] - from[1]);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = hit;
    }
  }
  return best;
}
