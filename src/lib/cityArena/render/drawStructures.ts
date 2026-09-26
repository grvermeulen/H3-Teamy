/**
 * Ruins and damage shading for the 2D renderer (spec §5): a 2D player in the same room as a 3D one
 * must see the same city, so a destroyed building draws as rubble and a damaged one darkens by its
 * damage share — both a dynamic overlay drawn after the cached ground chunks, never invalidating
 * the raster cache those chunks live in.
 */
import { polygonCentroid, rectsIntersect } from "../mapBuild/geometry";
import { createRng, seedFromString } from "../sim/rng";
import { structureDamageShare } from "../sim/structures";
import type { StructureState } from "../sim/types";
import type { DecodedBuilding, DecodedTile } from "../world/decode";
import type { Point } from "../world/projection";
import { structureMaxHealth } from "../world/structureId";
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

/** Paints a destroyed footprint: a flat rubble fill, then chunk polygons seeded by its id. */
function drawRubble(
  context: RasterContext,
  camera: Camera,
  size: Viewport,
  building: DecodedBuilding,
  entry: StructureState,
): void {
  fillWorldRing(context, camera, size, building.ring, RUBBLE_FILL);
  const rng = createRng(seedFromString(String(entry.id)));
  for (const chunk of rubbleChunkPolygons(building, rng))
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

/**
 * Draws rubble over destroyed footprints and a dark shade over damaged ones, for every decoded
 * building in view whose structureId has an entry. Pure canvas calls; no raster invalidation.
 *
 * @param context - The canvas, already in viewport-local pixel space.
 * @param camera - The active camera.
 * @param size - The viewport, in CSS pixels.
 * @param tiles - Every decoded tile that may contribute a building.
 * @param structures - The sparse structure list; buildings with no entry are undamaged.
 */
export function drawStructureDamage(
  context: RasterContext,
  camera: Camera,
  size: Viewport,
  tiles: readonly DecodedTile[],
  structures: readonly StructureState[],
): void {
  if (structures.length === 0) return;
  const byId = new Map(structures.map((entry) => [entry.id, entry]));
  const view = visibleRect(camera, size);
  for (const tile of tiles) {
    for (const building of tile.buildings) {
      const entry = byId.get(building.structureId);
      if (!entry || !rectsIntersect(building.bounds, view)) continue;
      if (entry.destroyedAtTick !== null)
        drawRubble(context, camera, size, building, entry);
      else drawDamageShade(context, camera, size, building, entry);
    }
  }
}
