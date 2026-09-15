import { describe, expect, it } from "vitest";
import type { DecodedBuilding, DecodedTile } from "../world/decode";
import {
  buildingVariant,
  paintHouseGardens,
  paintMeadowDetails,
  paintNeighbourhoodRoof,
} from "./drawNeighbourhood";
import { createFakeContext } from "./testing/fakeContext";

const house: DecodedBuilding = {
  ring: [
    [10, 10],
    [22, 10],
    [22, 18],
    [10, 18],
  ],
  bounds: { minX: 10, minY: 10, maxX: 22, maxY: 18 },
  levels: 2,
};
const chunk = { minX: 0, minY: 0, maxX: 64, maxY: 64 };
const tile: DecodedTile = {
  x: 0,
  y: 0,
  rect: chunk,
  buildings: [house],
  ground: [],
  roads: [],
  water: [],
  furniture: [],
  trees: [],
};

describe("neighbourhood decoration", () => {
  it("preserves authored landmarks and excludes distant gardens", () => {
    const ctx = createFakeContext();
    const landmark = { ...house, landmark: "cunerakerk" };
    paintHouseGardens(ctx, [{ ...tile, buildings: [landmark] }], chunk);
    paintNeighbourhoodRoof(ctx, landmark);
    paintHouseGardens(ctx, [tile], {
      minX: 100,
      minY: 100,
      maxX: 128,
      maxY: 128,
    });
    expect(ctx.calls).toEqual([]);
  });

  it("keeps the garden visible when only its apron overlaps a chunk", () => {
    const ctx = createFakeContext();
    paintHouseGardens(ctx, [tile], { minX: 10, minY: 7, maxX: 22, maxY: 9 });
    expect(ctx.calls.some((call) => call.startsWith("fillRect("))).toBe(true);
  });

  it("keeps house variants and painted details stable when tile order changes", () => {
    const other = {
      ...house,
      bounds: { minX: 32, minY: 32, maxX: 44, maxY: 40 },
    };
    const before = buildingVariant(house);
    buildingVariant(other);
    expect(buildingVariant(house)).toBe(before);
    const a = createFakeContext();
    const b = createFakeContext();
    paintNeighbourhoodRoof(a, house);
    paintNeighbourhoodRoof(b, other);
    b.calls.length = 0;
    paintNeighbourhoodRoof(b, house);
    expect(b.calls).toEqual(a.calls);
  });

  it("clips both roof styles to the footprint and distinguishes tall buildings", () => {
    const tiled = createFakeContext();
    const flat = createFakeContext();
    paintNeighbourhoodRoof(tiled, house);
    paintNeighbourhoodRoof(flat, { ...house, levels: 6 });
    for (const ctx of [tiled, flat]) {
      expect(ctx.calls.indexOf("clip()")).toBeLessThan(
        ctx.calls.findIndex((call) => call.startsWith("fillRect(")),
      );
      expect(ctx.calls).toContain("closePath()");
    }
    expect(tiled.calls).not.toEqual(flat.calls);
  });

  it("clips vegetation detail to its area and distinguishes crops from grass", () => {
    const grass = createFakeContext();
    const field = createFakeContext();
    for (const [kind, ctx] of [
      ["grass", grass],
      ["field", field],
    ] as const) {
      paintMeadowDetails(
        ctx,
        [{ ...tile, ground: [{ ...house, kind }] }],
        chunk,
      );
      expect(ctx.calls).toContain("clip()");
      expect(ctx.calls.some((call) => call.startsWith("fillRect("))).toBe(true);
    }
    expect(field.calls).not.toEqual(grass.calls);
  });

  it("omits vegetation details from urban ground and distant chunks", () => {
    const ctx = createFakeContext();
    paintMeadowDetails(
      ctx,
      [{ ...tile, ground: [{ ...house, kind: "urban" }] }],
      chunk,
    );
    paintMeadowDetails(
      ctx,
      [{ ...tile, ground: [{ ...house, kind: "grass" }] }],
      { minX: 100, minY: 100, maxX: 128, maxY: 128 },
    );
    expect(ctx.calls).toEqual([]);
  });
});
