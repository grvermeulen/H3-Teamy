import { describe, expect, it } from "vitest";
import {
  CELL_M,
  cellKey,
  cellOf,
  cellRect,
  cellsWithin,
  distanceToCell,
  ownerCell,
} from "./cellGrid";

/** Distance from a point to a cell's centre. */
function centreDistance(x: number, y: number, cx: number, cy: number): number {
  return Math.hypot((cx + 0.5) * CELL_M - x, (cy + 0.5) * CELL_M - y);
}

describe("cellOf", () => {
  it("floors both axes to the 128 m grid, negatives included", () => {
    expect(cellOf(0, 0)).toEqual({ cx: 0, cy: 0 });
    expect(cellOf(127.9, 128)).toEqual({ cx: 0, cy: 1 });
    expect(cellOf(-0.1, -128.1)).toEqual({ cx: -1, cy: -2 });
  });

  it("keys a cell by its column and row", () => {
    expect(cellKey({ cx: -3, cy: 7 })).toBe("-3,7");
  });

  it("gives a cell's own rectangle in metres", () => {
    expect(cellRect({ cx: 1, cy: -1 })).toEqual({
      minX: CELL_M,
      minY: -CELL_M,
      maxX: 2 * CELL_M,
      maxY: 0,
    });
  });
});

describe("cellsWithin", () => {
  it("lists the cell under the point first, then the rest nearest first", () => {
    const cells = cellsWithin(0, 0, 200);

    expect(cells[0]).toEqual({ cx: 0, cy: 0 });
    const distances = cells.map((cell) =>
      centreDistance(0, 0, cell.cx, cell.cy),
    );
    for (let index = 1; index < distances.length; index++) {
      expect(distances[index]).toBeGreaterThanOrEqual(distances[index - 1]);
    }
  });

  it("holds every cell that reaches within the radius, each once", () => {
    const cells = cellsWithin(0, 0, 200);
    const keys = new Set(cells.map(cellKey));

    expect(keys.size).toBe(cells.length);
    for (const cell of cells)
      expect(distanceToCell(0, 0, cell)).toBeLessThanOrEqual(200);
    expect(keys.has("1,1")).toBe(true);
    expect(keys.has("-2,-2")).toBe(true);
    expect(keys.has("2,2")).toBe(false);
  });
});

describe("ownerCell", () => {
  it("gives a ring spanning two cells to exactly one of them", () => {
    const bounds = { minX: 100, minY: 10, maxX: 200, maxY: 40 };
    const candidates = [
      { cx: 0, cy: 0 },
      { cx: 1, cy: 0 },
    ];

    const owners = candidates.filter(
      (cell) => cellKey(ownerCell(bounds)) === cellKey(cell),
    );

    expect(owners).toEqual([{ cx: 1, cy: 0 }]);
  });
});
