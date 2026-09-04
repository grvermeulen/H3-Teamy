import { describe, expect, it } from "vitest";
import { ArenaSettingsSchema, isMapTile, parseMapIndex } from "./schemas";

const validIndex = {
  version: 1,
  generatedAt: "2026-09-04T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: -26055, minY: -17692, maxX: 26055, maxY: 17692 },
  tileSize: 8000,
  tiles: [{ x: 0, y: 0, file: "tile_0_0.json", bytes: 10 }],
  zones: [
    {
      key: "wageningen",
      name: "Wageningen centrum",
      center: [10349, 6683],
      radius: 2000,
      spawnNodes: [[10000, 6000]],
      landmarks: ["grote-kerk-wageningen"],
    },
  ],
  landmarks: [
    {
      key: "grote-kerk-wageningen",
      name: "Grote Kerk",
      style: "church",
      center: [10349, 6683],
      tile: { x: 4, y: 3 },
    },
  ],
};

describe("parseMapIndex", () => {
  it("accepts a valid index", () => {
    expect(parseMapIndex(validIndex).zones[0].key).toBe("wageningen");
  });

  it("rejects a wrong version or a malformed zone", () => {
    expect(() => parseMapIndex({ ...validIndex, version: 2 })).toThrow();
    expect(() =>
      parseMapIndex({ ...validIndex, zones: [{ key: "mars" }] }),
    ).toThrow();
  });
});

describe("isMapTile", () => {
  it("guards the tile shape structurally", () => {
    expect(
      isMapTile({
        x: 1,
        y: 2,
        roads: [],
        buildings: [],
        ground: [],
        water: [],
      }),
    ).toBe(true);
    expect(isMapTile({ x: 1, y: 2, roads: [] })).toBe(false);
    expect(isMapTile(null)).toBe(false);
  });

  it("rejects non-object primitives", () => {
    expect(isMapTile(42)).toBe(false);
  });

  it("rejects geometry entries without numeric points arrays", () => {
    expect(
      isMapTile({
        x: 1,
        y: 2,
        roads: [{ points: "not-an-array" }],
        buildings: [],
        ground: [],
        water: [],
      }),
    ).toBe(false);
  });
});

describe("ArenaSettingsSchema", () => {
  it("fills defaults and rejects unknown zones", () => {
    expect(ArenaSettingsSchema.parse({})).toEqual({ lastZone: "wageningen" });
    expect(ArenaSettingsSchema.safeParse({ lastZone: "mars" }).success).toBe(
      false,
    );
  });
});
