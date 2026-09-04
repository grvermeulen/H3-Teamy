import { MAP_BASE_PATH } from "../constants";
import { isMapTile, parseMapIndex } from "../schemas";
import { decodeTile, type DecodedTile } from "./decode";
import { createLru } from "./lru";
import type { MapIndex, MapRoads, MapTileRef } from "./mapTypes";
import { fromUnits, type Point } from "./projection";

/** Tiles kept in memory (a 3 × 3 block around the player). */
export const MAX_RESIDENT_TILES = 9;

/** Loading progress of the last `ensureTilesAround` call. */
export type LoadProgress = { loaded: number; total: number };

/** Options for {@link createMapLoader}; everything with I/O is injectable. */
export type MapLoaderOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  maxTiles?: number;
  retries?: number;
  backoffMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  onError?: (error: Error, file: string) => void;
};

/** Streams map tiles around a moving point. */
export type MapLoader = {
  loadIndex(): Promise<MapIndex>;
  loadRoads(): Promise<MapRoads>;
  ensureTilesAround(centre: Point, radiusTiles?: number): Promise<LoadProgress>;
  getTile(x: number, y: number): DecodedTile | undefined;
  getLoadedTiles(): DecodedTile[];
  hasFailures(): boolean;
  onChange(listener: () => void): () => void;
  dispose(): void;
};

/** Tile coordinate containing a point in metres. */
export function tileCoordForMetres(
  point: Point,
  index: MapIndex,
): { x: number; y: number } {
  const size = fromUnits(index.tileSize);
  return {
    x: Math.floor((point[0] - fromUnits(index.bounds.minX)) / size),
    y: Math.floor((point[1] - fromUnits(index.bounds.minY)) / size),
  };
}

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchJsonWithRetries(
  url: string,
  options: Required<
    Pick<MapLoaderOptions, "fetchImpl" | "retries" | "backoffMs" | "sleep">
  >,
): Promise<unknown> {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    let response: Response | null = null;
    try {
      response = await options.fetchImpl(url);
    } catch (error: unknown) {
      if (attempt > options.retries)
        throw error instanceof Error ? error : new Error(String(error));
    }
    if (response?.ok) return response.json();
    const retryable =
      response === null || response.status === 429 || response.status >= 500;
    if (!retryable || attempt > options.retries) {
      throw new Error(
        `Map request failed (${response?.status ?? "network"}): ${url}`,
      );
    }
    await options.sleep(options.backoffMs * attempt);
  }
}

/** Creates a loader bound to a base URL; tiles are decoded once and cached. */
export function createMapLoader(options: MapLoaderOptions = {}): MapLoader {
  const baseUrl = options.baseUrl ?? MAP_BASE_PATH;
  const retryOptions = {
    fetchImpl: options.fetchImpl ?? fetch,
    retries: options.retries ?? 3,
    backoffMs: options.backoffMs ?? 500,
    sleep: options.sleep ?? defaultSleep,
  };
  const listeners = new Set<() => void>();
  const notify = (): void => listeners.forEach((listener) => listener());
  const tiles = createLru<string, DecodedTile>({
    maxCost: options.maxTiles ?? MAX_RESIDENT_TILES,
    costOf: () => 1,
    onEvict: () => notify(),
  });
  const inFlight = new Map<string, Promise<boolean>>();
  const failed = new Set<string>();
  let indexPromise: Promise<MapIndex> | null = null;
  let roadsPromise: Promise<MapRoads> | null = null;
  let disposed = false;

  const loadIndex = (): Promise<MapIndex> => {
    indexPromise ??= fetchJsonWithRetries(
      `${baseUrl}/index.json`,
      retryOptions,
    ).then(parseMapIndex);
    return indexPromise;
  };

  const loadRoads = (): Promise<MapRoads> => {
    roadsPromise ??= fetchJsonWithRetries(
      `${baseUrl}/roads.json`,
      retryOptions,
    ).then((value) => value as MapRoads);
    return roadsPromise;
  };

  const loadTile = (ref: MapTileRef, index: MapIndex): Promise<boolean> => {
    const existing = inFlight.get(ref.file);
    if (existing) return existing;
    const request = fetchJsonWithRetries(`${baseUrl}/${ref.file}`, retryOptions)
      .then((payload) => {
        if (!isMapTile(payload)) throw new Error(`Malformed tile ${ref.file}`);
        if (!disposed) tiles.set(ref.file, decodeTile(payload, index));
        return true;
      })
      .catch((error: unknown) => {
        failed.add(ref.file);
        options.onError?.(
          error instanceof Error ? error : new Error(String(error)),
          ref.file,
        );
        return false;
      })
      .finally(() => {
        inFlight.delete(ref.file);
        notify();
      });
    inFlight.set(ref.file, request);
    return request;
  };

  const neededRefs = (
    centre: Point,
    radiusTiles: number,
    index: MapIndex,
  ): MapTileRef[] => {
    const origin = tileCoordForMetres(centre, index);
    return index.tiles.filter(
      (ref) =>
        Math.abs(ref.x - origin.x) <= radiusTiles &&
        Math.abs(ref.y - origin.y) <= radiusTiles,
    );
  };

  return {
    loadIndex,
    loadRoads,
    async ensureTilesAround(centre, radiusTiles = 1) {
      const index = await loadIndex();
      const refs = neededRefs(centre, radiusTiles, index);
      const results = await Promise.all(
        refs.map((ref) =>
          tiles.get(ref.file) ? Promise.resolve(true) : loadTile(ref, index),
        ),
      );
      return { loaded: results.filter(Boolean).length, total: refs.length };
    },
    getTile: (x, y) => tiles.peek(`tile_${x}_${y}.json`),
    getLoadedTiles: () => tiles.keys().flatMap((key) => tiles.peek(key) ?? []),
    hasFailures: () => failed.size > 0,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
}
