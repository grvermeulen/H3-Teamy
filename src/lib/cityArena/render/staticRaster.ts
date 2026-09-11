import { rectsIntersect, type Rect } from "../mapBuild/geometry";
import type { DecodedTile } from "../world/decode";
import { createLru, type Lru } from "../world/lru";
import type { ZoomLevel } from "./camera";
import type { CanvasFactory, RasterContext, RasterTarget } from "./canvasTypes";
import { paintChunk, type LandmarkLookup } from "./drawStatic";
import { NO_SPRITES, type ArenaSprites } from "./sprites";

/**
 * What a raster layer paints into a chunk. The ground layer paints everything under the moving
 * things; the canopy layer (`CANOPY_LAYER` in `drawScenery.ts`) paints what hangs over them, at
 * half the ground's pixels per metre, and skips the canvas altogether for a chunk without a tree.
 */
export type ChunkLayer = {
  /** Pixels per metre relative to the zoom: 1 paints at the zoom, 0.5 at half of it. */
  resolution: number;
  /** Whether the layer has anything at all inside `rect`; `false` costs no canvas. */
  covers(rect: Rect, tiles: DecodedTile[]): boolean;
  /** Paints the layer into a context that maps metres to pixels at `zoom`. */
  paint(
    context: RasterContext,
    rect: Rect,
    zoom: number,
    tiles: DecodedTile[],
    landmarks: LandmarkLookup,
    sprites: ArenaSprites,
  ): void;
};

/** The ground: every chunk with a tile behind it has something to paint. */
export const GROUND_LAYER: ChunkLayer = {
  resolution: 1,
  covers: () => true,
  paint: paintChunk,
};

/** Chunk edge length in metres. */
export const CHUNK_METRES = 128;
/** Total canvas memory the chunk cache may hold. */
export const RASTER_BUDGET_BYTES = 40 * 1024 * 1024;
/** Bytes used per rasterised pixel (RGBA, one byte per channel). */
const BYTES_PER_PIXEL_RGBA = 4;
/**
 * Headroom multiplier applied to the visible chunk working set when sizing a viewport's budget.
 * 2.5 rather than 1.5 because the speed-based camera zoom keeps two zoom levels' chunks live
 * while driving, and a chunk's bytes grow with the square of the zoom (9 MiB at 12 px/m).
 */
export const RASTER_WORKING_SET_HEADROOM = 2.5;

/**
 * Ceiling on the adaptive budget, so a very wide viewport at a high zoom cannot ask for unbounded
 * canvas memory. Never applied below one raw working set — capping there would make the cache
 * evict a chunk it still needs on the very next frame.
 */
export const RASTER_BUDGET_MAX_BYTES = 96 * 1024 * 1024;

/** A chunk address. */
export type ChunkCoord = { zoom: ZoomLevel; chunkX: number; chunkY: number };
/** A rasterised chunk; `target` is null for a chunk its layer has nothing in, cached at no cost. */
export type Chunk = {
  key: string;
  coord: ChunkCoord;
  rect: Rect;
  target: RasterTarget | null;
  bytes: number;
};

/** Cache of rasterised chunks with a byte budget. */
export type StaticRaster = {
  getChunk(coord: ChunkCoord): Chunk | undefined;
  ensureChunk(
    coord: ChunkCoord,
    tiles: DecodedTile[],
    landmarks: LandmarkLookup,
  ): Chunk | null;
  rasterizeNext(
    needed: ChunkCoord[],
    tiles: DecodedTile[],
    landmarks: LandmarkLookup,
  ): boolean;
  invalidateRect(rect: Rect): void;
  stats(): { chunks: number; bytes: number };
  dispose(): void;
};

/** Rectangle covering every chunk, for dropping the whole cache through `invalidateRect`. */
export const WHOLE_WORLD_RECT: Rect = {
  minX: Number.NEGATIVE_INFINITY,
  minY: Number.NEGATIVE_INFINITY,
  maxX: Number.POSITIVE_INFINITY,
  maxY: Number.POSITIVE_INFINITY,
};

