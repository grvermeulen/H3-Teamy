/**
 * Ruins and damage shading for the 2D renderer (spec §5): a 2D player in the same room as a 3D one
 * must see the same city, so a destroyed building draws as rubble and a damaged one darkens by its
 * damage share — both a dynamic overlay drawn after the cached ground chunks, never invalidating
 * the raster cache those chunks live in.
 */
import { polygonCentroid, rectsIntersect } from "../mapBuild/geometry";
import { createRng, seedFromString } from "../sim/rng";
import { MAX_STRUCTURES, structureDamageShare } from "../sim/structures";
import type { StructureState } from "../sim/types";
import type { DecodedBuilding, DecodedTile } from "../world/decode";
import type { Point } from "../world/projection";
import { structureMaxHealth, structureTileOf } from "../world/structureId";
import {
  visibleRect,
  worldToScreen,
  type Camera,
  type Viewport,
} from "./camera";
import type { RasterContext } from "./canvasTypes";

/** Fill of a destroyed footprint, under the individual rubble chunks. */
export const RUBBLE_FILL = "#3b3631";
/** Fill of one rubble chunk polygon scattered over a destroyed footprint. */
export const RUBBLE_CHUNK = "#27231f";
/** Darkest a damaged, still-standing building is shaded, at full damage. */
export const DAMAGE_SHADE_MAX_ALPHA = 0.55;

/** Rubble chunk polygons drawn per destroyed footprint. */
const RUBBLE_CHUNK_COUNT = 6;
/** Vertices per rubble chunk polygon: enough for an irregular, rock-like outline. */
const RUBBLE_CHUNK_SIDES = 5;
/** A chunk's centre drifts up to this share of the footprint's half-extent from its centroid. */
const RUBBLE_CHUNK_SPREAD = 0.65;
/** A chunk's radius, as a share of the footprint's shorter half-extent (min, max). */
const RUBBLE_CHUNK_MIN_RADIUS_SHARE = 0.12;
const RUBBLE_CHUNK_MAX_RADIUS_SHARE = 0.22;
/** Jitter applied to each chunk vertex's angle and edge length, so sides are uneven. */
const RUBBLE_VERTEX_ANGLE_JITTER = 0.6;
const RUBBLE_VERTEX_EDGE_MIN_SHARE = 0.7;
const RUBBLE_VERTEX_EDGE_JITTER_SHARE = 0.3;

/** Traces `ring` (world metres) into the current path as screen pixels, closed. */
function traceWorldRing(
  context: RasterContext,
  camera: Camera,
  size: Viewport,
  ring: readonly Point[],
): void {
  context.beginPath();
  ring.forEach((point, index) => {
    const [x, y] = worldToScreen(camera, size, point);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.closePath();
}

/** Fills a world-space ring (metres) with a flat colour, projected to screen pixels. */
function fillWorldRing(
  context: RasterContext,
  camera: Camera,
  size: Viewport,
  ring: readonly Point[],
  fill: string,
): void {
  traceWorldRing(context, camera, size, ring);
  context.fillStyle = fill;
  context.fill();
}

/**
 * Irregular rubble chunk polygons scattered over a footprint, deterministic for a given `rng` so
 * the same structure draws identically every frame.
 */
function rubbleChunkPolygons(
  building: DecodedBuilding,
  rng: () => number,
): Point[][] {
  const [centreX, centreY] = polygonCentroid(building.ring);
  const halfWidth = (building.bounds.maxX - building.bounds.minX) / 2;
  const halfHeight = (building.bounds.maxY - building.bounds.minY) / 2;
  const minHalf = Math.min(halfWidth, halfHeight);
  const chunks: Point[][] = [];
  for (let chunk = 0; chunk < RUBBLE_CHUNK_COUNT; chunk += 1) {
    const chunkX = centreX + (rng() * 2 - 1) * halfWidth * RUBBLE_CHUNK_SPREAD;
    const chunkY = centreY + (rng() * 2 - 1) * halfHeight * RUBBLE_CHUNK_SPREAD;
    const radius =
      minHalf *
      (RUBBLE_CHUNK_MIN_RADIUS_SHARE +
        rng() *
          (RUBBLE_CHUNK_MAX_RADIUS_SHARE - RUBBLE_CHUNK_MIN_RADIUS_SHARE));
    const vertices: Point[] = [];
    for (let side = 0; side < RUBBLE_CHUNK_SIDES; side += 1) {
      const angle =
        (side / RUBBLE_CHUNK_SIDES) * Math.PI * 2 +
        rng() * RUBBLE_VERTEX_ANGLE_JITTER;
      const edge =
        radius *
        (RUBBLE_VERTEX_EDGE_MIN_SHARE +
          rng() * RUBBLE_VERTEX_EDGE_JITTER_SHARE);
      vertices.push([
        chunkX + Math.cos(angle) * edge,
        chunkY + Math.sin(angle) * edge,
      ]);
    }
    chunks.push(vertices);
  }
  return chunks;
}

/** A ruin's rubble chunks, kept for as long as the ruin stays in the structure list. */
type CachedRubble = {
  /** The footprint the chunks were scattered over; a reloaded tile brings a new one. */
  building: DecodedBuilding;
  chunks: Point[][];
  /** The {@link rubblePass} that last saw the ruin in the list. */
  seenPass: number;
};

/**
 * Rubble chunks per destroyed structure id, so a ruin is scattered once, not every frame. At most
 * one entry per ruin in the list ({@link MAX_STRUCTURES}); a ruin that leaves it is dropped.
 */
const rubbleCache = new Map<number, CachedRubble>();
/** Counts {@link drawStructureDamage} calls, to find the cached ruins the list no longer holds. */
let rubblePass = 0;

/** The chunks of a ruin's rubble, scattered (seeded by its id) the first time it is drawn. */
function rubbleOf(id: number, building: DecodedBuilding): Point[][] {
  const cached = rubbleCache.get(id);
  if (cached && cached.building === building) return cached.chunks;
  const rng = createRng(seedFromString(String(id)));
  const chunks = rubbleChunkPolygons(building, rng);
  rubbleCache.set(id, { building, chunks, seenPass: rubblePass });
  return chunks;
}

/** Marks every ruin in `structures` as seen this pass and drops the cached ones that are not. */
function pruneRubble(structures: readonly StructureState[]): void {
  rubblePass += 1;
  for (const entry of structures) {
    const cached = rubbleCache.get(entry.id);
    if (cached && entry.destroyedAtTick !== null) cached.seenPass = rubblePass;
  }
  for (const [id, cached] of rubbleCache)
    if (cached.seenPass !== rubblePass) rubbleCache.delete(id);
}

/** Paints a destroyed footprint: a flat rubble fill, then its cached chunk polygons. */
function drawRubble(
  context: RasterContext,
  camera: Camera,
  size: Viewport,
  building: DecodedBuilding,
  entry: StructureState,
): void {
  fillWorldRing(context, camera, size, building.ring, RUBBLE_FILL);
  for (const chunk of rubbleOf(entry.id, building))
    fillWorldRing(context, camera, size, chunk, RUBBLE_CHUNK);
}

/** Darkens a damaged, still-standing footprint in proportion to its damage share. */
function drawDamageShade(
  context: RasterContext,
  camera: Camera,
  size: Viewport,
  building: DecodedBuilding,
  entry: StructureState,
): void {
  const maxHealth = structureMaxHealth(
    building.ring,
    building.levels,
    Boolean(building.landmark),
  );
  const share = structureDamageShare(entry, maxHealth);
  if (share <= 0) return;
  const alpha = DAMAGE_SHADE_MAX_ALPHA * share;
  fillWorldRing(context, camera, size, building.ring, `rgba(0,0,0,${alpha})`);
}

/** Key for the tile lookup, matching a structure id's decoded `{ tileX, tileY }`. */
function tileKey(x: number, y: number): string {
  return `${x}:${y}`;
}

/** The tile list the lookup was last built from, and the lookup by `x:y`. */
let tileLookup: {
  tiles: readonly DecodedTile[];
  byCoord: ReadonlyMap<string, DecodedTile>;
} | null = null;

/** True when two tile lists hold the same tiles in the same order. */
function sameTiles(
  a: readonly DecodedTile[],
  b: readonly DecodedTile[],
): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1)
    if (a[index] !== b[index]) return false;
  return true;
}

