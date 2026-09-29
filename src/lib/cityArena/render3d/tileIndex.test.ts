import { describe, expect, it } from "vitest";
import { rectsIntersect, type Rect } from "../mapBuild/geometry";
import { fixtureTown } from "./testing/cityFixture";
import { tileBuildingsIn, tileGroundIn, tileRoadsIn } from "./tileIndex";

/** Areas across the fixture town: a cell, a corner, a strip and one far outside. */
const AREAS: Rect[] = [
  { minX: 0, minY: 0, maxX: 64, maxY: 64 },
  { minX: -80, minY: -80, maxX: 10, maxY: 10 },
  { minX: -200, minY: 30, maxX: 400, maxY: 60 },
  { minX: 5000, minY: 5000, maxX: 5100, maxY: 5100 },
];

describe("tileIndex", () => {
  it.each(AREAS)(
    "finds exactly what a full scan finds, in the tile's order (%o)",
    (area) => {
      const tile = fixtureTown();
      const scan = <T extends { bounds: Rect }>(items: readonly T[]): T[] =>
        items.filter((item) => rectsIntersect(item.bounds, area));

      expect(tileGroundIn(tile, area)).toEqual(scan(tile.ground));
      expect(tileRoadsIn(tile, area)).toEqual(scan(tile.roads));
      expect(tileBuildingsIn(tile, area)).toEqual(scan(tile.buildings));
    },
  );

  it("has ground to find in the fixture", () => {
    const tile = fixtureTown();

    expect(tile.ground.length).toBeGreaterThan(0);
    expect(tileGroundIn(tile, tile.rect).length).toBe(tile.ground.length);
  });
});
