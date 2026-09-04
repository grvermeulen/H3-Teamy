import * as Sentry from "@sentry/nextjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MapIndex, MapTile } from "./mapTypes";
import { createMapLoader, tileCoordForMetres } from "./mapLoader";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const index: MapIndex = {
  version: 1,
  generatedAt: "2026-09-04T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: -8000, minY: -8000, maxX: 24000, maxY: 24000 },
  tileSize: 8000,
  tiles: [],
  zones: [],
  landmarks: [],
};
for (let y = 0; y < 4; y++)
  for (let x = 0; x < 4; x++)
    index.tiles.push({ x, y, file: `tile_${x}_${y}.json`, bytes: 1 });

function tile(x: number, y: number): MapTile {
  return { x, y, roads: [], buildings: [], ground: [], water: [] };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function routedFetch(
  failures: Record<string, number> = {},
): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    const remaining = failures[url] ?? 0;
    if (remaining > 0) {
      failures[url] = remaining - 1;
      return jsonResponse({ error: "busy" }, 503);
    }
    if (url.endsWith("/index.json")) return jsonResponse(index);
    if (url.endsWith("/roads.json"))
      return jsonResponse({ nodes: [], edges: [], classes: [], names: [] });
    const match = /tile_(\d+)_(\d+)\.json$/.exec(url);
    if (match) return jsonResponse(tile(Number(match[1]), Number(match[2])));
    return jsonResponse({ error: "not found" }, 404);
  });
}

describe("tileCoordForMetres", () => {
  it("maps metres to tile coordinates using the index grid", () => {
    expect(tileCoordForMetres([-2000, -2000], index)).toEqual({ x: 0, y: 0 });
    expect(tileCoordForMetres([1999, 4000], index)).toEqual({ x: 1, y: 3 });
  });

  it("clamps points far outside the bounds to the nearest edge tile", () => {
    expect(tileCoordForMetres([-1_000_000, -1_000_000], index)).toEqual({
      x: 0,
      y: 0,
    });
    expect(tileCoordForMetres([1_000_000, 1_000_000], index)).toEqual({
      x: 3,
      y: 3,
    });
  });
});

