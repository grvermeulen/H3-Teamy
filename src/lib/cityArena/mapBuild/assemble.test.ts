import { describe, expect, it } from "vitest";
import { assembleMap } from "./assemble";
import { MapBuildError } from "./errors";
import { MINI_LANDMARKS, overpassMini } from "./fixtures/overpassMini";

const input = {
  landmarkOsm: overpassMini,
  roadsOsm: overpassMini,
  areasOsm: overpassMini,
  buildingsOsm: overpassMini,
  config: MINI_LANDMARKS,
  generatedAt: "2026-09-03T12:00:00.000Z",
};

describe("assembleMap", () => {
  it("produces an index with four ordered zones and all landmarks", () => {
    const { index } = assembleMap(input);
    expect(index.version).toBe(1);
    expect(index.generatedAt).toBe("2026-09-03T12:00:00.000Z");
    expect(index.zones.map((zone) => zone.key)).toEqual([
      "rhenen",
      "wageningen",
      "campus",
      "bennekom",
    ]);
    expect(index.landmarks.map((landmark) => landmark.key).sort()).toEqual([
      "cunerakerk",
      "grote-kerk-wageningen",
      "onder-de-linden",
      "oude-kerk-bennekom",
      "wur-forum",
    ]);
    expect(index.zones[1].landmarks.sort()).toEqual([
      "grote-kerk-wageningen",
      "onder-de-linden",
    ]);
    expect(index.tileSize).toBe(8000);
    expect(index.tiles.length).toBeGreaterThan(0);
  });

  it("keeps large nearby buildings, drops sheds and far buildings, and attaches landmarks", () => {
    const { tiles } = assembleMap(input);
    const buildings = tiles.flatMap((tile) => tile.buildings);
    expect(buildings.length).toBeGreaterThanOrEqual(5);
    expect(buildings.every((building) => building.landmark !== undefined)).toBe(
      true,
    );
    const attachedLandmarks = new Set(
      buildings.map((building) => building.landmark),
    );
    expect([...attachedLandmarks].sort()).toEqual([
      "cunerakerk",
      "grote-kerk-wageningen",
      "onder-de-linden",
      "oude-kerk-bennekom",
      "wur-forum",
    ]);
    const church = buildings.find(
      (building) => building.landmark === "cunerakerk",
    );
    expect(church?.levels).toBe(4);
    expect(
      buildings
        .filter((building) => building.levels === 4)
        .every((building) => building.landmark === "cunerakerk"),
    ).toBe(true);
  });

  it("encodes the road graph and copies street names into tiles", () => {
    const { roads, tiles } = assembleMap(input);
    expect(roads.names).toContain("Dorpsstraat");
    expect(roads.names).toContain("Droevendaalsesteeg");
    expect(roads.edges.length % 6).toBe(0);
    const tileRoadNames = tiles.flatMap((tile) =>
      tile.roads.map((road) => road.name),
    );
    expect(tileRoadNames).toContain("Herenstraat");
  });

  it("places water and ground polygons", () => {
    const { tiles } = assembleMap(input);
    expect(tiles.some((tile) => tile.water.length > 0)).toBe(true);
    expect(
      tiles.some((tile) =>
        tile.ground.some((ground) => ground.kind === "field"),
      ),
    ).toBe(true);
  });

  it("throws a MapBuildError listing landmark problems", () => {
    const broken = {
      ...input,
      config: [
        ...MINI_LANDMARKS,
        {
          key: "ghost",
          name: "Ghost",
          nameMatch: "Spookhuis",
          style: "cafe" as const,
          matchesTags: () => true,
        },
      ],
    };
    expect(() => assembleMap(broken)).toThrow(MapBuildError);
    expect(() => assembleMap(broken)).toThrow(/ghost/);
  });
});
