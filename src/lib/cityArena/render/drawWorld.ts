import { rectsIntersect, type Rect } from "../mapBuild/geometry";
import type { DecodedTile } from "../world/decode";
import {
  visibleRect,
  worldToScreen,
  type Camera,
  type Viewport,
} from "./camera";
import type { RasterContext } from "./canvasTypes";
import type { LandmarkLookup } from "./drawStatic";
import { HATCH_BACKGROUND, HATCH_LINE, PLACEHOLDER_FILL } from "./palette";
import {
  CHUNK_METRES,
  chunksCovering,
  type ChunkCoord,
  type StaticRaster,
} from "./staticRaster";

/**
 * Everything the world painter reads: the chunk raster cache, the decoded tiles chunks are
 * painted from, the landmark lookup for labels/fills, and the world areas that already have a
 * tile loaded (so an unrasterised chunk can be told apart from one with no data at all).
 */
export type WorldDrawSource = {
  raster: StaticRaster;
  tiles: DecodedTile[];
  landmarks: LandmarkLookup;
  loadedTileRects: Rect[];
};

/** Outcome of one world draw: chunks still without a cached raster, and whether one was rasterised this call. */
export type DrawStats = { missing: number; rasterised: boolean };

/** Spacing between diagonal hatch lines, in screen pixels. */
const HATCH_SPACING_PX = 16;
/** Width of a hatch line, in screen pixels. */
const HATCH_LINE_WIDTH_PX = 1;

/** Fills a chunk-sized square with a flat colour. */
function fillChunkArea(
  context: RasterContext,
  x: number,
  y: number,
  size: number,
  fill: string,
): void {
  context.beginPath();
  context.rect(x, y, size, size);
  context.fillStyle = fill;
  context.fill();
}

/** Fills a chunk-sized square with the hatch background, then strokes diagonal hatch lines over it. */
function hatchChunkArea(
  context: RasterContext,
  x: number,
  y: number,
  size: number,
): void {
  fillChunkArea(context, x, y, size, HATCH_BACKGROUND);
  context.beginPath();
  for (let offset = -size; offset < size; offset += HATCH_SPACING_PX) {
    context.moveTo(x + offset, y + size);
    context.lineTo(x + offset + size, y);
  }
  context.strokeStyle = HATCH_LINE;
  context.lineWidth = HATCH_LINE_WIDTH_PX;
  context.setLineDash([]);
  context.stroke();
}

/** True when a loaded tile rectangle touches the chunk's world rectangle. */
function chunkHasTile(coord: ChunkCoord, loadedTileRects: Rect[]): boolean {
  const rect: Rect = {
    minX: coord.chunkX * CHUNK_METRES,
    minY: coord.chunkY * CHUNK_METRES,
    maxX: (coord.chunkX + 1) * CHUNK_METRES,
    maxY: (coord.chunkY + 1) * CHUNK_METRES,
  };
  return loadedTileRects.some((tileRect) => rectsIntersect(tileRect, rect));
}

/**
 * Blits the chunks covering the view (rasterising at most one missing chunk this call), and
 * hatches areas that have no loaded tile behind them.
 */
export function drawVisibleChunks(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  source: WorldDrawSource,
): DrawStats {
  const needed = chunksCovering(visibleRect(camera, viewport), camera.zoom);
  const rasterised = source.raster.rasterizeNext(
    needed,
    source.tiles,
    source.landmarks,
  );
  const sizePx = CHUNK_METRES * camera.zoom;
  let missing = 0;
  for (const coord of needed) {
    const [x, y] = worldToScreen(camera, viewport, [
      coord.chunkX * CHUNK_METRES,
      coord.chunkY * CHUNK_METRES,
    ]);
    const chunk = source.raster.getChunk(coord);
    if (chunk) {
      context.drawImage(chunk.target.canvas, x, y, sizePx, sizePx);
      continue;
    }
    missing += 1;
    if (chunkHasTile(coord, source.loadedTileRects))
      fillChunkArea(context, x, y, sizePx, PLACEHOLDER_FILL);
    else hatchChunkArea(context, x, y, sizePx);
  }
  return { missing, rasterised };
}
