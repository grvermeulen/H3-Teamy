import { polygonArea } from "../mapBuild/geometry";
import type { DecodedBuilding } from "../world/decode";
import type { Point } from "../world/projection";
import type { RasterContext } from "./canvasTypes";
import { buildingFill } from "./palette";
import type { RoofTextures, SurfaceTexture } from "./sprites";

/** A building up to this footprint, and up to {@link TILED_ROOF_MAX_LEVELS}, gets a tiled roof. */
export const TILED_ROOF_MAX_AREA_M2 = 300;
/** Above this many floors a roof is flat gravel whatever the footprint. */
export const TILED_ROOF_MAX_LEVELS = 3;

/** The two roofs a building can have. */
export type RoofKind = "tiles" | "flat";

/** The roof patterns of one chunk paint, one per kind whose texture has loaded. */
export type RoofPatterns = Partial<
  Record<RoofKind, { pattern: CanvasPattern; texture: SurfaceTexture }>
>;

/**
 * Which roof a building gets: houses and small shops are tiled, the big and the tall are flat.
 *
 * @param building - The footprint and the floors.
 * @returns The roof kind.
 */
export function roofKindOf(
  building: Pick<DecodedBuilding, "ring" | "levels">,
): RoofKind {
  return Math.abs(polygonArea(building.ring)) <= TILED_ROOF_MAX_AREA_M2 &&
    building.levels <= TILED_ROOF_MAX_LEVELS
    ? "tiles"
    : "flat";
}

/**
 * The direction of a ring's longest edge, radians: the ridge of a pitched roof runs along it,
 * so the tile rows do too.
 *
 * @param ring - The footprint.
 * @returns The angle of the longest edge.
 */
export function longestEdgeAngle(ring: Point[]): number {
  let best = 0;
  let bestLength = -1;
  for (let index = 0; index < ring.length; index++) {
    const [ax, ay] = ring[index];
    const [bx, by] = ring[(index + 1) % ring.length];
    const length = Math.hypot(bx - ax, by - ay);
    if (length > bestLength) {
      bestLength = length;
      best = Math.atan2(by - ay, bx - ax);
    }
  }
  return best;
}

/**
 * The pattern matrix that lays a texture along a building: scaled from its pixels to its metres,
 * turned to the longest edge, and anchored at the first corner so the rows start at the eave
 * instead of wherever the world's origin happens to put them.
 *
 * @param texture - The roof texture.
 * @param ring - The footprint.
 * @returns The matrix for `CanvasPattern.setTransform`.
 */
export function roofPatternMatrix(
  texture: SurfaceTexture,
  ring: Point[],
): DOMMatrix2DInit {
  const scale = texture.tileMetres / texture.tilePixels;
  const angle = longestEdgeAngle(ring);
  const cos = Math.cos(angle) * scale;
  const sin = Math.sin(angle) * scale;
  return { a: cos, b: sin, c: -sin, d: cos, e: ring[0][0], f: ring[0][1] };
}

/**
 * Builds one pattern per roof texture that has loaded, once per chunk; each building then only
 * sets the pattern's transform before its fill.
 *
 * @param context - The chunk's context.
 * @param roofs - The loaded roof textures, if any.
 * @returns The patterns by roof kind.
 */
export function roofPatterns(
  context: RasterContext,
  roofs: RoofTextures | undefined,
): RoofPatterns {
  const patterns: RoofPatterns = {};
  for (const kind of ["tiles", "flat"] as const) {
    const texture = roofs?.[kind];
    const pattern = texture
      ? context.createPattern(texture.image, "repeat")
      : null;
    if (texture && pattern) patterns[kind] = { pattern, texture };
  }
  return patterns;
}

/**
 * The fill for a building's roof: its kind's texture laid along its longest edge, or the flat
 * shade by floors while that texture has not loaded.
 *
 * @param building - The building.
 * @param roofs - The chunk's roof patterns.
 * @returns A pattern or a colour.
 */
export function roofFill(
  building: DecodedBuilding,
  roofs: RoofPatterns,
): string | CanvasPattern {
  const entry = roofs[roofKindOf(building)];
  if (!entry) return buildingFill(building.levels);
  entry.pattern.setTransform(roofPatternMatrix(entry.texture, building.ring));
  return entry.pattern;
}
