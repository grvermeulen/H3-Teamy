import type { Rect } from "../mapBuild/geometry";
import type { CanvasFactory } from "../render/canvasTypes";
import type { LandmarkInfo, LandmarkLookup } from "../render/drawStatic";
import { createStaticRaster, type StaticRaster } from "../render/staticRaster";
import { createCollisionGrid, type CollisionGrid } from "./collisionGrid";
import type { DecodedTile } from "./decode";
import type { LoadProgress, MapLoader } from "./mapLoader";
import type { MapIndex } from "./mapTypes";
import type { Point } from "./projection";
import { decodeRoadGraph, type RoadGraph } from "./roadGraph";

/** Injected dependencies of a world session: the tile loader and a raster-target factory. */
export type WorldSessionOptions = {
  loader: MapLoader;
  canvasFactory: CanvasFactory;
};

/** Resolved once the map index and the decoded road graph are both available. */
export type WorldReady = { index: MapIndex; graph: RoadGraph };

/**
 * Owns one loaded map at runtime: keeps the collision grid and the raster cache consistent with
 * the tiles the loader currently holds resident, and exposes landmarks and loaded tile
 * rectangles for the renderer. Call {@link WorldSession.ready} before {@link WorldSession.update}.
 */
export type WorldSession = {
  ready(): Promise<WorldReady>;
  index(): MapIndex;
  graph(): RoadGraph;
  collision: CollisionGrid;
  raster: StaticRaster;
  landmarks(): LandmarkLookup;
  update(centre: Point): Promise<LoadProgress>;
  tiles(): DecodedTile[];
  loadedTileRects(): Rect[];
  hasFailures(): boolean;
  dispose(): void;
};

/** Bookkeeping key for one decoded tile, matching the loader's own `x:y` tile coordinates. */
function tileKey(tile: DecodedTile): string {
  return `${tile.x}:${tile.y}`;
}

/** Mutable state shared by one world session's public methods. */
type WorldSessionState = {
  loader: MapLoader;
  collision: CollisionGrid;
  raster: StaticRaster;
  synced: Map<string, DecodedTile>;
  landmarks: LandmarkLookup;
  readyPromise: Promise<WorldReady> | null;
  loadedIndex: MapIndex | null;
  loadedGraph: RoadGraph | null;
  unsubscribe: () => void;
};

/** Builds the landmark lookup the renderer needs from the index's landmark list. */
function buildLandmarkLookup(index: MapIndex): LandmarkLookup {
  const lookup: LandmarkLookup = new Map();
  for (const landmark of index.landmarks) {
    lookup.set(landmark.key, { name: landmark.name, style: landmark.style });
  }
  return lookup;
}

/**
 * Diffs the loader's currently resident tiles against `state.synced`: tiles the loader has
 * evicted are removed from the collision grid and their rectangle invalidated in the raster
 * cache, and newly resident tiles are inserted into both. Runs both on every `update()` call
 * and reactively whenever the loader reports a change, so out-of-band tile churn stays synced.
 */
function syncResidentTiles(state: WorldSessionState): void {
  const current = new Map(
    state.loader
      .getLoadedTiles()
      .map((tile): [string, DecodedTile] => [tileKey(tile), tile]),
  );
  for (const [key, tile] of state.synced) {
    if (current.has(key)) continue;
    state.synced.delete(key);
    state.collision.removeTile(tile.x, tile.y);
    state.raster.invalidateRect(tile.rect);
  }
  for (const [key, tile] of current) {
    if (state.synced.has(key)) continue;
    state.synced.set(key, tile);
    state.collision.insertTile(tile);
    state.raster.invalidateRect(tile.rect);
  }
}

/** Loads the index and road graph once, caching the in-flight promise across repeated calls. */
function loadReady(state: WorldSessionState): Promise<WorldReady> {
  state.readyPromise ??= Promise.all([
    state.loader.loadIndex(),
    state.loader.loadRoads(),
  ]).then(([index, roads]) => {
    const graph = decodeRoadGraph(roads);
    state.loadedIndex = index;
    state.loadedGraph = graph;
    for (const [key, info] of buildLandmarkLookup(index)) {
      state.landmarks.set(key, info);
    }
    return { index, graph };
  });
  return state.readyPromise;
}

/** Returns `value`, or throws when the session has not resolved `ready()` yet. */
function requireReady<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`World session not ready: ${what}`);
  return value;
}

/** Streams tiles around `centre`, then re-syncs the collision grid and raster cache. */
async function performUpdate(
  state: WorldSessionState,
  centre: Point,
): Promise<LoadProgress> {
  const progress = await state.loader.ensureTilesAround(centre);
  syncResidentTiles(state);
  return progress;
}

/** Builds the initial state and subscribes to the loader so out-of-band tile changes stay synced. */
function createWorldSessionState(
  options: WorldSessionOptions,
): WorldSessionState {
  const state: WorldSessionState = {
    loader: options.loader,
    collision: createCollisionGrid(),
    raster: createStaticRaster(options.canvasFactory),
    synced: new Map<string, DecodedTile>(),
    landmarks: new Map<string, LandmarkInfo>(),
    readyPromise: null,
    loadedIndex: null,
    loadedGraph: null,
    unsubscribe: () => undefined,
  };
  state.unsubscribe = options.loader.onChange(() => syncResidentTiles(state));
  return state;
}

/** Unsubscribes from the loader, drops every resident tile, and disposes the raster and the loader. */
function disposeWorldSession(state: WorldSessionState): void {
  state.unsubscribe();
  for (const tile of state.synced.values()) {
    state.collision.removeTile(tile.x, tile.y);
  }
  state.synced.clear();
  state.raster.dispose();
  state.loader.dispose();
}

/** Assembles the public {@link WorldSession} from its internal state. */
function assembleWorldSession(state: WorldSessionState): WorldSession {
  return {
    ready: () => loadReady(state),
    index: () => requireReady(state.loadedIndex, "index"),
    graph: () => requireReady(state.loadedGraph, "road graph"),
    collision: state.collision,
    raster: state.raster,
    landmarks: () => state.landmarks,
    update: (centre) => performUpdate(state, centre),
    tiles: () => [...state.synced.values()],
    loadedTileRects: () => [...state.synced.values()].map((tile) => tile.rect),
    hasFailures: () => state.loader.hasFailures(),
    dispose: () => disposeWorldSession(state),
  };
}

/**
 * Creates a world session around a loader and a canvas factory. Call {@link WorldSession.ready}
 * before the first {@link WorldSession.update}; every tile the loader streams in afterwards,
 * whether via `update()` or the loader's own background churn, is kept in sync with the
 * collision grid and the raster cache automatically until `dispose()` is called.
 */
export function createWorldSession(options: WorldSessionOptions): WorldSession {
  return assembleWorldSession(createWorldSessionState(options));
}
