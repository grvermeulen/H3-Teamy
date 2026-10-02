import { describe, expect, it } from "vitest";
import {
  MAP_BBOX,
  MAP_ORIGIN,
  fromUnits,
  projectLonLat,
  toUnits,
  unprojectXY,
} from "./projection";

describe("projection", () => {
  it("maps the origin to (0, 0)", () => {
    expect(projectLonLat(MAP_ORIGIN.lon, MAP_ORIGIN.lat)).toEqual([0, 0]);
  });

  it("projects latitude using the WGS84 degree length at the origin (north is negative y)", () => {
    const [x, y] = projectLonLat(MAP_ORIGIN.lon, MAP_ORIGIN.lat + 0.04);
    expect(x).toBe(0);
    expect(y).toBeLessThan(0);
    expect(Math.abs(y - -4450.7)).toBeLessThan(1);
  });

  it("projects longitude using the WGS84 degree length at the origin", () => {
    const [x] = projectLonLat(MAP_ORIGIN.lon + 0.1, MAP_ORIGIN.lat);
    expect(Math.abs(x - 6870)).toBeLessThan(5);
  });

  it("round-trips through unprojectXY", () => {
    const [x, y] = projectLonLat(MAP_BBOX.east, MAP_BBOX.south);
    const { lon, lat } = unprojectXY(x, y);
    expect(Math.abs(lon - MAP_BBOX.east)).toBeLessThan(1e-9);
    expect(Math.abs(lat - MAP_BBOX.south)).toBeLessThan(1e-9);
  });

  it("quantises to 0.25 m units and back", () => {
    expect(toUnits(1)).toBe(4);
    expect(toUnits(0.3)).toBe(1);
    expect(toUnits(-0.6)).toBe(-2);
    expect(fromUnits(4)).toBe(1);
  });
});