describe("createMapLoader", () => {
  const sleep = vi.fn(async () => {});

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the index once and the 3 × 3 block around a point", async () => {
    const fetchImpl = routedFetch();
    const loader = createMapLoader({ baseUrl: "/map", fetchImpl, sleep });
    await loader.loadIndex();
    await loader.loadIndex();
    const progress = await loader.ensureTilesAround([0, 0]);
    expect(progress).toEqual({ loaded: 9, total: 9 });
    expect(loader.getLoadedTiles()).toHaveLength(9);
    expect(loader.getTile(1, 1)?.rect.minX).toBe(0);
    expect(
      fetchImpl.mock.calls.filter(([url]) =>
        String(url).endsWith("index.json"),
      ),
    ).toHaveLength(1);
  });

  it("keeps at most nine tiles, evicting the ones farthest from recent use", async () => {
    const loader = createMapLoader({
      baseUrl: "/map",
      fetchImpl: routedFetch(),
      sleep,
    });
    await loader.ensureTilesAround([0, 0]);
    await loader.ensureTilesAround([4000, 4000]);
    expect(loader.getLoadedTiles()).toHaveLength(9);
    expect(loader.getTile(0, 0)).toBeUndefined();
    expect(loader.getTile(3, 3)?.x).toBe(3);
  });

  it("retries transient failures, then marks the tile failed and reports to Sentry", async () => {
    const onError = vi.fn();
    const listener = vi.fn();
    const fetchImpl = routedFetch({ "/map/tile_0_0.json": 5 });
    const loader = createMapLoader({
      baseUrl: "/map",
      fetchImpl,
      sleep,
      retries: 2,
      onError,
    });
    loader.onChange(listener);
    const progress = await loader.ensureTilesAround([-2000, -2000], 0);
    expect(progress).toEqual({ loaded: 0, total: 1 });
    expect(loader.hasFailures()).toBe(true);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), "tile_0_0.json");
    expect(sleep).toHaveBeenCalledTimes(2);
    // A failure changes nothing about the resident tile set, so listeners
    // (used to trigger re-renders) are not notified for it.
    expect(listener).not.toHaveBeenCalled();
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { area: "arena", kind: "tile-load" },
      }),
    );
  });

  it("isolates a throwing onChange listener from tile bookkeeping", async () => {
    const fetchImpl = routedFetch();
    const loader = createMapLoader({ baseUrl: "/map", fetchImpl, sleep });
    const throwingListener = vi.fn(() => {
      throw new Error("listener boom");
    });
    loader.onChange(throwingListener);
    const progress = await loader.ensureTilesAround([0, 0], 0);
    expect(progress).toEqual({ loaded: 1, total: 1 });
    expect(loader.getTile(1, 1)?.x).toBe(1);
    expect(loader.hasFailures()).toBe(false);
    expect(throwingListener).toHaveBeenCalled();
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { area: "arena", kind: "map-listener" },
      }),
    );
  });

  it("refetches the index after a rejected load", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: "down" }, 500))
      .mockResolvedValue(jsonResponse(index));
    const loader = createMapLoader({
      baseUrl: "/map",
      fetchImpl,
      sleep,
      retries: 0,
    });
    await expect(loader.loadIndex()).rejects.toThrow();
    await expect(loader.loadIndex()).resolves.toEqual(index);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("clears resident tiles and failures on dispose, and stops fetching", async () => {
    const fetchImpl = routedFetch({ "/map/tile_0_0.json": 99 });
    const loader = createMapLoader({
      baseUrl: "/map",
      fetchImpl,
      sleep,
      retries: 0,
    });
    await loader.ensureTilesAround([0, 0], 0);
    await loader.ensureTilesAround([-2000, -2000], 0);
    expect(loader.getTile(1, 1)).toBeDefined();
    expect(loader.hasFailures()).toBe(true);

    loader.dispose();
    expect(loader.getTile(1, 1)).toBeUndefined();
    expect(loader.getLoadedTiles()).toEqual([]);
    expect(loader.hasFailures()).toBe(false);

    const callsBeforeReuse = fetchImpl.mock.calls.length;
    const progress = await loader.ensureTilesAround([0, 0], 0);
    expect(progress).toEqual({ loaded: 0, total: 0 });
    expect(fetchImpl.mock.calls.length).toBe(callsBeforeReuse);
  });

  it("does not store a tile whose fetch completes after dispose", async () => {
    const deferredResolvers: Array<(response: Response) => void> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/index.json")) return jsonResponse(index);
      return new Promise<Response>((resolve) => {
        deferredResolvers.push(resolve);
      });
    });
    const loader = createMapLoader({ baseUrl: "/map", fetchImpl, sleep });

    const pending = loader.ensureTilesAround([0, 0], 0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    loader.dispose();
    deferredResolvers.forEach((resolve) => resolve(jsonResponse(tile(1, 1))));

    const progress = await pending;
    expect(progress).toEqual({ loaded: 0, total: 1 });
    expect(loader.getTile(1, 1)).toBeUndefined();
    expect(loader.getLoadedTiles()).toEqual([]);
  });

  it("deduplicates concurrent requests for the same tile", async () => {
    const fetchImpl = routedFetch();
    const loader = createMapLoader({ baseUrl: "/map", fetchImpl, sleep });
    await Promise.all([
      loader.ensureTilesAround([0, 0], 0),
      loader.ensureTilesAround([0, 0], 0),
    ]);
    expect(
      fetchImpl.mock.calls.filter(([url]) =>
        String(url).endsWith("tile_1_1.json"),
      ),
    ).toHaveLength(1);
  });

  it("rejects malformed tiles without caching them", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) =>
      String(input).endsWith("index.json")
        ? jsonResponse(index)
        : jsonResponse({ x: 1 }),
    );
    const loader = createMapLoader({
      baseUrl: "/map",
      fetchImpl,
      sleep,
      retries: 0,
    });
    const progress = await loader.ensureTilesAround([0, 0], 0);
    expect(progress.loaded).toBe(0);
    expect(loader.hasFailures()).toBe(true);
  });

  it("reports progress via onProgress as each needed tile settles", async () => {
    const twoTileIndex: MapIndex = {
      ...index,
      tiles: [
        { x: 0, y: 0, file: "tile_0_0.json", bytes: 1 },
        { x: 1, y: 0, file: "tile_1_0.json", bytes: 1 },
      ],
    };
    const deferredResolvers: Array<() => void> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/index.json")) return jsonResponse(twoTileIndex);
      const match = /tile_(\d+)_(\d+)\.json$/.exec(url);
      if (!match) return jsonResponse({ error: "not found" }, 404);
      return new Promise<Response>((resolve) => {
        deferredResolvers.push(() =>
          resolve(jsonResponse(tile(Number(match[1]), Number(match[2])))),
        );
      });
    });
    const loader = createMapLoader({ baseUrl: "/map", fetchImpl, sleep });
    const onProgress = vi.fn();

    const pending = loader.ensureTilesAround([0, 0], 1, onProgress);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(deferredResolvers).toHaveLength(2);

    deferredResolvers[0]();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onProgress).toHaveBeenNthCalledWith(1, { loaded: 1, total: 2 });

    deferredResolvers[1]();
    await expect(pending).resolves.toEqual({ loaded: 2, total: 2 });
    expect(onProgress).toHaveBeenNthCalledWith(2, { loaded: 2, total: 2 });
  });

  it("refreshes tile recency when revisiting a resident tile", async () => {
    const fetchImpl = routedFetch();
    const loader = createMapLoader({
      baseUrl: "/map",
      fetchImpl,
      maxTiles: 9,
      sleep,
    });

    // Load the 3×3 block around tile (1,1): residents (0,0)…(2,2)
    const point1 = [0, 0] as const;
    await loader.ensureTilesAround(point1);
    expect(loader.getTile(1, 1)).toBeDefined();
    expect(loader.getLoadedTiles()).toHaveLength(9);

    // Move to tile (2,2), which needs tiles (1,1)…(3,3).
    // Without recency bumping, overlapping tiles (1,1), (1,2), (2,1), (2,2)
    // lose their recency and some get evicted. With recency bumping via touch(),
    // they stay resident, so we keep all 9 tiles in the second 3×3 block.
    const point2 = [3000, 3000] as const;
    await loader.ensureTilesAround(point2);

    // All 9 tiles in the (2,2) 3×3 block should be resident
    expect(loader.getLoadedTiles()).toHaveLength(9);

    // Verify the overlapping tiles from the first call are still there
    expect(loader.getTile(1, 1)).toBeDefined();
    expect(loader.getTile(1, 2)).toBeDefined();
    expect(loader.getTile(2, 1)).toBeDefined();
    expect(loader.getTile(2, 2)).toBeDefined();

    // Tile (0,0) is outside the (2,2) 3×3 block and should be evicted
    expect(loader.getTile(0, 0)).toBeUndefined();
  });
});
