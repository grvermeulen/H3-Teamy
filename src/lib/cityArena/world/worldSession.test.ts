import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Rect } from "../mapBuild/geometry";
import type { LandmarkLookup } from "../render/drawStatic";
import { createFakeTarget } from "../render/testing/fakeContext";
import type { DecodedTile } from "./decode";
import { createMapLoader } from "./mapLoader";
import type { MapLoader } from "./mapLoader";
import type { MapIndex, MapRoads, MapTile } from "./mapTypes";
import type { Point } from "./projection";
import { createWorldSession } from "./worldSession";

const index: MapIndex = {
  version: 1,
  generatedAt: "2026-09-04T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: -8000, minY: -8000, maxX: 24000, maxY: 24000 },
  tileSize: 8000,
  tiles: [],
  zones: [],
  landmarks: [
    {
      key: "cunerakerk",
      name: "Cunerakerk",
      style: "church",
      center: [0, 0],
      tile: { x: 1, y: 1 },
    },
  ],
};
for (let y = 0; y < 4; y++)
  for (let x = 0; x < 4; x++)
    index.tiles.push({ x, y, file: `tile_${x}_${y}.json`, bytes: 1 });

function tile(x: number, y: number): MapTile {
  const building =
    x === 1 && y === 1
      ? [{ points: [40, 40, 80, 40, 80, 80, 40, 80], levels: 2 }]
      : [];
  return { x, y, roads: [], buildings: building, ground: [], water: [] };
}

const fetchImpl = vi.fn<typeof fetch>(async (input) => {
  const url = String(input);
  const body = url.endsWith("index.json")
    ? index
    : url.endsWith("roads.json")
      ? {
          nodes: [0, 0, 400, 0],
          edges: [0, 1, 0, -1, 0, 400],
          classes: ["residential"],
          names: [],
        }
      : (() => {
          const match = /tile_(\d+)_(\d+)\.json$/.exec(url);
          return match ? tile(Number(match[1]), Number(match[2])) : null;
        })();
  return new Response(JSON.stringify(body), { status: body ? 200 : 404 });
});

describe("createWorldSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads index and roads, syncs tiles into collision and raster, and exposes landmarks", async () => {
    const loader = createMapLoader({
      baseUrl: "/map",
      fetchImpl,
      sleep: async () => {},
    });
    const session = createWorldSession({
      loader,
      canvasFactory: (width, height) => createFakeTarget(width, height),
    });
    const ready = await session.ready();
    expect(ready.index.tiles).toHaveLength(16);
    expect(ready.graph.edges).toHaveLength(1);
    expect(session.landmarks().get("cunerakerk")).toEqual({
      name: "Cunerakerk",
      style: "church",
    });
    const onProgress = vi.fn();
    const progress = await session.update([0, 0], onProgress);
    expect(progress).toEqual({ loaded: 9, total: 9 });
    expect(session.tiles()).toHaveLength(9);
    expect(session.collision.obstacleCount()).toBe(1);
    expect(session.loadedTileRects()).toHaveLength(9);
    expect(onProgress).toHaveBeenCalledWith({ loaded: 9, total: 9 });
    const invalidate = vi.spyOn(session.raster, "invalidateRect");
    await session.update([4000, 4000]);
    expect(session.tiles()).toHaveLength(9);
    expect(session.collision.obstacleCount()).toBe(1);
    expect(invalidate).toHaveBeenCalled();
    session.dispose();
    expect(session.tiles()).toHaveLength(0);
  });

  it("sizes the raster's eviction budget from rasterBudgetBytes", async () => {
    const loader = createMapLoader({
      baseUrl: "/map",
      fetchImpl,
      sleep: async () => {},
    });
    const budgetBytes = 2 * 512 * 512 * 4; // room for exactly two zoom-4 chunks
    const session = createWorldSession({
      loader,
      canvasFactory: (width, height) => createFakeTarget(width, height),
      rasterBudgetBytes: budgetBytes,
    });
    await session.ready();

    const landmarks: LandmarkLookup = new Map();
    session.raster.ensureChunk(
      { zoom: 4, chunkX: 0, chunkY: 0 },
      [],
      landmarks,
    );
    session.raster.ensureChunk(
      { zoom: 4, chunkX: 1, chunkY: 0 },
      [],
      landmarks,
    );
    session.raster.ensureChunk(
      { zoom: 4, chunkX: 2, chunkY: 0 },
      [],
      landmarks,
    );

    expect(session.raster.stats().bytes).toBeLessThanOrEqual(budgetBytes);
    expect(
      session.raster.getChunk({ zoom: 4, chunkX: 0, chunkY: 0 }),
    ).toBeUndefined();
    session.dispose();
  });
});

