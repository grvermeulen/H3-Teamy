import { describe, expect, it } from "vitest";
import { alignToRoad, furnitureKindOf, type RoadSegment } from "./furniture";
import { createGridIndex } from "./gridIndex";

describe("furnitureKindOf", () => {
  it("names lamps, benches and bus stops and nothing else", () => {
    expect(furnitureKindOf({ highway: "street_lamp" })).toBe("lamp");
    expect(furnitureKindOf({ amenity: "bench" })).toBe("bench");
    expect(furnitureKindOf({ highway: "bus_stop" })).toBe("busStop");
    expect(furnitureKindOf({ amenity: "cafe" })).toBeNull();
    expect(furnitureKindOf({})).toBeNull();
  });
});

describe("alignToRoad", () => {
  const roads = createGridIndex<RoadSegment>(64);
  const east: RoadSegment = { a: [0, 0], b: [100, 0], halfWidth: 3 };
  const north: RoadSegment = { a: [200, 100], b: [200, 0], halfWidth: 3 };
  roads.insert({ minX: 0, minY: 0, maxX: 100, maxY: 0 }, east);
  roads.insert({ minX: 200, minY: 0, maxX: 200, maxY: 100 }, north);

  it("turns furniture along the nearest road within reach, and leaves it at zero otherwise", () => {
    expect(alignToRoad([50, 4], roads)).toBe(0);
    expect(alignToRoad([196, 50], roads)).toBe(270);
    expect(alignToRoad([150, 4], roads)).toBe(0);
    expect(alignToRoad([150, 300], roads)).toBe(0);
    expect(alignToRoad([203, 60], roads)).toBe(270);
  });
});
