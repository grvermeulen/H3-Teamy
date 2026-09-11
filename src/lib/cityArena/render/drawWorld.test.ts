import { describe, expect, it } from "vitest";
import { createCamera } from "./camera";
import type { LandmarkLookup } from "./drawStatic";
import { CANOPY_LAYER } from "./drawScenery";
import { drawOverheadChunks, drawVisibleChunks } from "./drawWorld";
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
      overhead: createStaticRaster(() => null),
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
    const source = {
      raster,
      overhead: createStaticRaster(() => null),
      tiles: [],
      landmarks,
      loadedTileRects: [],
    };
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

  it("keeps a tile-less chunk hatched across repeated calls instead of rasterising it, and rasterises it once a tile is loaded", () => {
    const raster = createStaticRaster((width, height) =>
      createFakeTarget(width, height),
    );
    const camera = createCamera([0, 0], 4);
    const withoutTile = {
      raster,
      overhead: createStaticRaster(() => null),
      tiles: [],
      landmarks,
      loadedTileRects: [],
    };
    for (let call = 0; call < 5; call++) {
      const context = createFakeContext();
      const stats = drawVisibleChunks(context, camera, viewport, withoutTile);
      expect(stats.rasterised).toBe(false);
      expect(context.calls).toContain(`fill(${HATCH_BACKGROUND})`);
    }
    expect(raster.stats().chunks).toBe(0);

    const withTile = {
      raster,
      overhead: createStaticRaster(() => null),
      tiles: [],
      landmarks,
      loadedTileRects: [{ minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 }],
    };
    const stats = drawVisibleChunks(
      createFakeContext(),
      camera,
      viewport,
      withTile,
    );
    expect(stats.rasterised).toBe(true);
    expect(raster.stats().chunks).toBe(1);
  });

  it("clips the hatch to the chunk square so strokes cannot bleed into neighbours", () => {
    const raster = createStaticRaster(() => null);
    const source = {
      raster,
      overhead: createStaticRaster(() => null),
      tiles: [],
      landmarks,
      loadedTileRects: [],
    };
    const camera = createCamera([0, 0], 4);
    const chunkSizePx = 128 * camera.zoom;
    const context = createFakeContext();

    drawVisibleChunks(context, camera, viewport, source);

    const saveIndex = context.calls.indexOf("save()");
    const clipRectIndex = context.calls.indexOf(
      `rect(-384,-448,${chunkSizePx},${chunkSizePx})`,
    );
    const clipIndex = context.calls.indexOf("clip()");
    expect(saveIndex).toBe(0);
    expect(clipRectIndex).toBeGreaterThan(saveIndex);
    expect(clipIndex).toBe(clipRectIndex + 1);
    expect(context.calls).toContain("restore()");
  });
});

describe("drawOverheadChunks", () => {
  it("blits only the chunks a canopy reaches into, after rasterising one per call", () => {
    const tile = {
      x: 0,
      y: 0,
      rect: { minX: 0, minY: 0, maxX: 2000, maxY: 2000 },
      roads: [],
      buildings: [],
      ground: [],
      water: [],
      trees: [
        {
          point: [20, 20] as [number, number],
          size: 1 as const,
          bounds: { minX: 15, minY: 15, maxX: 25, maxY: 25 },
        },
      ],
      furniture: [],
    };
    const overhead = createStaticRaster(
      (width, height) => createFakeTarget(width, height),
      undefined,
      undefined,
      CANOPY_LAYER,
    );
    const source = {
      raster: createStaticRaster(() => null),
      overhead,
      tiles: [tile],
      landmarks,
      loadedTileRects: [tile.rect],
    };
    // The view spans the chunk with the tree and the empty one east of it.
    const camera = createCamera([128, 64], 4);
    const first = createFakeContext();
    expect(drawOverheadChunks(first, camera, viewport, source)).toBe(true);
    for (let step = 0; step < 8; step++)
      drawOverheadChunks(createFakeContext(), camera, viewport, source);
    const settled = createFakeContext();
    expect(drawOverheadChunks(settled, camera, viewport, source)).toBe(false);
    const draws = settled.calls.filter((call) => call.startsWith("drawImage("));
    expect(draws).toHaveLength(1);
    expect(overhead.stats().chunks).toBe(2);
    expect(overhead.stats().bytes).toBe(256 * 256 * 4);
  });
});