/** Minimal empty index; the fake loader below ignores it beyond what ready() decodes. */
const emptyIndex: MapIndex = {
  version: 1,
  generatedAt: "2026-09-04T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: 0, minY: 0, maxX: 8000, maxY: 8000 },
  tileSize: 8000,
  tiles: [],
  zones: [],
  landmarks: [],
};

/** Empty road graph payload; decodes to zero nodes and edges without throwing. */
const emptyRoads: MapRoads = { nodes: [], edges: [], classes: [], names: [] };

/** Bounding rectangle of a ring, matching how decode.ts computes one. */
function boundsOfRing(ring: Point[]): Rect {
  return {
    minX: Math.min(...ring.map((point) => point[0])),
    minY: Math.min(...ring.map((point) => point[1])),
    maxX: Math.max(...ring.map((point) => point[0])),
    maxY: Math.max(...ring.map((point) => point[1])),
  };
}

/** A decoded tile at 2 km grid coordinate (x, y), with a small square building when requested. */
function decodedTile(x: number, y: number, withBuilding: boolean): DecodedTile {
  const rect: Rect = {
    minX: x * 2000,
    minY: y * 2000,
    maxX: (x + 1) * 2000,
    maxY: (y + 1) * 2000,
  };
  const ring: Point[] = [
    [rect.minX + 10, rect.minY + 10],
    [rect.minX + 30, rect.minY + 10],
    [rect.minX + 30, rect.minY + 30],
    [rect.minX + 10, rect.minY + 30],
  ];
  return {
    x,
    y,
    rect,
    roads: [],
    buildings: withBuilding
      ? [{ ring, bounds: boundsOfRing(ring), levels: 2 }]
      : [],
    ground: [],
    water: [],
  };
}

/** A MapLoader double whose resident tiles and change notifications are controlled by the test. */
type FakeLoader = MapLoader & {
  setLoadedTiles(tiles: DecodedTile[]): void;
  emitChange(): void;
};

/** Creates a fake loader: ensureTilesAround reports whatever setLoadedTiles last set. */
function createFakeLoader(): FakeLoader {
  let loadedTiles: DecodedTile[] = [];
  const listeners = new Set<() => void>();
  return {
    loadIndex: async () => emptyIndex,
    loadRoads: async () => emptyRoads,
    ensureTilesAround: async () => ({
      loaded: loadedTiles.length,
      total: loadedTiles.length,
    }),
    getTile: (x, y) =>
      loadedTiles.find((candidate) => candidate.x === x && candidate.y === y),
    getLoadedTiles: () => loadedTiles,
    hasFailures: () => false,
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: vi.fn(),
    setLoadedTiles(tiles) {
      loadedTiles = tiles;
    },
    emitChange() {
      for (const listener of listeners) listener();
    },
  };
}

