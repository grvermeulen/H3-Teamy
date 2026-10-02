import type { Point } from "../world/projection";
import { rectsIntersect, type Rect } from "./geometry";

/** Items bucketed by the grid cells their rectangles cover, for "what is near this point" lookups. */
export type GridIndex<T> = {
  insert(bounds: Rect, item: T): void;
  /** Every item whose rectangle comes within `radius` of `point`, each once. */
  near(point: Point, radius: number): T[];
};

/** Calls `visit` with the key of every cell `bounds` overlaps. */
function forEachCell(
  bounds: Rect,
  cellMetres: number,
  visit: (key: string) => void,
): void {
  for (
    let cellY = Math.floor(bounds.minY / cellMetres);
    cellY <= Math.floor(bounds.maxY / cellMetres);
    cellY++
  )
    for (
      let cellX = Math.floor(bounds.minX / cellMetres);
      cellX <= Math.floor(bounds.maxX / cellMetres);
      cellX++
    )
      visit(`${cellX}:${cellY}`);
}

/**
 * Creates an empty index with `cellMetres`-wide cells. Build-time only: the runtime has its own
 * spatial index in `world/collisionGrid.ts`, tied to decoded tiles.
 *
 * @param cellMetres - The cell size; a few times the typical query radius.
 * @returns The index.
 */
export function createGridIndex<T>(cellMetres: number): GridIndex<T> {
  const cells = new Map<string, { bounds: Rect; item: T }[]>();
  return {
    insert(bounds, item) {
      forEachCell(bounds, cellMetres, (key) => {
        const list = cells.get(key) ?? [];
        list.push({ bounds, item });
        cells.set(key, list);
      });
    },
    near(point, radius) {
      const probe: Rect = {
        minX: point[0] - radius,
        minY: point[1] - radius,
        maxX: point[0] + radius,
        maxY: point[1] + radius,
      };
      const found = new Set<T>();
      forEachCell(probe, cellMetres, (key) => {
        for (const entry of cells.get(key) ?? [])
          if (rectsIntersect(probe, entry.bounds)) found.add(entry.item);
      });
      return [...found];
    },
  };
}
