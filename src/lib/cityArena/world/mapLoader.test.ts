import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MapIndex, MapTile } from "./mapTypes";
import { createMapLoader, tileCoordForMetres } from "./mapLoader";

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

  it("retries transient failures, then marks the tile failed and notifies", async () => {
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
    expect(listener).toHaveBeenCalled();
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
});
