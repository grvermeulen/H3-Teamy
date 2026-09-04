import { describe, expect, it } from "vitest";
import { createCamera } from "./camera";
import type { LandmarkLookup } from "./drawStatic";
import { drawVisibleChunks } from "./drawWorld";
import { HATCH_BACKGROUND, PLACEHOLDER_FILL } from "./palette";
import { createStaticRaster } from "./staticRaster";
import { createFakeContext, createFakeTarget } from "./testing/fakeContext";

const landmarks: LandmarkLookup = new Map();
const viewport = { width: 256, height: 128 };

describe("drawVisibleChunks", () => {
  it("rasterises one chunk per call, blits ready chunks and draws placeholders for the rest", () => {
    const raster = createStaticRaster((width, height) =>
      createFakeTarget(width, height),
    );
    const source = {
      raster,
      tiles: [],
      landmarks,
      loadedTileRects: [{ minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 }],
    };
    const camera = createCamera([0, 0], 4);
    const context = createFakeContext();
    const first = drawVisibleChunks(context, camera, viewport, source);
    expect(first.rasterised).toBe(true);
    expect(
      context.calls.filter((call) => call.startsWith("drawImage(")).length,
    ).toBe(1);
    expect(
      context.calls.filter((call) => call === `fill(${PLACEHOLDER_FILL})`)
        .length,
    ).toBeGreaterThan(0);
    for (let step = 0; step < 4; step++)
      drawVisibleChunks(createFakeContext(), camera, viewport, source);
    const later = createFakeContext();
    const stats = drawVisibleChunks(later, camera, viewport, source);
    expect(stats).toEqual({ missing: 0, rasterised: false });
    expect(
      later.calls.filter((call) => call.startsWith("drawImage(")).length,
    ).toBe(4);
  });

  it("hatches areas where no tile is loaded", () => {
    const raster = createStaticRaster(() => null);
    const source = { raster, tiles: [], landmarks, loadedTileRects: [] };
    const context = createFakeContext();
    const stats = drawVisibleChunks(
      context,
      createCamera([0, 0], 4),
      viewport,
      source,
    );
    expect(stats.missing).toBe(4);
    expect(context.calls).toContain(`fill(${HATCH_BACKGROUND})`);
  });
});
