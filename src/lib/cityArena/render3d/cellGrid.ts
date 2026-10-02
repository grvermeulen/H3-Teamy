/**
 * The grid the 3D city streams in: 128 m square cells counted from the world origin, x east and
 * y south. Each map tile splits into cells; a cell is built, drawn and disposed as one unit.
 */
import type { Rect } from "../mapBuild/geometry";

/** Side of one cell, metres. */
export const CELL_M = 128;

/** A cell's column (east) and row (south) on the grid. */
export type CellCoord = { cx: number; cy: number };

/**
 * The cell holding a world point; a point on a cell's west or north edge belongs to that cell.
 *
 * @param x - Metres east.
 * @param y - Metres south.
 * @returns The cell's column and row.
 */
export function cellOf(x: number, y: number): CellCoord {
  return { cx: Math.floor(x / CELL_M), cy: Math.floor(y / CELL_M) };
}

/**
 * A cell's key for maps and sets.
 *
 * @param cell - The cell.
 * @returns `"cx,cy"`.
 */
export function cellKey(cell: CellCoord): string {
  return `${cell.cx},${cell.cy}`;
}

/**
 * A cell's rectangle in world metres.
 *
 * @param cell - The cell.
 * @returns Its bounds; the minimum edges belong to it, the maximum edges to its neighbours.
 */
export function cellRect(cell: CellCoord): Rect {
  const minX = cell.cx * CELL_M;
  const minY = cell.cy * CELL_M;
  return { minX, minY, maxX: minX + CELL_M, maxY: minY + CELL_M };
}

/**
 * How far a world point is from the nearest point of a cell.
 *
 * @param x - Metres east.
 * @param y - Metres south.
 * @param cell - The cell.
 * @returns Metres; 0 inside the cell or on its edge.
 */
export function distanceToCell(x: number, y: number, cell: CellCoord): number {
  const rect = cellRect(cell);
  const dx = Math.max(rect.minX - x, 0, x - rect.maxX);
  const dy = Math.max(rect.minY - y, 0, y - rect.maxY);
  return Math.hypot(dx, dy);
}

/** Distance from a point to a cell's centre. */
function centreDistance(x: number, y: number, cell: CellCoord): number {
  return Math.hypot((cell.cx + 0.5) * CELL_M - x, (cell.cy + 0.5) * CELL_M - y);
}

/**
 * Every cell reaching within `radius` of a point, nearest first: by distance to the cell's
 * centre, the cell under the point before any tie, then row and column, so the order is stable.
 *
 * @param x - Metres east.
 * @param y - Metres south.
 * @param radius - Metres; a cell counts when any part of it is this close.
 * @returns The cells, the one holding the point first.
 */
export function cellsWithin(x: number, y: number, radius: number): CellCoord[] {
  const first = cellOf(x - radius, y - radius);
  const last = cellOf(x + radius, y + radius);
  const home = cellKey(cellOf(x, y));
  const found: { cell: CellCoord; distance: number; home: boolean }[] = [];
  for (let cy = first.cy; cy <= last.cy; cy++) {
    for (let cx = first.cx; cx <= last.cx; cx++) {
      const cell = { cx, cy };
      if (distanceToCell(x, y, cell) > radius) continue;
      const isHome = cellKey(cell) === home;
      found.push({ cell, distance: centreDistance(x, y, cell), home: isHome });
    }
  }
  found.sort(
    (left, right) =>
      left.distance - right.distance ||
      Number(right.home) - Number(left.home) ||
      left.cell.cy - right.cell.cy ||
      left.cell.cx - right.cell.cx,
  );
  return found.map((entry) => entry.cell);
}

/**
 * The one cell that owns a piece of geometry: the cell holding the centre of its bounds. Each
 * piece has exactly one owner, so a ring spanning several cells is built once, not per cell.
 *
 * @param bounds - The geometry's bounding rectangle, metres.
 * @returns The owning cell.
 */
export function ownerCell(bounds: Rect): CellCoord {
  return cellOf(
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minY + bounds.maxY) / 2,
  );
}
