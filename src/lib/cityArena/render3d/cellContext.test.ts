import { describe, expect, it } from "vitest";
import { createCellContext } from "./cellContext";
import {
  FIXTURE_TILE_RECT,
  fixtureTile,
  squareRing,
} from "./testing/cityFixture";
import { tileBuildingsIn, tileRoadsIn } from "./tileIndex";

/** A tile with a primary road along y = 0, a residential one along x = 60, a house and a church. */
function tile() {
  return fixtureTile(
    { x: 0, y: 0, rect: FIXTURE_TILE_RECT },
    {
      roads: [
        {
          points: [
            [-200, 0],
            [200, 0],
          ],
          roadClass: "primary",
        },
        {
          points: [
            [60, -200],
            [60, 200],
          ],
          roadClass: "residential",
        },
      ],
      buildings: [
        { ring: squareRing(10, 10, 10), levels: 2 },
        { ring: squareRing(-60, 20, 20), levels: 3, landmark: "kerk" },
      ],
    },
  );
}

describe("createCellContext", () => {
  const context = createCellContext(
    { minX: 0, minY: 0, maxX: 128, maxY: 128 },
    [tile()],
    new Set(),
  );

  it("finds the nearest road, or the nearest one a filter accepts", () => {
    const nearest = context.nearestRoad([55, 20], 30);
    const primary = context.nearestRoad(
      [55, 20],
      30,
      (road) => road.roadClass === "primary",
    );

    expect(nearest?.segment.road.roadClass).toBe("residential");
    expect(nearest?.distance).toBeCloseTo(5);
    expect(nearest?.closest[0]).toBeCloseTo(60);
    expect(nearest?.closest[1]).toBeCloseTo(20);
    expect(primary?.distance).toBeCloseTo(20);
    expect(context.nearestRoad([55, 40], 3)).toBeNull();
  });

  it("knows the carriageways, grown by a margin", () => {
    expect(context.onCarriageway([0, 4], 0)).toBe(true);
    expect(context.onCarriageway([0, 5], 0)).toBe(false);
    expect(context.onCarriageway([0, 5], 1)).toBe(true);
  });

  it("knows the footprints, grown by a margin, and forgets fallen ones", () => {
    expect(context.inFootprint([15, 15], 0)).toBe(true);
    expect(context.inFootprint([21, 15], 0)).toBe(false);
    expect(context.inFootprint([21, 15], 1.5)).toBe(true);
    const fallen = createCellContext(
      { minX: 0, minY: 0, maxX: 128, maxY: 128 },
      [tile()],
      new Set([tile().buildings[0].structureId]),
    );
    expect(fallen.inFootprint([15, 15], 0)).toBe(false);
  });

  it("lists the landmarks in reach by their centres", () => {
    expect(context.landmarks).toEqual([[-50, 30]]);
  });
});

describe("tile index", () => {
  it("finds exactly what a scan of the tile finds, in the tile's order", () => {
    const town = tile();
    const areas = [
      { minX: 0, minY: 0, maxX: 128, maxY: 128 },
      { minX: -100, minY: -10, maxX: -40, maxY: 60 },
      { minX: 500, minY: 500, maxX: 600, maxY: 600 },
    ];
    for (const area of areas) {
      const scanned = town.buildings.filter(
        (b) =>
          b.bounds.maxX >= area.minX &&
          b.bounds.minX <= area.maxX &&
          b.bounds.maxY >= area.minY &&
          b.bounds.minY <= area.maxY,
      );
      expect(tileBuildingsIn(town, area)).toEqual(scanned);
      expect(tileRoadsIn(town, area).length).toBeLessThanOrEqual(
        town.roads.length,
      );
    }
    expect(tileRoadsIn(town, areas[0])).toEqual(town.roads);
  });
});
