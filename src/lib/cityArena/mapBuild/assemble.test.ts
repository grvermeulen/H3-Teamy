import { describe, expect, it } from "vitest";
import { assembleMap } from "./assemble";
import { MapBuildError } from "./errors";
import { MINI_LANDMARKS, overpassMini } from "./fixtures/overpassMini";
import type { LandmarkConfig } from "./landmarks.config";

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
    const result = assembleMap(input);
    const { index } = result;
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
      "vrije-slag",
      "wur-forum",
    ]);
    // The café is ~1.4 km from the Wageningen zone centre — outside the 500 m zone
    // disc, even though its building is kept (finding 2 attaches it regardless).
    expect(index.zones[1].landmarks.sort()).toEqual(["grote-kerk-wageningen"]);
    expect(index.tileSize).toBe(8000);
    expect(index.tiles.length).toBeGreaterThan(0);
    expect(result.unattachedLandmarks).toEqual([]);
  });

  it("keeps large nearby buildings, drops sheds and far buildings, and attaches landmarks", () => {
    const { tiles } = assembleMap(input);
    const buildings = tiles.flatMap((tile) => tile.buildings);
    expect(buildings.length).toBeGreaterThanOrEqual(6);
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
      "vrije-slag",
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

  it("keeps a landmark's building beyond the keep radius via attachment (finding 2)", () => {
    const { tiles } = assembleMap(input);
    const buildings = tiles.flatMap((tile) => tile.buildings);
    const cafe = buildings.find(
      (building) => building.landmark === "onder-de-linden",
    );
    expect(cafe).toBeDefined();
    expect(cafe?.points).toHaveLength(8); // a plain 20 m square, 4 points
  });

  it("gives a footprint-only landmark its own one-level building (finding 3)", () => {
    const { tiles } = assembleMap(input);
    const buildings = tiles.flatMap((tile) => tile.buildings);
    const pool = buildings.find(
      (building) => building.landmark === "vrije-slag",
    );
    expect(pool).toBeDefined();
    expect(pool?.levels).toBe(1);
    expect(pool?.points.length).toBeGreaterThanOrEqual(6); // >= 3 points
  });

  it("throws a MapBuildError when a zone-anchor landmark has no building", () => {
    const lonelyAnchor = {
      type: "node" as const,
      id: 900,
      lat: 51.9693,
      lon: 5.6656,
      tags: { name: "Lonely Anchor" },
    };
    const config: LandmarkConfig[] = MINI_LANDMARKS.map((landmark) =>
      landmark.key === "grote-kerk-wageningen"
        ? { ...landmark, nameMatch: "Lonely Anchor", matchesTags: () => true }
        : landmark,
    );
    const brokenInput = {
      landmarkOsm: { elements: [...overpassMini.elements, lonelyAnchor] },
      roadsOsm: { elements: [] },
      areasOsm: { elements: [] },
      buildingsOsm: { elements: [] },
      config,
      generatedAt: "2026-09-03T12:00:00.000Z",
    };
    expect(() => assembleMap(brokenInput)).toThrow(MapBuildError);
    expect(() => assembleMap(brokenInput)).toThrow(/grote-kerk-wageningen/);
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
