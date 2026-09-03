import { describe, expect, it } from "vitest";
import { extractAreas, groundKindOf } from "./areas";
import type { OverpassJson } from "./osmTypes";

const sample: OverpassJson = {
  elements: [
    { type: "node", id: 1, lat: 51.98, lon: 5.625 },
    { type: "node", id: 2, lat: 51.98, lon: 5.6253 },
    { type: "node", id: 3, lat: 51.9802, lon: 5.6253 },
    { type: "node", id: 4, lat: 51.9802, lon: 5.625 },
    {
      type: "way",
      id: 100,
      nodes: [1, 2, 3, 4, 1],
      tags: { building: "yes", "building:levels": "3", name: "Grote Kerk" },
    },
    {
      type: "node",
      id: 5,
      lat: 51.9801,
      lon: 5.6251,
      tags: { amenity: "cafe", name: "Café Onder de Linden" },
    },
    { type: "node", id: 6, lat: 51.981, lon: 5.625 },
    { type: "way", id: 101, nodes: [4, 6], tags: { highway: "residential" } },
    { type: "node", id: 10, lat: 51.99, lon: 5.63 },
    { type: "node", id: 11, lat: 51.99, lon: 5.631 },
    { type: "node", id: 12, lat: 51.991, lon: 5.631 },
    { type: "node", id: 13, lat: 51.991, lon: 5.63 },
    { type: "way", id: 200, nodes: [10, 11, 12, 13, 10] },
    { type: "node", id: 20, lat: 51.9903, lon: 5.6303 },
    { type: "node", id: 21, lat: 51.9903, lon: 5.6306 },
    { type: "node", id: 22, lat: 51.9906, lon: 5.6306 },
    { type: "node", id: 23, lat: 51.9906, lon: 5.6303 },
    { type: "way", id: 201, nodes: [20, 21, 22, 23, 20] },
    {
      type: "relation",
      id: 300,
      members: [
        { type: "way", ref: 200, role: "outer" },
        { type: "way", ref: 201, role: "inner" },
      ],
      tags: { type: "multipolygon", natural: "water", name: "Plas" },
    },
    { type: "node", id: 30, lat: 51.95, lon: 5.6 },
    { type: "node", id: 31, lat: 51.95, lon: 5.601 },
    { type: "node", id: 32, lat: 51.951, lon: 5.601 },
    {
      type: "way",
      id: 400,
      nodes: [30, 31, 32, 30],
      tags: { landuse: "farmland" },
    },
    {
      type: "way",
      id: 401,
      nodes: [30, 31, 32, 30],
      tags: { building: "no", landuse: "grass" },
    },
  ],
};

describe("groundKindOf", () => {
  it("maps land use to ground kinds and ignores the rest", () => {
    expect(groundKindOf({ landuse: "grass" })).toBe("grass");
    expect(groundKindOf({ leisure: "park" })).toBe("grass");
    expect(groundKindOf({ landuse: "farmland" })).toBe("field");
    expect(groundKindOf({ landuse: "meadow" })).toBe("field");
    expect(groundKindOf({ landuse: "forest" })).toBe("forest");
    expect(groundKindOf({ natural: "wood" })).toBe("forest");
    expect(groundKindOf({ landuse: "residential" })).toBeNull();
  });
});

describe("extractAreas", () => {
  it("extracts building, water (outer ring only) and ground polygons; skips points and lines", () => {
    const areas = extractAreas(sample);
    expect(areas.buildings).toHaveLength(1);
    expect(areas.buildings[0]).toMatchObject({
      id: "way/100",
      tags: { "building:levels": "3" },
    });
    expect(areas.buildings[0].ring).toHaveLength(4);
    expect(areas.water).toHaveLength(1);
    expect(areas.water[0].id).toBe("relation/300");
    expect(areas.water[0].ring).toHaveLength(4);
    expect(areas.ground.map((ground) => ground.kind).sort()).toEqual([
      "field",
      "grass",
    ]);
  });

  it("treats building=no as not a building", () => {
    const areas = extractAreas(sample);
    expect(areas.buildings.some((building) => building.id === "way/401")).toBe(
      false,
    );
  });
});
