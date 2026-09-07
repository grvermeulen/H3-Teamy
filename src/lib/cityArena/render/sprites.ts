import { z } from "zod";
import type { GroundKind } from "../world/mapTypes";
import type { RasterContext } from "./canvasTypes";

/** Manifest written by `scripts/generate-arena-sprites.js`, fetched once per session. */
export const SPRITE_MANIFEST_PATH = "/arena/sprites/manifest.json";

/** One seamless ground texture: where it is served from and how much ground one repeat covers. */
export const SurfaceEntrySchema = z.object({
  file: z.string(),
  tileMetres: z.number().positive(),
  tilePixels: z.number().int().positive(),
});

/** One vehicle sprite, drawn nose-up so the canvas can rotate it by heading. */
export const VehicleEntrySchema = z.object({
  file: z.string(),
  lengthMetres: z.number().positive(),
  widthMetres: z.number().positive(),
  pixelWidth: z.number().int().positive(),
  pixelHeight: z.number().int().positive(),
});

/** One character sprite, drawn facing up so the canvas can rotate it by the person's facing. */
export const PersonEntrySchema = z.object({
  file: z.string(),
  radiusMetres: z.number().positive(),
  pixelSize: z.number().int().positive(),
});

/**
 * Zod schema for `manifest.json`; runtime validation happens once per session. `surfaces` lists
 * every seamless texture flat, keyed as the build script writes them: the two road surfaces,
 * water, and one per {@link GroundKind}.
 */
export const SpriteManifestSchema = z.object({
  version: z.literal(1),
  surfaces: z.object({
    road: SurfaceEntrySchema,
    pavement: SurfaceEntrySchema,
    water: SurfaceEntrySchema,
    grass: SurfaceEntrySchema,
    field: SurfaceEntrySchema,
    forest: SurfaceEntrySchema,
    urban: SurfaceEntrySchema,
  }),
  vehicles: z.object({ sedan: VehicleEntrySchema }),
  people: z.object({ player: PersonEntrySchema }),
});

/** Parsed sprite manifest, inferred from {@link SpriteManifestSchema} so the two cannot drift. */
export type SpriteManifest = z.infer<typeof SpriteManifestSchema>;

/** Parses and validates a `manifest.json` payload; throws a ZodError on mismatch. */
export function parseSpriteManifest(value: unknown): SpriteManifest {
  return SpriteManifestSchema.parse(value);
}

/** A decoded ground texture plus the authored size of one repeat. */
export type SurfaceTexture = {
  image: CanvasImageSource;
  tileMetres: number;
  tilePixels: number;
};

/** A decoded car sprite: the greyscale art plus one pre-tinted copy per body colour. */
export type VehicleSprite = {
  base: CanvasImageSource;
  tinted: CanvasImageSource[];
};

/** The ground textures, one per {@link GroundKind}; each stays absent until its file decodes. */
export type GroundTextures = Partial<Record<GroundKind, SurfaceTexture>>;

/**
 * Sprites the painters may use. Every field is optional: a missing texture is the normal state
 * before the images have loaded and after a failed load, and each painter falls back to the flat
 * palette colour or the vector body it drew before this art existed.
 */
export type ArenaSprites = {
  road?: SurfaceTexture;
  pavement?: SurfaceTexture;
  water?: SurfaceTexture;
  ground?: GroundTextures;
  car?: VehicleSprite;
  player?: CanvasImageSource;
};

/** No sprites at all — every painter falls back to its flat fill. */
export const NO_SPRITES: ArenaSprites = {};

/**
 * Fill for one ground surface: a pattern repeating every `tileMetres` when the texture has
 * loaded, else `fallback`.
 *
 * The caller paints in metres, so the pattern matrix scales the texture's pixels down onto its
 * own metre footprint. That leaves the repeat anchored to the world origin rather than to the
 * chunk being painted, which is what makes neighbouring chunks line up along their shared edge.
 */
export function surfaceFill(
  context: RasterContext,
  texture: SurfaceTexture | undefined,
  fallback: string,
): string | CanvasPattern {
  if (!texture) return fallback;
  const pattern = context.createPattern(texture.image, "repeat");
  if (!pattern) return fallback;
  const metresPerPixel = texture.tileMetres / texture.tilePixels;
  pattern.setTransform({
    a: metresPerPixel,
    b: 0,
    c: 0,
    d: metresPerPixel,
    e: 0,
    f: 0,
  });
  return pattern;
}

/** The car sprite tinted for `colour`, the untinted art when no tint was built, else `undefined`. */
export function vehicleSpriteFor(
  sprite: VehicleSprite | undefined,
  colour: number,
): CanvasImageSource | undefined {
  if (!sprite) return undefined;
  if (sprite.tinted.length === 0) return sprite.base;
  return sprite.tinted[colour % sprite.tinted.length];
}
