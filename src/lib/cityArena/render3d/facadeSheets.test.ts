import { describe, expect, it } from "vitest";
import { boundsOf } from "../mapBuild/geometry";
import type { DecodedBuilding } from "../world/decode";
import { squareRing } from "./testing/cityFixture";
import {
  FACADE_SHEETS,
  facadeFinishOf,
  facadeSheetOf,
  type FacadeFinish,
} from "./facadeSheets";

/** A square building of `side` metres at (x, y). */
function building(
  structureId: number,
  x: number,
  y: number,
  side: number,
  levels: number,
  landmark?: string,
): DecodedBuilding {
  const ring = squareRing(x, y, side);
  return { structureId, ring, bounds: boundsOf(ring), levels, landmark };
}

/** The sheets picked for many buildings of one size, spread over the town. */
function sheetsOf(side: number, levels: number): Set<number> {
  return new Set(
    Array.from({ length: 400 }, (_, id) =>
      facadeSheetOf(
        building(id, (id % 20) * 50, Math.floor(id / 20) * 50, side, levels),
      ),
    ),
  );
}

/** The finishes of a set of sheets. */
function finishes(sheets: Set<number>): Set<FacadeFinish> {
  return new Set([...sheets].map((sheet) => FACADE_SHEETS[sheet].finish));
}

describe("facadeSheetOf", () => {
  it("is a pure function of the building", () => {
    const house = building(4242, 10, 20, 9, 2);

    expect(facadeSheetOf(house)).toBe(facadeSheetOf({ ...house }));
    expect(facadeFinishOf(house)).toBe(facadeFinishOf({ ...house }));
  });

  it("spreads houses over every brick and plaster colourway", () => {
    const sheets = sheetsOf(9, 2);

    expect(finishes(sheets)).toEqual(new Set(["brick", "plaster"]));
    const expected = FACADE_SHEETS.flatMap((sheet, index) =>
      sheet.finish === "brick" || sheet.finish === "plaster" ? [index] : [],
    );
    expect([...sheets].sort((a, b) => a - b)).toEqual(expected);
  });

  it("clads towers in glass, panels or concrete and halls in panels or concrete", () => {
    expect(finishes(sheetsOf(30, 9))).toEqual(
      new Set(["glass", "panel", "concrete"]),
    );
    expect(finishes(sheetsOf(60, 2))).toEqual(new Set(["panel", "concrete"]));
  });

  it("uses every sheet somewhere in a varied town", () => {
    const all = new Set([
      ...sheetsOf(9, 2),
      ...sheetsOf(30, 9),
      ...sheetsOf(60, 2),
    ]);

    expect(all.size).toBe(FACADE_SHEETS.length);
  });

  it("lets most neighbours in one block share a colourway", () => {
    const row = Array.from({ length: 6 }, (_, index) =>
      building(9000 + index, 1 + index * 5, 1, 5, 2),
    );
    const sheets = row.map(facadeSheetOf);
    const counts = new Map<number, number>();
    for (const sheet of sheets) counts.set(sheet, (counts.get(sheet) ?? 0) + 1);

    expect(Math.max(...counts.values())).toBeGreaterThanOrEqual(3);
  });

  it("builds landmarks in red brick", () => {
    const church = building(77, 0, 0, 20, 3, "cunerakerk");

    expect(FACADE_SHEETS[facadeSheetOf(church)].key).toBe("brickRed");
  });
});
