import { describe, expect, it } from "vitest";
import type { MapIndex, MapTile } from "./mapTypes";
import { decodeTile, flatUnitsToPoints, tileRectMetres } from "./decode";

const index: MapIndex = {
  version: 1,
  generatedAt: "2026-09-04T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: -26055, minY: -17692, maxX: 26055, maxY: 17692 },
  tileSize: 8000,
  tiles: [],
  zones: [],
  landmarks: [],
};

describe("decode", () => {
  it("converts flat units to metre points", () => {
    expect(flatUnitsToPoints([0, 0, 4, -8])).toEqual([
      [0, 0],
      [1, -2],
    ]);
  });

  it("computes a tile's own rectangle in metres from the index grid", () => {
    expect(tileRectMetres(0, 0, index)).toEqual({
      minX: -6513.75,
      minY: -4423,
      maxX: -4513.75,
      maxY: -2423,
    });
    expect(tileRectMetres(4, 2, index).minX).toBeCloseTo(1486.25);
  });

  it("decodes geometry with bounds", () => {
    const tile: MapTile = {
      x: 4,
      y: 2,
      roads: [
        {
          points: [8000, 8000, 8400, 8000],
          roadClass: "residential",
          name: "Dorpsstraat",
        },
      ],
      buildings: [
        {
          points: [8000, 8000, 8040, 8000, 8040, 8040, 8000, 8040],
          levels: 3,
          landmark: "grote-kerk-wageningen",
        },
      ],
      ground: [{ points: [0, 0, 400, 0, 400, 400], kind: "grass" }],
      water: [{ points: [0, 0, 40, 0, 40, 40] }],
    };
    const decoded = decodeTile(tile, index);
    expect(decoded.x).toBe(4);
    expect(decoded.roads[0].points).toEqual([
      [2000, 2000],
      [2100, 2000],
    ]);
    expect(decoded.roads[0].bounds).toEqual({
      minX: 2000,
      minY: 2000,
      maxX: 2100,
      maxY: 2000,
    });
    expect(decoded.buildings[0]).toMatchObject({
      levels: 3,
      landmark: "grote-kerk-wageningen",
    });
    expect(decoded.buildings[0].ring).toHaveLength(4);
    expect(decoded.ground[0].kind).toBe("grass");
    expect(decoded.water[0].ring[2]).toEqual([10, 10]);
    expect(decoded.rect).toEqual(tileRectMetres(4, 2, index));
  });
});
