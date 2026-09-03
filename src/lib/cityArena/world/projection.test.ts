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

  it("maps one hundredth of a degree north to about −1105.7 m (north is negative y)", () => {
    const [x, y] = projectLonLat(MAP_ORIGIN.lon, MAP_ORIGIN.lat + 0.01);
    expect(x).toBe(0);
    expect(Math.abs(y - -1105.74)).toBeLessThan(0.01);
  });

  it("scales longitude by cos(lat0)", () => {
    const [x] = projectLonLat(MAP_ORIGIN.lon + 0.01, MAP_ORIGIN.lat);
    expect(Math.abs(x - 685.9)).toBeLessThan(1);
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
