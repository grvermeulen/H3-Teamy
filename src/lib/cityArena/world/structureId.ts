/**
 * Identity and toughness of the city's buildings, shared by the simulation (which damages and
 * destroys them) and both renderers (which draw the damage).
 *
 * The map clips buildings to 2 km tiles, so what the game calls a structure is one building piece
 * in one tile. Its id packs the tile and the piece's position in the tile's building list; every
 * device loads the same map version, so the ids agree across a room.
 */
import { polygonArea } from "../mapBuild/geometry";
import type { Point } from "./projection";

/** Tiles per row in the id space; tile coordinates must lie in `[0, 64)`. */
export const STRUCTURE_TILE_STRIDE = 64;
/** Building pieces per tile in the id space; positions must lie in `[0, 65536)`. */
export const STRUCTURE_INDEX_STRIDE = 65536;
/** The least health any building has: a garden shed. */
export const MIN_STRUCTURE_HEALTH = 120;
/** The most health any building has: a large block of flats. */
export const MAX_STRUCTURE_HEALTH = 1800;
/** Health per square metre of footprint per storey. */
export const STRUCTURE_HEALTH_PER_M2_LEVEL = 1.2;

/** Throws a RangeError unless `value` is an integer in `[0, limit)`. */
function assertInRange(value: number, limit: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value >= limit)
    throw new RangeError(`${name} ${value} is outside [0, ${limit})`);
}

/**
 * The structure id of a building piece.
 *
 * @param tileX - The tile's column.
 * @param tileY - The tile's row.
 * @param index - The piece's position in the tile's building list.
 * @returns A non-negative integer below 2^28.
 */
export function structureIdOf(
  tileX: number,
  tileY: number,
  index: number,
): number {
  assertInRange(tileX, STRUCTURE_TILE_STRIDE, "tileX");
  assertInRange(tileY, STRUCTURE_TILE_STRIDE, "tileY");
  assertInRange(index, STRUCTURE_INDEX_STRIDE, "index");
  return (
    (tileY * STRUCTURE_TILE_STRIDE + tileX) * STRUCTURE_INDEX_STRIDE + index
  );
}

/**
 * The tile and position a structure id was made from.
 *
 * @param id - An id from {@link structureIdOf}.
 * @returns Its tile column, tile row and position in the tile.
 */
export function structureTileOf(id: number): {
  tileX: number;
  tileY: number;
  index: number;
} {
  const tile = Math.floor(id / STRUCTURE_INDEX_STRIDE);
  return {
    tileX: tile % STRUCTURE_TILE_STRIDE,
    tileY: Math.floor(tile / STRUCTURE_TILE_STRIDE),
    index: id % STRUCTURE_INDEX_STRIDE,
  };
}

/**
 * How much damage a building takes before it collapses.
 *
 * @param ring - The footprint in metres.
 * @param levels - Storeys; anything below one counts as one.
 * @param landmark - Landmarks never fall: missions anchor on them.
 * @returns `Infinity` for a landmark, otherwise area × storeys × 1.2 clamped to [120, 1800].
 */
export function structureMaxHealth(
  ring: readonly Point[],
  levels: number,
  landmark: boolean,
): number {
  if (landmark) return Infinity;
  const raw =
    polygonArea([...ring]) *
    Math.max(1, levels) *
    STRUCTURE_HEALTH_PER_M2_LEVEL;
  return Math.min(MAX_STRUCTURE_HEALTH, Math.max(MIN_STRUCTURE_HEALTH, raw));
}
