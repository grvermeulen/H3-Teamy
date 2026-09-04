import { rectsIntersect, type Rect } from "../mapBuild/geometry";
import type { DecodedTile } from "../world/decode";
import { createLru, type Lru } from "../world/lru";
import type { ZoomLevel } from "./camera";
import type { CanvasFactory, RasterTarget } from "./canvasTypes";
import { paintChunk, type LandmarkLookup } from "./drawStatic";

/** Chunk edge length in metres. */
export const CHUNK_METRES = 128;
/** Total canvas memory the chunk cache may hold. */
export const RASTER_BUDGET_BYTES = 40 * 1024 * 1024;
/** Bytes used per rasterised pixel (RGBA, one byte per channel). */
const BYTES_PER_PIXEL_RGBA = 4;
/** Headroom multiplier applied to the visible chunk working set when sizing a viewport's budget. */
export const RASTER_WORKING_SET_HEADROOM = 1.5;

/** A chunk address. */
export type ChunkCoord = { zoom: ZoomLevel; chunkX: number; chunkY: number };
/** A rasterised chunk. */
export type Chunk = {
  key: string;
  coord: ChunkCoord;
  rect: Rect;
  target: RasterTarget;
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
 * a small one still gets that default. Never smaller than {@link RASTER_BUDGET_BYTES}.
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
    workingSetBytes * RASTER_WORKING_SET_HEADROOM,
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

/** Rasterises one chunk via `factory`, or `null` when the factory has no 2D context. */
function rasterizeChunk(
  factory: CanvasFactory,
  coord: ChunkCoord,
  tiles: DecodedTile[],
  landmarks: LandmarkLookup,
): Chunk | null {
  const sizePx = CHUNK_METRES * coord.zoom;
  const target = factory(sizePx, sizePx);
  if (!target) return null;
  const rect = chunkRect(coord);
  paintChunk(target.ctx, rect, coord.zoom, tiles, landmarks);
  return {
    key: chunkKey(coord),
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
): Chunk | null {
  const existing = store.get(chunkKey(coord));
  if (existing) return existing;
  const chunk = rasterizeChunk(factory, coord, tiles, landmarks);
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
): boolean {
  const missing = needed.find((coord) => !store.has(chunkKey(coord)));
  if (!missing) return false;
  return ensureCachedChunk(store, factory, missing, tiles, landmarks) !== null;
}

/** Drops every cached chunk whose rectangle intersects `rect`. */
function invalidateChunksTouching(store: ChunkStore, rect: Rect): void {
  for (const key of store.keys()) {
    const chunk = store.peek(key);
    if (chunk && rectsIntersect(chunk.rect, rect)) store.delete(key);
  }
}

/** Creates the cache; chunks are painted with {@link paintChunk} on demand. */
export function createStaticRaster(
  factory: CanvasFactory,
  budgetBytes = RASTER_BUDGET_BYTES,
): StaticRaster {
  const store = createChunkStore(budgetBytes);
  return {
    getChunk: (coord) => store.get(chunkKey(coord)),
    ensureChunk: (coord, tiles, landmarks) =>
      ensureCachedChunk(store, factory, coord, tiles, landmarks),
    rasterizeNext: (needed, tiles, landmarks) =>
      rasterizeNextMissingChunk(store, factory, needed, tiles, landmarks),
    invalidateRect: (rect) => invalidateChunksTouching(store, rect),
    stats: () => ({ chunks: store.size, bytes: store.cost }),
    dispose: () => {
      for (const key of store.keys()) store.delete(key);
    },
  };
}
