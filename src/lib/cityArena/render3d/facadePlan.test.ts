import { describe, expect, it } from "vitest";
import { boundsOf } from "../mapBuild/geometry";
import type { DecodedBuilding, DecodedTile } from "../world/decode";
import type { RoadClass } from "../world/mapTypes";
import type { Point } from "../world/projection";
import { createCellContext, type CellContext } from "./cellContext";
import { gableOf, planBuilding, shopEdgesOf } from "./facadePlan";
import { FIXTURE_TILE_RECT, fixtureTile } from "./testing/cityFixture";
import { wallEdges } from "./wallQuads";

/** A rectangle footprint from (x, y), `width` along x and `depth` along y. */
function rect(x: number, y: number, width: number, depth: number): Point[] {
  return [
    [x, y],
    [x + width, y],
    [x + width, y + depth],
    [x, y + depth],
  ];
}

/** A building with a given id, footprint and storeys. */
function building(
  id: number,
  ring: Point[],
  levels = 2,
  landmark?: string,
): DecodedBuilding {
  return { structureId: id, ring, bounds: boundsOf(ring), levels, landmark };
}

/** A context over a tile holding one straight road along y = `roadY` and the given buildings. */
function street(
  roadClass: RoadClass,
  roadY: number,
  buildings: { ring: Point[]; levels: number; landmark?: string }[] = [],
): CellContext {
  const tile: DecodedTile = fixtureTile(
    { x: 0, y: 0, rect: FIXTURE_TILE_RECT },
    {
      roads: [
        {
          points: [
            [-300, roadY],
            [300, roadY],
          ],
          roadClass,
        },
      ],
      buildings,
    },
  );
  return createCellContext(
    { minX: -200, minY: -200, maxX: 200, maxY: 200 },
    [tile],
    new Set(),
  );
}

/** The outward normal's y of a building's edge by ring index. */
function edgeFacingY(house: DecodedBuilding, index: number): number {
  return wallEdges(house).find((edge) => edge.index === index)!.outward[1];
}

describe("gableOf", () => {
  const road = street("residential", 0);

  it("raises a street gable on about half of the narrow houses whose short end faces the street", () => {
    const row = Array.from({ length: 60 }, (_, index) =>
      building(1000 + index, rect(index * 6, 7, 6, 14)),
    );

    const gables = row
      .map((house) => gableOf(house, road))
      .filter((gable) => gable !== null);

    expect(gables.length).toBeGreaterThan(18);
    expect(gables.length).toBeLessThan(42);
    for (const gable of gables) expect(gable?.end).toBe(-1);
    expect(new Set(gables.map((gable) => gable?.kind))).toEqual(
      new Set(["step", "bell"]),
    );
  });

  it("gives no gable to wide houses, houses turned along the street, or tall ones", () => {
    const ids = Array.from({ length: 40 }, (_, index) => 2000 + index);

    for (const id of ids) {
      expect(gableOf(building(id, rect(0, 7, 10, 14)), road)).toBeNull();
      expect(gableOf(building(id, rect(0, 7, 14, 6)), road)).toBeNull();
      expect(gableOf(building(id, rect(0, 7, 6, 14), 4), road)).toBeNull();
    }
  });
});

describe("shopEdgesOf", () => {
  it("opens a shopfront only on the wall facing a main road", () => {
    const road = street("primary", 0);
    const shops = Array.from({ length: 10 }, (_, index) =>
      building(3000 + index, rect(index * 12, 7, 10, 10)),
    );

    for (const shop of shops) {
      const edges = [...shopEdgesOf(shop, road)];
      expect(edges).toHaveLength(1);
      expect(edgeFacingY(shop, edges[0])).toBeCloseTo(-1);
    }
  });

  it("keeps a quiet residential street's ground floors plain", () => {
    const road = street("residential", 0);

    expect(shopEdgesOf(building(4000, rect(0, 7, 10, 10)), road).size).toBe(0);
  });

  it("opens shopfronts on a quiet street near a landmark, but not far from one", () => {
    const church = { ring: rect(40, 20, 20, 30), levels: 3, landmark: "kerk" };
    const near = street("residential", 0, [church]);

    expect(shopEdgesOf(building(4001, rect(0, 7, 10, 10)), near).size).toBe(1);
    const far = street("residential", 0, [
      { ...church, ring: rect(180, 150, 10, 10) },
    ]);
    expect(shopEdgesOf(building(4001, rect(0, 7, 10, 10)), far).size).toBe(0);
  });

  it("never turns a wall away from the road, or one too far back, into a shopfront", () => {
    const road = street("primary", 0);

    expect(shopEdgesOf(building(4002, rect(0, 30, 10, 10)), road).size).toBe(0);
  });
});

describe("planBuilding", () => {
  const road = street("residential", 0);

  it("puts balconies on about half of the tall flats and on no house", () => {
    const flats = Array.from({ length: 40 }, (_, index) =>
      planBuilding(building(5000 + index, rect(0, 7, 24, 12), 5), road),
    );
    const houses = Array.from({ length: 40 }, (_, index) =>
      planBuilding(building(6000 + index, rect(0, 7, 8, 9), 2), road),
    );

    const withBalconies = flats.filter((plan) => plan.balconies).length;
    expect(withBalconies).toBeGreaterThan(10);
    expect(withBalconies).toBeLessThan(30);
    expect(houses.some((plan) => plan.balconies)).toBe(false);
  });

  it("is the same plan every time for the same building", () => {
    const house = building(7000, rect(0, 7, 6, 14));

    expect(planBuilding(house, road)).toEqual(planBuilding({ ...house }, road));
  });
});
