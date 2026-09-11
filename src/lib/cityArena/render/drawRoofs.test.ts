import { describe, expect, it } from "vitest";
import type { DecodedBuilding } from "../world/decode";
import {
  TILED_ROOF_MAX_AREA_M2,
  longestEdgeAngle,
  roofFill,
  roofKindOf,
  roofPatternMatrix,
  roofPatterns,
} from "./drawRoofs";
import { buildingFill } from "./palette";
import type { SurfaceTexture } from "./sprites";
import { createFakeContext } from "./testing/fakeContext";

/** A rectangle with its corner at (x, y), `long` metres along x and `short` across. */
function house(
  x: number,
  y: number,
  long: number,
  short: number,
  levels = 2,
): DecodedBuilding {
  const ring: DecodedBuilding["ring"] = [
    [x, y],
    [x + long, y],
    [x + long, y + short],
    [x, y + short],
  ];
  return {
    ring,
    bounds: { minX: x, minY: y, maxX: x + long, maxY: y + short },
    levels,
  };
}

const texture: SurfaceTexture = {
  image: document.createElement("canvas"),
  tileMetres: 8,
  tilePixels: 128,
};

describe("roofKindOf and longestEdgeAngle", () => {
  it("tiles the small and low, flattens the big or the tall", () => {
    expect(roofKindOf(house(0, 0, 12, 8))).toBe("tiles");
    expect(roofKindOf(house(0, 0, 12, 8, 4))).toBe("flat");
    expect(roofKindOf(house(0, 0, 40, 20))).toBe("flat");
    expect(roofKindOf(house(0, 0, TILED_ROOF_MAX_AREA_M2, 1))).toBe("tiles");
  });

  it("finds the ridge along the longest edge", () => {
    expect(longestEdgeAngle(house(0, 0, 12, 8).ring)).toBe(0);
    expect(longestEdgeAngle(house(0, 0, 8, 12).ring)).toBeCloseTo(Math.PI / 2);
  });
});

describe("roofPatternMatrix and roofFill", () => {
  it("scales the texture to its metres, turns it to the ridge and anchors it at the first corner", () => {
    expect(roofPatternMatrix(texture, house(10, 20, 12, 8).ring)).toEqual({
      a: 0.0625,
      b: 0,
      c: -0,
      d: 0.0625,
      e: 10,
      f: 20,
    });
    const turned = roofPatternMatrix(texture, house(0, 0, 8, 12).ring);
    expect(turned.a).toBeCloseTo(0);
    expect(turned.b).toBeCloseTo(0.0625);
  });

  it("hands each building its kind's pattern with its own transform, and the flat shade without art", () => {
    const context = createFakeContext();
    const patterns = roofPatterns(context, { tiles: texture, flat: texture });
    expect(
      context.calls.filter((call) => call.startsWith("createPattern(")),
    ).toHaveLength(2);
    expect(String(roofFill(house(0, 0, 12, 8), patterns))).toBe("pattern(#0)");
    expect(String(roofFill(house(0, 0, 40, 20), patterns))).toBe("pattern(#1)");
    expect(context.calls).toContain("patternTransform(pattern(#0),0.0625)");
    expect(roofFill(house(0, 0, 12, 8), roofPatterns(context, undefined))).toBe(
      buildingFill(2),
    );
    expect(roofFill(house(0, 0, 40, 20), { tiles: patterns.tiles })).toBe(
      buildingFill(2),
    );
  });
});
