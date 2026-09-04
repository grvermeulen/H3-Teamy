import { describe, expect, it } from "vitest";
import type { DecodedTile } from "./decode";
import { nearestRoadName } from "./nearestRoad";

const tile: DecodedTile = {
  x: 0,
  y: 0,
  rect: { minX: 0, minY: 0, maxX: 2000, maxY: 2000 },
  roads: [
    {
      points: [
        [0, 0],
        [100, 0],
      ],
      roadClass: "residential",
      name: "Herenstraat",
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 0 },
    },
    {
      points: [
        [0, 50],
        [100, 50],
      ],
      roadClass: "service",
      bounds: { minX: 0, minY: 50, maxX: 100, maxY: 50 },
    },
    {
      points: [
        [0, 500],
        [100, 500],
      ],
      roadClass: "primary",
      name: "Grebbeweg",
      bounds: { minX: 0, minY: 500, maxX: 100, maxY: 500 },
    },
  ],
  buildings: [],
  ground: [],
  water: [],
};

describe("nearestRoadName", () => {
  it("returns the closest named road within range, ignoring unnamed ones", () => {
    expect(nearestRoadName([tile], [50, 40])).toBe("Herenstraat");
    expect(nearestRoadName([tile], [50, 490], 30)).toBe("Grebbeweg");
    expect(nearestRoadName([tile], [50, 250], 30)).toBeNull();
  });
});
