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

/**
 * Closest point to `point` on segment a–b. Unlike `distancePointToSegment` in
 * `mapBuild/geometry.ts`, this returns the boundary point itself rather than a distance,
 * because callers need the actual coordinates to derive a push-out direction.
 */
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

/** Grid-cell key for one cell coordinate. */
function cellKey(cellX: number, cellY: number): string {
  return `${cellX}:${cellY}`;
}

/** Tile-bookkeeping key for one tile coordinate. */
function tileKey(x: number, y: number): string {
  return `${x}:${y}`;
}

/** Visits the key of every cell that `bounds` overlaps, using `Math.floor` bucketing so the
 * grid extends correctly into negative world coordinates. */
function forEachCell(
  bounds: Rect,
  cellMetres: number,
  visit: (key: string) => void,
): void {
  const minCellX = Math.floor(bounds.minX / cellMetres);
  const maxCellX = Math.floor(bounds.maxX / cellMetres);
  const minCellY = Math.floor(bounds.minY / cellMetres);
  const maxCellY = Math.floor(bounds.maxY / cellMetres);
  for (let cellY = minCellY; cellY <= maxCellY; cellY++)
    for (let cellX = minCellX; cellX <= maxCellX; cellX++)
      visit(cellKey(cellX, cellY));
}

/** Obstacle list for one decoded tile: its buildings and water, tagged by kind. */
function buildObstaclesForTile(tile: DecodedTile): Obstacle[] {
  return [
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
}

/** Adds one obstacle into every cell its bounding box overlaps. */
function insertObstacleIntoCells(
  cells: Map<string, Obstacle[]>,
  obstacle: Obstacle,
  cellMetres: number,
): void {
  forEachCell(obstacle.bounds, cellMetres, (key) => {
    const list = cells.get(key) ?? [];
    list.push(obstacle);
    cells.set(key, list);
  });
}

/** Removes a known set of obstacles from every cell they were inserted into. */
function removeObstaclesFromCells(
  cells: Map<string, Obstacle[]>,
  obstacles: Obstacle[],
  cellMetres: number,
): void {
  const removed = new Set(obstacles);
  for (const obstacle of obstacles) {
    forEachCell(obstacle.bounds, cellMetres, (key) => {
      const remaining = (cells.get(key) ?? []).filter(
        (entry) => !removed.has(entry),
      );
      if (remaining.length === 0) cells.delete(key);
      else cells.set(key, remaining);
    });
  }
}

/** Obstacles overlapping `rect`, deduplicated across the cells they span. */
function queryCells(
  cells: Map<string, Obstacle[]>,
  rect: Rect,
  cellMetres: number,
): Obstacle[] {
  const seen = new Set<Obstacle>();
  forEachCell(rect, cellMetres, (key) => {
    for (const obstacle of cells.get(key) ?? []) {
      if (rectsIntersect(rect, obstacle.bounds)) seen.add(obstacle);
    }
  });
  return [...seen];
}

/** Sum of obstacle counts across all registered tiles. */
function sumObstacleCounts(obstaclesByTile: Map<string, Obstacle[]>): number {
  return [...obstaclesByTile.values()].reduce(
    (total, list) => total + list.length,
    0,
  );
}

/** Cell-bucketed obstacle storage, keyed by both grid cell and source tile. */
type SpatialIndex = {
  insertTile(tile: DecodedTile): void;
  removeTile(x: number, y: number): void;
  query(rect: Rect): Obstacle[];
  obstacleCount(): number;
};

/**
 * Creates an empty spatial index with `cellMetres`-wide cells. `insertTile` is idempotent:
 * re-inserting a tile coordinate first removes its previous obstacles from the cell map so
 * stale entries never linger.
 */
function createSpatialIndex(cellMetres: number): SpatialIndex {
  const cells = new Map<string, Obstacle[]>();
  const obstaclesByTile = new Map<string, Obstacle[]>();

  return {
    insertTile(tile) {
      const key = tileKey(tile.x, tile.y);
      const existing = obstaclesByTile.get(key);
      if (existing) removeObstaclesFromCells(cells, existing, cellMetres);
      const obstacles = buildObstaclesForTile(tile);
      obstaclesByTile.set(key, obstacles);
      for (const obstacle of obstacles)
        insertObstacleIntoCells(cells, obstacle, cellMetres);
    },
    removeTile(x, y) {
      const key = tileKey(x, y);
      const obstacles = obstaclesByTile.get(key) ?? [];
      obstaclesByTile.delete(key);
      removeObstaclesFromCells(cells, obstacles, cellMetres);
    },
    query: (rect) => queryCells(cells, rect, cellMetres),
    obstacleCount: () => sumObstacleCounts(obstaclesByTile),
  };
}

const MAX_RESOLVE_PASSES = 3;

/**
 * Iteratively pushes a circle out of every obstacle in `index` that overlaps it, re-querying
 * after each pass so a push out of one obstacle can be resolved against its neighbours too.
 */
function resolveCircleAgainst(
  index: SpatialIndex,
  centre: Point,
  radius: number,
): Point {
  let position: Point = [centre[0], centre[1]];
  for (let pass = 0; pass < MAX_RESOLVE_PASSES; pass++) {
    const probe: Rect = {
      minX: position[0] - radius,
      minY: position[1] - radius,
      maxX: position[0] + radius,
      maxY: position[1] + radius,
    };
    let moved = false;
    for (const obstacle of index.query(probe)) {
      const pushed = pushCircleOutOfRing(position, radius, obstacle.ring);
      if (pushed) {
        position = pushed;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return position;
}

/** Creates an empty grid; tiles are inserted/removed as the loader streams them. */
export function createCollisionGrid(
  cellMetres = COLLISION_CELL_M,
): CollisionGrid {
  if (!Number.isFinite(cellMetres) || cellMetres <= 0) {
    throw new Error(
      `cellMetres must be a finite number greater than 0, got ${cellMetres}`,
    );
  }
  const index = createSpatialIndex(cellMetres);
  return {
    insertTile: index.insertTile,
    removeTile: index.removeTile,
    query: index.query,
    resolveCircle: (centre, radius) =>
      resolveCircleAgainst(index, centre, radius),
    obstacleCount: index.obstacleCount,
  };
}
