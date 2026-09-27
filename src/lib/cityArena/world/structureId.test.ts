import { describe, expect, it } from "vitest";
import type { Point } from "./projection";
import {
  MAX_STRUCTURE_HEALTH,
  MIN_STRUCTURE_HEALTH,
  structureIdOf,
  structureMaxHealth,
  structureTileOf,
} from "./structureId";

/** A square footprint `side` metres wide. */
function square(side: number): Point[] {
  return [
    [0, 0],
    [side, 0],
    [side, side],
    [0, side],
  ];
}

describe("structureIdOf", () => {
  it("round-trips through structureTileOf", () => {
    const id = structureIdOf(3, 5, 17);
    expect(structureTileOf(id)).toEqual({ tileX: 3, tileY: 5, index: 17 });
  });

  it("gives every piece of every tile its own id", () => {
    expect(structureIdOf(1, 0, 0)).not.toBe(structureIdOf(0, 1, 0));
    expect(structureIdOf(0, 0, 65535)).toBeLessThan(structureIdOf(1, 0, 0));
  });

  it.each([
    [64, 0, 0],
    [0, -1, 0],
    [0, 0, 65536],
    [0.5, 0, 0],
  ])("rejects tile (%d, %d) piece %d", (tileX, tileY, index) => {
    expect(() => structureIdOf(tileX, tileY, index)).toThrow(RangeError);
  });
});

describe("structureMaxHealth", () => {
  it("scales with footprint and storeys", () => {
    expect(structureMaxHealth(square(10), 2, false)).toBeCloseTo(240);
  });

  it("clamps a shed and a tower block", () => {
    expect(structureMaxHealth(square(2), 1, false)).toBe(MIN_STRUCTURE_HEALTH);
    expect(structureMaxHealth(square(100), 8, false)).toBe(
      MAX_STRUCTURE_HEALTH,
    );
  });

  it("counts a building without storeys as one", () => {
    expect(structureMaxHealth(square(10), 0, false)).toBeCloseTo(120);
  });

  it("never lets a landmark fall", () => {
    expect(structureMaxHealth(square(10), 2, true)).toBe(Infinity);
  });
});
