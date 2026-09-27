/**
 * The contract between the character pack (`scripts/arena/pack-characters.ts`) and the 3D view
 * that loads it: which models exist, the animation roles the game plays, and the manifest the
 * pack writes to `public/arena/characters/manifest.json`. Kept outside `render3d/` so the script
 * can share it without importing the lazily loaded 3D chunk.
 */
import { z } from "zod";

/** Every packed character model. */
export const CHARACTER_MODEL_KEYS = [
  "casual-man",
  "business-man",
  "hoodie-man",
  "worker-man",
  "punk-man",
  "beach-man",
  "farmer-man",
  "swat",
  "woman-a",
  "woman-b",
  "punk-woman",
  "adventurer-woman",
  "hooded-woman",
  "suit-woman",
  "worker-woman",
] as const;

/** A packed character model. */
export type CharacterModelKey = (typeof CHARACTER_MODEL_KEYS)[number];

/** The animations the game plays, by what they are for. */
export const CLIP_ROLES = [
  "idle",
  "walk",
  "run",
  "death",
  "punch",
  "gunIdle",
  "gunShoot",
  "swing",
] as const;

/** What an animation is for. */
export type ClipRole = (typeof CLIP_ROLES)[number];

/** The vertex attribute holding a vertex's palette slot, as written in the glTF files. */
export const PALETTE_ATTRIBUTE = "_PALETTE";
/** Palette slots a model may use; the shader's colour table has this many entries. */
export const PALETTE_SLOTS = 16;

/** The skeletons the models share: every man is built on one, every woman on the other. */
export const CHARACTER_RIGS = ["men", "women"] as const;

/** A shared skeleton. */
export type CharacterRig = (typeof CHARACTER_RIGS)[number];

/**
 * One packed model: its file, its rig, and its palette. The pack merges every material into one
 * and writes each vertex's former material as a slot number (the `_PALETTE` attribute), so a
 * character draws in one call and is recoloured by rewriting its palette.
 */
const ModelEntrySchema = z.object({
  file: z.string().min(1),
  rig: z.enum(CHARACTER_RIGS),
  gender: z.enum(["male", "female"]),
  /** The original material names, by palette slot. */
  materials: z.array(z.string()).min(1).max(PALETTE_SLOTS),
  /** The original base colours by slot, sRGB hex. */
  colours: z
    .array(z.number().int().min(0).max(0xffffff))
    .min(1)
    .max(PALETTE_SLOTS),
  /** Standing height in the bind pose, in the file's units (metres). */
  height: z.number().positive(),
});

/** One rig's animation file and the clip name playing each role. */
const AnimationEntrySchema = z.object({
  file: z.string().min(1),
  clips: z.record(z.enum(CLIP_ROLES), z.string().min(1)),
});

/** `public/arena/characters/manifest.json`. */
export const CharacterManifestSchema = z.object({
  models: z.record(z.enum(CHARACTER_MODEL_KEYS), ModelEntrySchema),
  animations: z.record(z.enum(CHARACTER_RIGS), AnimationEntrySchema),
});

/** The parsed manifest. */
export type CharacterManifest = z.infer<typeof CharacterManifestSchema>;
