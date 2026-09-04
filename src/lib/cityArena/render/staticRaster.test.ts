import { describe, expect, it } from "vitest";
import type { CanvasFactory } from "./canvasTypes";
import type { LandmarkLookup } from "./drawStatic";
import {
  CHUNK_METRES,
  chunkKey,
  chunkRect,
  chunksCovering,
  createStaticRaster,
} from "./staticRaster";
import { createFakeTarget } from "./testing/fakeContext";

const factory: CanvasFactory = (width, height) =>
  createFakeTarget(width, height);
const landmarks: LandmarkLookup = new Map();

describe("chunk geometry", () => {
  it("keys and rects chunks by zoom and coordinate", () => {
    expect(chunkKey({ zoom: 6, chunkX: -1, chunkY: 2 })).toBe("6:-1:2");
    expect(chunkRect({ zoom: 6, chunkX: -1, chunkY: 2 })).toEqual({
      minX: -128,
      minY: 256,
      maxX: 0,
      maxY: 384,
    });
  });

  it("lists covering chunks nearest to the centre first", () => {
    const coords = chunksCovering(
      { minX: 10, minY: 10, maxX: 300, maxY: 140 },
      4,
    );
    expect(coords).toHaveLength(6);
    expect(coords[0]).toEqual({ zoom: 4, chunkX: 1, chunkY: 0 });
    expect(coords.map((coord) => `${coord.chunkX}:${coord.chunkY}`)).toContain(
      "2:1",
    );
  });
});

describe("createStaticRaster", () => {
  it("rasterises a chunk once, sizes it by zoom and tracks bytes", () => {
    const raster = createStaticRaster(factory);
    const chunk = raster.ensureChunk(
      { zoom: 8, chunkX: 0, chunkY: 0 },
      [],
      landmarks,
    );
    expect(chunk?.target.width).toBe(CHUNK_METRES * 8);
    expect(chunk?.bytes).toBe(1024 * 1024 * 4);
    expect(
      raster.ensureChunk({ zoom: 8, chunkX: 0, chunkY: 0 }, [], landmarks),
    ).toBe(chunk);
    expect(raster.stats()).toEqual({ chunks: 1, bytes: 4194304 });
  });

  it("evicts the least recently used chunks beyond the byte budget", () => {
    const raster = createStaticRaster(factory, 2 * 512 * 512 * 4);
    raster.ensureChunk({ zoom: 4, chunkX: 0, chunkY: 0 }, [], landmarks);
    raster.ensureChunk({ zoom: 4, chunkX: 1, chunkY: 0 }, [], landmarks);
    raster.getChunk({ zoom: 4, chunkX: 0, chunkY: 0 });
    raster.ensureChunk({ zoom: 4, chunkX: 2, chunkY: 0 }, [], landmarks);
    expect(raster.getChunk({ zoom: 4, chunkX: 1, chunkY: 0 })).toBeUndefined();
    expect(raster.getChunk({ zoom: 4, chunkX: 0, chunkY: 0 })).toBeDefined();
    expect(raster.stats().chunks).toBe(2);
  });

  it("rasterises at most one needed chunk per call and drops chunks touching an invalidated rect", () => {
    const raster = createStaticRaster(factory);
    const needed = chunksCovering({ minX: 0, minY: 0, maxX: 200, maxY: 10 }, 4);
    expect(raster.rasterizeNext(needed, [], landmarks)).toBe(true);
    expect(raster.stats().chunks).toBe(1);
    expect(raster.rasterizeNext(needed, [], landmarks)).toBe(true);
    expect(raster.rasterizeNext(needed, [], landmarks)).toBe(false);
    raster.invalidateRect({ minX: 100, minY: 0, maxX: 300, maxY: 10 });
    expect(raster.stats().chunks).toBe(0);
  });

  it("returns null without crashing when the factory cannot create a context", () => {
    const raster = createStaticRaster(() => null);
    expect(
      raster.ensureChunk({ zoom: 4, chunkX: 0, chunkY: 0 }, [], landmarks),
    ).toBeNull();
    expect(
      raster.rasterizeNext([{ zoom: 4, chunkX: 0, chunkY: 0 }], [], landmarks),
    ).toBe(false);
  });

  it("disposes everything", () => {
    const raster = createStaticRaster(factory);
    raster.ensureChunk({ zoom: 4, chunkX: 0, chunkY: 0 }, [], landmarks);
    raster.dispose();
    expect(raster.stats()).toEqual({ chunks: 0, bytes: 0 });
  });
});
