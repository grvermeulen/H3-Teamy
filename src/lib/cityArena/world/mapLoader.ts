import * as Sentry from "@sentry/nextjs";
import { MAP_BASE_PATH } from "../constants";
import { isMapRoads, isMapTile, parseMapIndex } from "../schemas";
import { decodeTile, type DecodedTile } from "./decode";
import { createLru, type Lru } from "./lru";
import type { MapIndex, MapRoads, MapTileRef } from "./mapTypes";
import { fromUnits, type Point } from "./projection";

/** Tiles kept in memory (a 3 × 3 block around the player). */
export const MAX_RESIDENT_TILES = 9;

/** Default retry attempts for a failed map request before giving up. */
const DEFAULT_TILE_RETRIES = 3;

/** Default exponential-backoff unit (milliseconds) between retries. */
const DEFAULT_BACKOFF_MS = 500;

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

/** Restricts `value` to the closed range `[min, max]`. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Smallest and largest tile index along one axis of the index's tile grid. */
function axisBounds(
  refs: MapTileRef[],
  axis: "x" | "y",
): { min: number; max: number } {
  return refs.reduce(
    (bounds, ref) => ({
      min: Math.min(bounds.min, ref[axis]),
      max: Math.max(bounds.max, ref[axis]),
    }),
    { min: Infinity, max: -Infinity },
  );
}

/** Tile coordinate containing a point in metres, clamped to the index's tile grid. */
export function tileCoordForMetres(
  point: Point,
  index: MapIndex,
): { x: number; y: number } {
  const size = fromUnits(index.tileSize);
  const rawX = Math.floor((point[0] - fromUnits(index.bounds.minX)) / size);
  const rawY = Math.floor((point[1] - fromUnits(index.bounds.minY)) / size);
  const xBounds = axisBounds(index.tiles, "x");
  const yBounds = axisBounds(index.tiles, "y");
  if (!Number.isFinite(xBounds.min) || !Number.isFinite(yBounds.min)) {
    return { x: rawX, y: rawY };
  }
  return {
    x: clamp(rawX, xBounds.min, xBounds.max),
    y: clamp(rawY, yBounds.min, yBounds.max),
  };
}

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

type RetryOptions = Required<
  Pick<MapLoaderOptions, "fetchImpl" | "retries" | "backoffMs" | "sleep">
>;

/** Fetches JSON from `url`, retrying transient failures with backoff. */
async function fetchJsonWithRetries(
  url: string,
  options: RetryOptions,
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

/** Fetches one tile and decodes it, throwing when the payload shape is wrong. */
async function fetchDecodedTile(
  ref: MapTileRef,
  index: MapIndex,
  baseUrl: string,
  retryOptions: RetryOptions,
): Promise<DecodedTile> {
  const payload = await fetchJsonWithRetries(
    `${baseUrl}/${ref.file}`,
    retryOptions,
  );
  if (!isMapTile(payload)) throw new Error(`Malformed tile ${ref.file}`);
  return decodeTile(payload, index);
}

/** Caches a pending/successful load; a rejection clears the cache so the next call retries. */
function createCachedLoader<T>(fetcher: () => Promise<T>): {
  load(): Promise<T>;
  reset(): void;
} {
  let current: Promise<T> | null = null;
  return {
    load(): Promise<T> {
      current ??= fetcher().catch((error: unknown) => {
        current = null;
        throw error;
      });
      return current;
    },
    reset(): void {
      current = null;
    },
  };
}

/** Invokes each listener in isolation so one throwing listener cannot corrupt bookkeeping. */
function notifyListeners(listeners: Set<() => void>): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (error: unknown) {
      Sentry.captureException(error, {
        tags: { area: "arena", kind: "map-listener" },
      });
    }
  }
}

type TileStoreOptions = {
  maxTiles: number;
  isDisposed: () => boolean;
  onChange: () => void;
  onError?: (error: Error, file: string) => void;
};

type TileStore = {
  get(file: string): DecodedTile | undefined;
  touch(file: string): boolean;
  getAll(): DecodedTile[];
  hasFailures(): boolean;
  request(
    ref: MapTileRef,
    fetchTile: (ref: MapTileRef) => Promise<DecodedTile>,
  ): Promise<boolean>;
  reset(): void;
};

/** Stores a fetched tile, unless the loader was disposed while the fetch was in flight. */
function storeTile(
  tiles: Lru<string, DecodedTile>,
  options: TileStoreOptions,
  file: string,
  tile: DecodedTile,
): boolean {
  if (options.isDisposed()) return false;
  tiles.set(file, tile);
  options.onChange();
  return true;
}

/** Reports a tile failure to Sentry, then records it unless the loader was disposed. */
function recordTileFailure(
  failed: Set<string>,
  options: TileStoreOptions,
  file: string,
  error: unknown,
): boolean {
  const normalized = error instanceof Error ? error : new Error(String(error));
  Sentry.captureException(normalized, {
    tags: { area: "arena", kind: "tile-load" },
  });
  if (options.isDisposed()) return false;
  failed.add(file);
  options.onError?.(normalized, file);
  return false;
}