/**
 * The resident tiles by `x:y`, rebuilt only when the tiles themselves change — the session hands
 * out a fresh array every frame, so the arrays are compared tile by tile.
 */
function tilesByCoordOf(
  tiles: readonly DecodedTile[],
): ReadonlyMap<string, DecodedTile> {
  if (!tileLookup || !sameTiles(tileLookup.tiles, tiles))
    tileLookup = {
      tiles,
      byCoord: new Map(tiles.map((tile) => [tileKey(tile.x, tile.y), tile])),
    };
  return tileLookup.byCoord;
}

/**
 * The building a structure id names, decoded straight from the id (spec §3.1: `id` packs the
 * tile and the piece's position in it) rather than by scanning every tile's building list.
 * Undefined when that tile is not resident, or the index is stale (a map version mismatch).
 */
function buildingFor(
  tilesByCoord: ReadonlyMap<string, DecodedTile>,
  id: number,
): DecodedBuilding | undefined {
  const { tileX, tileY, index } = structureTileOf(id);
  return tilesByCoord.get(tileKey(tileX, tileY))?.buildings[index];
}

/**
 * Draws rubble over destroyed footprints and a dark shade over damaged ones, for every entry in
 * `structures` whose building is resident and in view. Resolves each entry directly by id — at
 * most {@link MAX_STRUCTURES} lookups — rather than scanning every building of every tile. The
 * tile lookup and each ruin's rubble are cached across frames (the rubble per id, until the ruin
 * leaves the list). Pure canvas calls; no raster invalidation.
 *
 * @param context - The canvas, already in viewport-local pixel space.
 * @param camera - The active camera.
 * @param size - The viewport, in CSS pixels.
 * @param tiles - Every decoded tile currently resident.
 * @param structures - The sparse structure list; buildings with no entry are undamaged.
 */
export function drawStructureDamage(
  context: RasterContext,
  camera: Camera,
  size: Viewport,
  tiles: readonly DecodedTile[],
  structures: readonly StructureState[],
): void {
  pruneRubble(structures);
  if (structures.length === 0) return;
  const tilesByCoord = tilesByCoordOf(tiles);
  const view = visibleRect(camera, size);
  for (const entry of structures) {
    const building = buildingFor(tilesByCoord, entry.id);
    if (!building || !rectsIntersect(building.bounds, view)) continue;
    if (entry.destroyedAtTick !== null)
      drawRubble(context, camera, size, building, entry);
    else drawDamageShade(context, camera, size, building, entry);
  }
}
