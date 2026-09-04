import {
  pointInPolygon,
  rectsIntersect,
  type Rect,
} from "../mapBuild/geometry";
import type { DecodedTile } from "./decode";
import type { Point } from "./projection";

/** Cell size of the uniform grid in metres. */
export const COLLISION_CELL_M = 16;

/** A solid polygon the player cannot enter. */
export type Obstacle = {
  ring: Point[];
  bounds: Rect;
  kind: "building" | "water";
};

/** Spatial index of obstacles from the loaded tiles. */
export type CollisionGrid = {
  insertTile(tile: DecodedTile): void;
  removeTile(x: number, y: number): void;
  query(rect: Rect): Obstacle[];
  resolveCircle(centre: Point, radius: number): Point;
  obstacleCount(): number;
};

/** Closest point to `point` on segment a–b. */
export function nearestPointOnSegment(point: Point, a: Point, b: Point): Point {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return [a[0], a[1]];
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared,
    ),
  );
  return [a[0] + t * dx, a[1] + t * dy];
}

/** Closest boundary point of a ring and its distance. */
export function nearestPointOnRing(
  point: Point,
  ring: Point[],
): { point: Point; distance: number } {
  let best: Point = ring[0];
  let bestDistance = Infinity;
  for (let index = 0; index < ring.length; index++) {
    const candidate = nearestPointOnSegment(
      point,
      ring[index],
      ring[(index + 1) % ring.length],
    );
    const distance = Math.hypot(
      candidate[0] - point[0],
      candidate[1] - point[1],
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return { point: best, distance: bestDistance };
}

/**
 * Moves a circle out of a ring: outside-but-overlapping circles slide away from the nearest
 * boundary point; circles whose centre is inside are ejected through the nearest edge.
 * Returns `null` when there is no overlap.
 */
export function pushCircleOutOfRing(
  centre: Point,
  radius: number,
  ring: Point[],
): Point | null {
  const inside = pointInPolygon(centre, ring);
  const nearest = nearestPointOnRing(centre, ring);
  if (!inside && nearest.distance >= radius) return null;
  const awayX = inside
    ? nearest.point[0] - centre[0]
    : centre[0] - nearest.point[0];
  const awayY = inside
    ? nearest.point[1] - centre[1]
    : centre[1] - nearest.point[1];
  const length = Math.hypot(awayX, awayY);
  const unitX = length === 0 ? 1 : awayX / length;
  const unitY = length === 0 ? 0 : awayY / length;
  return [nearest.point[0] + unitX * radius, nearest.point[1] + unitY * radius];
}

const MAX_RESOLVE_PASSES = 3;

/** Creates an empty grid; tiles are inserted/removed as the loader streams them. */
export function createCollisionGrid(
  cellMetres = COLLISION_CELL_M,
): CollisionGrid {
  const cells = new Map<string, Obstacle[]>();
  const obstaclesByTile = new Map<string, Obstacle[]>();
  const cellKey = (cx: number, cy: number): string => `${cx}:${cy}`;

  const forEachCell = (bounds: Rect, visit: (key: string) => void): void => {
    const minCx = Math.floor(bounds.minX / cellMetres);
    const maxCx = Math.floor(bounds.maxX / cellMetres);
    const minCy = Math.floor(bounds.minY / cellMetres);
    const maxCy = Math.floor(bounds.maxY / cellMetres);
    for (let cy = minCy; cy <= maxCy; cy++)
      for (let cx = minCx; cx <= maxCx; cx++) visit(cellKey(cx, cy));
  };

  const query = (rect: Rect): Obstacle[] => {
    const seen = new Set<Obstacle>();
    forEachCell(rect, (key) => {
      for (const obstacle of cells.get(key) ?? []) {
        if (rectsIntersect(rect, obstacle.bounds)) seen.add(obstacle);
      }
    });
    return [...seen];
  };

  return {
    insertTile(tile) {
      const obstacles: Obstacle[] = [
        ...tile.buildings.map((building) => ({
          ring: building.ring,
          bounds: building.bounds,
          kind: "building" as const,
        })),
        ...tile.water.map((water) => ({
          ring: water.ring,
          bounds: water.bounds,
          kind: "water" as const,
        })),
      ];
      obstaclesByTile.set(`${tile.x}:${tile.y}`, obstacles);
      for (const obstacle of obstacles) {
        forEachCell(obstacle.bounds, (key) => {
          const list = cells.get(key) ?? [];
          list.push(obstacle);
          cells.set(key, list);
        });
      }
    },
    removeTile(x, y) {
      const obstacles = obstaclesByTile.get(`${x}:${y}`) ?? [];
      obstaclesByTile.delete(`${x}:${y}`);
      const removed = new Set(obstacles);
      for (const obstacle of obstacles) {
        forEachCell(obstacle.bounds, (key) => {
          const remaining = (cells.get(key) ?? []).filter(
            (entry) => !removed.has(entry),
          );
          if (remaining.length === 0) cells.delete(key);
          else cells.set(key, remaining);
        });
      }
    },
    query,
    resolveCircle(centre, radius) {
      let position: Point = [centre[0], centre[1]];
      for (let pass = 0; pass < MAX_RESOLVE_PASSES; pass++) {
        const probe: Rect = {
          minX: position[0] - radius,
          minY: position[1] - radius,
          maxX: position[0] + radius,
          maxY: position[1] + radius,
        };
        let moved = false;
        for (const obstacle of query(probe)) {
          const pushed = pushCircleOutOfRing(position, radius, obstacle.ring);
          if (pushed) {
            position = pushed;
            moved = true;
          }
        }
        if (!moved) break;
      }
      return position;
    },
    obstacleCount: () =>
      [...obstaclesByTile.values()].reduce(
        (total, list) => total + list.length,
        0,
      ),
  };
}