/** Cache key of a chunk. */
export function chunkKey(coord: ChunkCoord): string {
  return `${coord.zoom}:${coord.chunkX}:${coord.chunkY}`;
}

/** World rectangle of a chunk. */
export function chunkRect(coord: ChunkCoord): Rect {
  return {
    minX: coord.chunkX * CHUNK_METRES,
    minY: coord.chunkY * CHUNK_METRES,
    maxX: (coord.chunkX + 1) * CHUNK_METRES,
    maxY: (coord.chunkY + 1) * CHUNK_METRES,
  };
}

/** Chunks intersecting a world rectangle, nearest to its centre first. */
export function chunksCovering(rect: Rect, zoom: ZoomLevel): ChunkCoord[] {
  const coords: ChunkCoord[] = [];
  for (
    let chunkY = Math.floor(rect.minY / CHUNK_METRES);
    chunkY <= Math.floor(rect.maxY / CHUNK_METRES);
    chunkY++
  ) {
    for (
      let chunkX = Math.floor(rect.minX / CHUNK_METRES);
      chunkX <= Math.floor(rect.maxX / CHUNK_METRES);
      chunkX++
    )
      coords.push({ zoom, chunkX, chunkY });
  }
  const centreX = (rect.minX + rect.maxX) / 2;
  const centreY = (rect.minY + rect.maxY) / 2;
  const distanceFromCentre = (coord: ChunkCoord): number =>
    Math.hypot(
      (coord.chunkX + 0.5) * CHUNK_METRES - centreX,
      (coord.chunkY + 0.5) * CHUNK_METRES - centreY,
    );
  return coords.sort(
    (left, right) => distanceFromCentre(left) - distanceFromCentre(right),
  );
}

/** Number of chunks spanning one axis of a `lengthPx`-sized viewport at a chunk pixel size of `chunkPx`. */
function chunksAcrossAxis(lengthPx: number, chunkPx: number): number {
  return Math.ceil(lengthPx / chunkPx) + 1;
}

/**
 * Raster budget (bytes) that comfortably holds every chunk visible through a `viewport`-sized
 * canvas at `zoom`, so a wide desktop viewport is not squeezed by the fixed default budget while
 * a small one still gets that default. Never smaller than {@link RASTER_BUDGET_BYTES} or than the
 * raw working set, and never larger than {@link RASTER_BUDGET_MAX_BYTES} unless the working set
 * itself is.
 */
export function rasterBudgetForViewport(
  viewport: { width: number; height: number },
  zoom: ZoomLevel,
): number {
  const chunkPx = CHUNK_METRES * zoom;
  const chunksWide = chunksAcrossAxis(viewport.width, chunkPx);
  const chunksTall = chunksAcrossAxis(viewport.height, chunkPx);
  const workingSetBytes =
    chunksWide * chunksTall * chunkPx * chunkPx * BYTES_PER_PIXEL_RGBA;
  return Math.max(
    RASTER_BUDGET_BYTES,
    workingSetBytes,
    Math.min(
      RASTER_BUDGET_MAX_BYTES,
      workingSetBytes * RASTER_WORKING_SET_HEADROOM,
    ),
  );
}

/** Chunk cache keyed by {@link chunkKey}, bounded by a total byte budget. */
type ChunkStore = Lru<string, Chunk>;

/** Creates the byte-budgeted chunk cache. */
function createChunkStore(budgetBytes: number): ChunkStore {
  return createLru<string, Chunk>({
    maxCost: budgetBytes,
    costOf: (chunk) => chunk.bytes,
  });
}

/**
 * Rasterises one chunk of `layer` via `factory`: an empty chunk with no canvas when the layer
 * has nothing there, or `null` when the factory has no 2D context.
 */