describe("createWorldSession with a controllable fake loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retries ready() after a rejected load instead of caching the rejection", async () => {
    const loader = createFakeLoader();
    loader.loadIndex = vi
      .fn<() => Promise<typeof emptyIndex>>()
      .mockRejectedValueOnce(new Error("index unavailable"))
      .mockResolvedValue(emptyIndex);
    const session = createWorldSession({
      loader,
      canvasFactory: (width, height) => createFakeTarget(width, height),
    });

    await expect(session.ready()).rejects.toThrow("index unavailable");
    await expect(session.ready()).resolves.toMatchObject({ index: emptyIndex });
    expect(session.index()).toBe(emptyIndex);
    expect(loader.loadIndex).toHaveBeenCalledTimes(2);
  });

  it("inserts and removes obstacles with concrete counts as resident tiles change", async () => {
    const loader = createFakeLoader();
    const tileA = decodedTile(0, 0, true);
    const tileB = decodedTile(1, 0, false);
    loader.setLoadedTiles([tileA, tileB]);
    const session = createWorldSession({
      loader,
      canvasFactory: (width, height) => createFakeTarget(width, height),
    });
    await session.ready();
    const insertTile = vi.spyOn(session.collision, "insertTile");
    const removeTile = vi.spyOn(session.collision, "removeTile");
    const invalidateRect = vi.spyOn(session.raster, "invalidateRect");

    const progress = await session.update([0, 0]);

    expect(progress).toEqual({ loaded: 2, total: 2 });
    expect(insertTile).toHaveBeenCalledTimes(2);
    expect(removeTile).not.toHaveBeenCalled();
    expect(invalidateRect).toHaveBeenCalledTimes(2);
    expect(session.tiles()).toHaveLength(2);
    expect(session.collision.obstacleCount()).toBe(1);
    expect(session.loadedTileRects()).toHaveLength(2);
    expect(session.hasFailures()).toBe(false);

    loader.setLoadedTiles([tileB]);
    loader.emitChange();

    expect(removeTile).toHaveBeenCalledTimes(1);
    expect(removeTile).toHaveBeenLastCalledWith(tileA.x, tileA.y);
    expect(insertTile).toHaveBeenCalledTimes(2);
    expect(invalidateRect).toHaveBeenCalledTimes(3);
    expect(session.tiles()).toHaveLength(1);
    expect(session.collision.obstacleCount()).toBe(0);

    session.dispose();
  });

  it("disposes by unsubscribing the loader listener and disposing the raster and the loader", async () => {
    const loader = createFakeLoader();
    const tileA = decodedTile(2, 2, true);
    loader.setLoadedTiles([tileA]);
    const session = createWorldSession({
      loader,
      canvasFactory: (width, height) => createFakeTarget(width, height),
    });
    await session.ready();
    await session.update([4000, 4000]);
    expect(session.tiles()).toHaveLength(1);
    expect(session.collision.obstacleCount()).toBe(1);

    const removeTile = vi.spyOn(session.collision, "removeTile");
    const insertTile = vi.spyOn(session.collision, "insertTile");
    const rasterDispose = vi.spyOn(session.raster, "dispose");

    session.dispose();

    expect(removeTile).toHaveBeenCalledTimes(1);
    expect(removeTile).toHaveBeenCalledWith(tileA.x, tileA.y);
    expect(rasterDispose).toHaveBeenCalledTimes(1);
    expect(loader.dispose).toHaveBeenCalledTimes(1);
    expect(session.tiles()).toHaveLength(0);

    const tileB = decodedTile(5, 5, false);
    loader.setLoadedTiles([tileB]);
    loader.emitChange();

    expect(insertTile).not.toHaveBeenCalled();
    expect(session.tiles()).toHaveLength(0);
  });

  it("throws from index() and graph() until ready() resolves, then returns the loaded values", async () => {
    const loader = createFakeLoader();
    const session = createWorldSession({
      loader,
      canvasFactory: (width, height) => createFakeTarget(width, height),
    });

    expect(() => session.index()).toThrow(/not ready/i);
    expect(() => session.graph()).toThrow(/not ready/i);

    const ready = await session.ready();

    expect(session.index()).toBe(ready.index);
    expect(session.graph()).toBe(ready.graph);
    session.dispose();
  });
});
