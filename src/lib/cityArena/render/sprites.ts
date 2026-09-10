import { z } from "zod";
import type { VehicleKind } from "../sim/types";
import { VEHICLE_KINDS } from "../sim/vehicle";
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

/**
 * One vehicle sprite, drawn nose-up so the canvas can rotate it by heading. `tint` says whether
 * the art is greyscale for the palette to recolour, or keeps its own colours.
 */
export const VehicleEntrySchema = z.object({
  file: z.string(),
  lengthMetres: z.number().positive(),
  widthMetres: z.number().positive(),
  pixelWidth: z.number().int().positive(),
  pixelHeight: z.number().int().positive(),
  tint: z.boolean().default(true),
});

/**
 * One character sprite: a horizontal strip of `frames` square cells, each `pixelSize` across,
 * drawn for a person of `radiusMetres`. A single-frame strip is a still character.
 */
export const PersonEntrySchema = z.object({
  file: z.string(),
  radiusMetres: z.number().positive(),
  pixelSize: z.number().int().positive(),
  frames: z.number().int().positive(),
});

/**
 * The scenery props the manifest may carry (Plan 9b): the two tree canopies by size class, and
 * one piece of art per {@link FurnitureKind}, keyed by the kind itself.
 */
export const PROP_KEYS = [
  "treeSmall",
  "treeLarge",
  "lamp",
  "bench",
  "busStop",
] as const;

/** A key of {@link PROP_KEYS}. */
export type PropKey = (typeof PROP_KEYS)[number];

/** The prop key of a tree, by its size class. */
export const TREE_PROP_KEYS: readonly [PropKey, PropKey] = [
  "treeSmall",
  "treeLarge",
];

/**
 * One scenery prop: art packed onto its metre footprint, the long side along the image's x axis
 * (a canopy is square). The painter turns it to the piece's heading.
 */
export const PropEntrySchema = z.object({
  file: z.string(),
  lengthMetres: z.number().positive(),
  widthMetres: z.number().positive(),
  pixelWidth: z.number().int().positive(),
  pixelHeight: z.number().int().positive(),
});

/**
 * Zod schema for `manifest.json`; runtime validation happens once per session. `surfaces` lists
 * every seamless texture flat, keyed as the build script writes them: the two road surfaces,
 * water, and one per {@link GroundKind}. `vehicles` is a partial record over {@link VehicleKind},
 * so art can land kind by kind but a key that is no kind fails the parse — which
 * `arena:check-sprites` runs in CI, so a typo in the pack script never ships. `people` is keyed by
 * look (`player`, `ped1`…`ped6`, `cop`) and stays open.
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
  vehicles: z.partialRecord(z.enum(VEHICLE_KINDS), VehicleEntrySchema),
  people: z.record(z.string(), PersonEntrySchema),
  props: z.partialRecord(z.enum(PROP_KEYS), PropEntrySchema),
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

/**
 * A decoded car sprite: the art plus one pre-tinted copy per body colour, or none at all for art
 * that keeps its own colours.
 */
export type VehicleSprite = {
  base: CanvasImageSource;
  tinted: CanvasImageSource[];
};

/** Vehicle sprites by kind; a kind without art of its own draws the sedan's, tinted. */
export type VehicleSprites = Partial<Record<VehicleKind, VehicleSprite>>;

/** Character strips by look: `ped1`…`ped6` for the pedestrians (`pedLook`), `cop` for officers. */
export type PersonSprites = Partial<Record<string, PersonSprite>>;

/** The ground textures, one per {@link GroundKind}; each stays absent until its file decodes. */
export type GroundTextures = Partial<Record<GroundKind, SurfaceTexture>>;

/** A decoded scenery prop: the art and the metre footprint it is drawn over. */
export type PropSprite = {
  image: CanvasImageSource;
  lengthMetres: number;
  widthMetres: number;
};

/** Scenery props by key; each stays absent until its file decodes. */
export type PropSprites = Partial<Record<PropKey, PropSprite>>;

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
  /** The sedan's sprite: what every kind without art of its own is drawn with. */
  car?: VehicleSprite;
  vehicles?: VehicleSprites;
  player?: PersonSprite;
  people?: PersonSprites;
  /** Tree canopies and street furniture, painted into the chunk rasters. */
  props?: PropSprites;
};

/** The slice of the sprites the vehicle painter reads. */
export type VehicleArt = Pick<ArenaSprites, "car" | "vehicles">;

/** A decoded character strip: the art plus the cell size and how many cells it holds. */
export type PersonSprite = {
  image: CanvasImageSource;
  pixelSize: number;
  frames: number;
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

/**
 * True when `kind` has art of its own rather than borrowing the sedan's.
 *
 * @param art - The loaded sprites.
 * @param kind - The vehicle kind.
 * @returns Whether the kind's own sprite decoded.
 */
export function hasOwnVehicleArt(
  art: VehicleArt | undefined,
  kind: VehicleKind,
): boolean {
  return Boolean(art?.vehicles?.[kind]);
}

/**
 * The image to draw a car with: its kind's art or the sedan's, tinted for `colour` when the art
 * is tintable, the art itself when it keeps its own colours, and `undefined` with no art at all.
 *
 * @param art - The loaded sprites.
 * @param kind - The vehicle kind.
 * @param colour - The body colour index.
 * @returns The image, or `undefined` for the vector body.
 */
export function vehicleSpriteFor(
  art: VehicleArt | undefined,
  kind: VehicleKind,
  colour: number,
): CanvasImageSource | undefined {
  const sprite = art?.vehicles?.[kind] ?? art?.car;
  if (!sprite) return undefined;
  if (sprite.tinted.length === 0) return sprite.base;
  return sprite.tinted[colour % sprite.tinted.length];
}

/**
 * The character strip for a look, or `undefined` while its art has not loaded.
 *
 * @param people - The loaded strips by look.
 * @param look - `ped1`…`ped6` or `cop`.
 * @returns The strip, or `undefined`.
 */
export function personSpriteFor(
  people: PersonSprites | undefined,
  look: string,
): PersonSprite | undefined {
  return people?.[look];
}