function rasterizeChunk(
  factory: CanvasFactory,
  coord: ChunkCoord,
  tiles: DecodedTile[],
  landmarks: LandmarkLookup,
  sprites: ArenaSprites,
  layer: ChunkLayer,
): Chunk | null {
  const rect = chunkRect(coord);
  const key = chunkKey(coord);
  if (!layer.covers(rect, tiles))
    return { key, coord, rect, target: null, bytes: 0 };
  const sizePx = Math.round(CHUNK_METRES * coord.zoom * layer.resolution);
  const target = factory(sizePx, sizePx);
  if (!target) return null;
  layer.paint(
    target.ctx,
    rect,
    coord.zoom * layer.resolution,
    tiles,
    landmarks,
    sprites,
  );
  return {
    key,
    coord,
    rect,
    target,
    bytes: sizePx * sizePx * BYTES_PER_PIXEL_RGBA,
  };
}

/** Returns the cached chunk at `coord`, rasterising and storing it first if missing. */
function ensureCachedChunk(
  store: ChunkStore,
  factory: CanvasFactory,
  coord: ChunkCoord,
  tiles: DecodedTile[],
  landmarks: LandmarkLookup,
  sprites: ArenaSprites,
  layer: ChunkLayer,
): Chunk | null {
  const existing = store.get(chunkKey(coord));
  if (existing) return existing;
  const chunk = rasterizeChunk(
    factory,
    coord,
    tiles,
    landmarks,
    sprites,
    layer,
  );
  if (chunk) store.set(chunk.key, chunk);
  return chunk;
}

/** Rasterises the first coordinate in `needed` that is not yet cached; `false` when none is. */
function rasterizeNextMissingChunk(
  store: ChunkStore,
  factory: CanvasFactory,
  needed: ChunkCoord[],
  tiles: DecodedTile[],
  landmarks: LandmarkLookup,
  sprites: ArenaSprites,
  layer: ChunkLayer,
): boolean {
  const missing = needed.find((coord) => !store.has(chunkKey(coord)));
  if (!missing) return false;
  return (
    ensureCachedChunk(
      store,
      factory,
      missing,
      tiles,
      landmarks,
      sprites,
      layer,
    ) !== null
  );
}

/** Drops every cached chunk whose rectangle intersects `rect`. */
function invalidateChunksTouching(store: ChunkStore, rect: Rect): void {
  for (const key of store.keys()) {
    const chunk = store.peek(key);
    if (chunk && rectsIntersect(chunk.rect, rect)) store.delete(key);
  }
}

/**
 * Creates the cache; chunks are painted by `layer` (the ground, {@link GROUND_LAYER}, unless
 * another is given) on demand. `readSprites` is read per rasterisation rather than captured, so
 * chunks painted after the sprite art arrives pick it up; the caller drops the chunks painted
 * before that with {@link StaticRaster.invalidateRect}.
 */
export function createStaticRaster(
  factory: CanvasFactory,
  budgetBytes = RASTER_BUDGET_BYTES,
  readSprites: () => ArenaSprites = () => NO_SPRITES,
  layer: ChunkLayer = GROUND_LAYER,
): StaticRaster {
  const store = createChunkStore(budgetBytes);
  return {
    getChunk: (coord) => store.get(chunkKey(coord)),
    ensureChunk: (coord, tiles, landmarks) =>
      ensureCachedChunk(
        store,
        factory,
        coord,
        tiles,
        landmarks,
        readSprites(),
        layer,
      ),
    rasterizeNext: (needed, tiles, landmarks) =>
      rasterizeNextMissingChunk(
        store,
        factory,
        needed,
        tiles,
        landmarks,
        readSprites(),
        layer,
      ),
    invalidateRect: (rect) => invalidateChunksTouching(store, rect),
    stats: () => ({ chunks: store.size, bytes: store.cost }),
    dispose: () => {
      for (const key of store.keys()) store.delete(key);
    },
  };
}