/** Owns the resident-tile LRU plus the in-flight and failure bookkeeping for one loader. */
function createTileStore(options: TileStoreOptions): TileStore {
  const failed = new Set<string>();
  const inFlight = new Map<string, Promise<boolean>>();
  const tiles = createLru<string, DecodedTile>({
    maxCost: options.maxTiles,
    costOf: () => 1,
    onEvict: () => options.onChange(),
  });

  return {
    get: (file) => tiles.peek(file),
    touch(file) {
      if (tiles.has(file)) {
        tiles.get(file);
        return true;
      }
      return false;
    },
    getAll: () => tiles.keys().flatMap((key) => tiles.peek(key) ?? []),
    hasFailures: () => failed.size > 0,
    request(ref, fetchTile) {
      const existing = inFlight.get(ref.file);
      if (existing) return existing;
      const request = fetchTile(ref)
        .then((tile) => storeTile(tiles, options, ref.file, tile))
        .catch((error: unknown) =>
          recordTileFailure(failed, options, ref.file, error),
        )
        .finally(() => inFlight.delete(ref.file));
      inFlight.set(ref.file, request);
      return request;
    },
    reset() {
      for (const key of tiles.keys()) tiles.delete(key);
      inFlight.clear();
      failed.clear();
    },
  };
}

/** Tile refs within `radiusTiles` of the tile containing `centre`. */
function neededRefs(
  centre: Point,
  radiusTiles: number,
  index: MapIndex,
): MapTileRef[] {
  const origin = tileCoordForMetres(centre, index);
  return index.tiles.filter(
    (ref) =>
      Math.abs(ref.x - origin.x) <= radiusTiles &&
      Math.abs(ref.y - origin.y) <= radiusTiles,
  );
}

type LoaderState = {
  baseUrl: string;
  retryOptions: RetryOptions;
  tileStore: TileStore;
  indexLoader: ReturnType<typeof createCachedLoader<MapIndex>>;
  roadsLoader: ReturnType<typeof createCachedLoader<MapRoads>>;
  listeners: Set<() => void>;
  disposedRef: { current: boolean };
};

/** Builds the mutable state shared by one loader's public methods. */
function createLoaderState(options: MapLoaderOptions): LoaderState {
  const baseUrl = options.baseUrl ?? MAP_BASE_PATH;
  const retryOptions: RetryOptions = {
    fetchImpl: options.fetchImpl ?? fetch,
    retries: options.retries ?? DEFAULT_TILE_RETRIES,
    backoffMs: options.backoffMs ?? DEFAULT_BACKOFF_MS,
    sleep: options.sleep ?? defaultSleep,
  };
  const listeners = new Set<() => void>();
  const disposedRef = { current: false };
  const tileStore = createTileStore({
    maxTiles: options.maxTiles ?? MAX_RESIDENT_TILES,
    isDisposed: () => disposedRef.current,
    onChange: () => notifyListeners(listeners),
    onError: options.onError,
  });
  const indexLoader = createCachedLoader<MapIndex>(() =>
    fetchJsonWithRetries(`${baseUrl}/index.json`, retryOptions).then(
      parseMapIndex,
    ),
  );
  const roadsLoader = createCachedLoader<MapRoads>(() =>
    fetchJsonWithRetries(`${baseUrl}/roads.json`, retryOptions).then(
      (value) => {
        if (!isMapRoads(value)) throw new Error("Malformed roads payload");
        return value;
      },
    ),
  );
  return {
    baseUrl,
    retryOptions,
    tileStore,
    indexLoader,
    roadsLoader,
    listeners,
    disposedRef,
  };
}

/** Builds `ensureTilesAround`, bound to one loader's state. */
function createEnsureTilesAround(
  state: LoaderState,
): (centre: Point, radiusTiles?: number) => Promise<LoadProgress> {
  return async (centre, radiusTiles = 1) => {
    if (state.disposedRef.current) return { loaded: 0, total: 0 };
    const index = await state.indexLoader.load();
    const refs = neededRefs(centre, radiusTiles, index);
    const results = await Promise.all(
      refs.map((ref) =>
        state.tileStore.touch(ref.file)
          ? Promise.resolve(true)
          : state.tileStore.request(ref, (tileRef) =>
              fetchDecodedTile(
                tileRef,
                index,
                state.baseUrl,
                state.retryOptions,
              ),
            ),
      ),
    );
    return { loaded: results.filter(Boolean).length, total: refs.length };
  };
}

/** Marks a loader disposed and clears every piece of its state. */
function disposeLoaderState(state: LoaderState): void {
  state.disposedRef.current = true;
  state.listeners.clear();
  state.tileStore.reset();
  state.indexLoader.reset();
  state.roadsLoader.reset();
}

/** Assembles the public {@link MapLoader} from its internal state. */
function assembleMapLoader(state: LoaderState): MapLoader {
  return {
    loadIndex: () => state.indexLoader.load(),
    loadRoads: () => state.roadsLoader.load(),
    ensureTilesAround: createEnsureTilesAround(state),
    getTile: (x, y) => state.tileStore.get(`tile_${x}_${y}.json`),
    getLoadedTiles: () => state.tileStore.getAll(),
    hasFailures: () => state.tileStore.hasFailures(),
    onChange(listener) {
      state.listeners.add(listener);
      return () => state.listeners.delete(listener);
    },
    dispose: () => disposeLoaderState(state),
  };
}

/** Creates a loader bound to a base URL; tiles are decoded once and cached. */
export function createMapLoader(options: MapLoaderOptions = {}): MapLoader {
  return assembleMapLoader(createLoaderState(options));
}
