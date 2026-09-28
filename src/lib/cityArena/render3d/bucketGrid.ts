/**
 * A plain bucket grid over a rectangle: each item goes into every bucket its bounds touch, and a
 * query visits the buckets around a point or across a rectangle. The city's builders use it to ask
 * about their surroundings without scanning whole 2 km tiles.
 */
import { rectsIntersect, type Rect } from "../mapBuild/geometry";
import type { Point } from "../world/projection";

/** Items bucketed over a rectangle; items reaching outside it live in `outside`. */
export type BucketGrid<T> = {
  rect: Rect;
  bucket: number;
  cols: number;
  rows: number;
  buckets: T[][];
  outside: T[];
};

/**
 * An empty grid.
 *
 * @param rect - The area it covers.
 * @param bucket - Side of a bucket, metres.
 * @returns The grid.
 */
export function createBucketGrid<T>(rect: Rect, bucket: number): BucketGrid<T> {
  const cols = Math.max(1, Math.ceil((rect.maxX - rect.minX) / bucket));
  const rows = Math.max(1, Math.ceil((rect.maxY - rect.minY) / bucket));
  const buckets = Array.from({ length: cols * rows }, (): T[] => []);
  return { rect, bucket, cols, rows, buckets, outside: [] };
}

/** The bucket columns and rows a rectangle touches, clamped to the grid. */
function span<T>(
  grid: BucketGrid<T>,
  bounds: Rect,
): [number, number, number, number] {
  const col = (x: number): number =>
    Math.min(
      grid.cols - 1,
      Math.max(0, Math.floor((x - grid.rect.minX) / grid.bucket)),
    );
  const row = (y: number): number =>
    Math.min(
      grid.rows - 1,
      Math.max(0, Math.floor((y - grid.rect.minY) / grid.bucket)),
    );
  return [
    col(bounds.minX),
    row(bounds.minY),
    col(bounds.maxX),
    row(bounds.maxY),
  ];
}

/**
 * Adds an item to every bucket its bounds touch; one wholly outside the grid goes to `outside`.
 *
 * @param grid - The grid.
 * @param item - The item.
 * @param bounds - Its bounds.
 */
export function insertItem<T>(
  grid: BucketGrid<T>,
  item: T,
  bounds: Rect,
): void {
  if (!rectsIntersect(bounds, grid.rect)) {
    grid.outside.push(item);
    return;
  }
  const [c0, r0, c1, r1] = span(grid, bounds);
  for (let row = r0; row <= r1; row++)
    for (let col = c0; col <= c1; col++)
      grid.buckets[row * grid.cols + col].push(item);
}

/**
 * Visits the items of every bucket a rectangle touches, then those outside the grid. An item
 * spanning several buckets is visited once per bucket.
 *
 * @param grid - The grid.
 * @param area - The rectangle.
 * @param visit - Called per item.
 */
export function visitArea<T>(
  grid: BucketGrid<T>,
  area: Rect,
  visit: (item: T) => void,
): void {
  if (rectsIntersect(area, grid.rect)) {
    const [c0, r0, c1, r1] = span(grid, area);
    for (let row = r0; row <= r1; row++)
      for (let col = c0; col <= c1; col++)
        for (const item of grid.buckets[row * grid.cols + col]) visit(item);
  }
  for (const item of grid.outside) visit(item);
}

/**
 * Visits the items of every bucket within `radius` of a point (see {@link visitArea}).
 *
 * @param grid - The grid.
 * @param point - The point.
 * @param radius - How far round it, metres.
 * @param visit - Called per item.
 */
export function visitNear<T>(
  grid: BucketGrid<T>,
  [x, y]: Point,
  radius: number,
  visit: (item: T) => void,
): void {
  visitArea(
    grid,
    { minX: x - radius, minY: y - radius, maxX: x + radius, maxY: y + radius },
    visit,
  );
}

/**
 * A rectangle grown by a margin on every side.
 *
 * @param rect - The rectangle.
 * @param margin - Metres.
 * @returns The grown rectangle.
 */
export function grownRect(rect: Rect, margin: number): Rect {
  return {
    minX: rect.minX - margin,
    minY: rect.minY - margin,
    maxX: rect.maxX + margin,
    maxY: rect.maxY + margin,
  };
}
