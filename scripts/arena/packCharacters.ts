/**
 * The character pack's pure half (spec §7): the owner-approved sources pinned by URL and sha256,
 * the cache download that refuses a file whose hash moved, the mapping from a rig's animation
 * names to the roles the game plays, and the manifest and credits the pack writes. The CLI
 * (`pack-characters.ts`) does the glTF work; everything here runs without gltf-transform.
 */

import { createHash } from "node:crypto";
import path from "node:path";
import {
  CHARACTER_RIGS,
  CLIP_ROLES,
  CharacterManifestSchema,
  type CharacterManifest,
  type CharacterModelKey,
  type CharacterRig,
  type ClipRole,
} from "../../src/lib/cityArena/characterManifest";
import { creditsFile } from "./credits";

/** Where the downloaded sources are cached (gitignored). */
export const CHARACTER_CACHE_DIR = path.join(".cache", "arena", "characters");
/** Where the packed output goes. */
export const CHARACTER_OUT_DIR = path.join("public", "arena", "characters");
/** The files are served from here. */
const SOURCE_HOST = "https://static.poly.pizza";
/** Their pages. */
const PAGE_HOST = "https://poly.pizza/m";

/** A licence a source is published under. */
export type CharacterLicence = "CC0 1.0" | "CC-BY 3.0";

/** One owner-approved model. */
export type CharacterSource = {
  key: CharacterModelKey;
  /** The model's name on its page. */
  title: string;
  uuid: string;
  /** Poly Pizza page id. */
  page: string;
  licence: CharacterLicence;
  gender: "male" | "female";
  /** Hex sha256 of the file as first downloaded; a file that differs is refused. */
  sha256: string;
};

/** Shorthand for a row of {@link CHARACTER_SOURCES}. */
function source(
  key: CharacterModelKey,
  title: string,
  ids: { uuid: string; page: string },
  licence: CharacterLicence,
  sha256: string,
): CharacterSource {
  const gender =
    key.endsWith("woman") || key.startsWith("woman") ? "female" : "male";
  return { key, title, ...ids, licence, gender, sha256 };
}

/** Quaternius' Ultimate Modular Men/Women packs, as approved by the owner (plan 3, "Approved sources"). */
export const CHARACTER_SOURCES: readonly CharacterSource[] = [
  source(
    "casual-man",
    "Casual Character",
    { uuid: "90a9e2d4-053f-42f1-99a2-8f5e1180ea7f", page: "kZ3DmIoGip" },
    "CC0 1.0",
    "fea7e71271203e7073f1a073fa1208de7402df276f87f80e149bf7589b5d46b4",
  ),
  source(
    "business-man",
    "Business Man",
    { uuid: "e599abbe-7d73-488c-9d7e-3ead281e705c", page: "JFrLIKqvCH" },
    "CC0 1.0",
    "82b81257c1e94cd9ee48cb1dcbe5ff506e81c9ce67cd0c5af542d8712dca546e",
  ),
  source(
    "hoodie-man",
    "Hoodie Character",
    { uuid: "bcd66ec5-5e81-4901-a222-47abc875fe2a", page: "gKLBoRsyKe" },
    "CC0 1.0",
    "0de1bcd789d409214cf82f66f61daeb53d2f7de6d914b23e7b3660bfb3dee61e",
  ),
  source(
    "worker-man",
    "Worker",
    { uuid: "3a5f3056-ffe6-42eb-bd52-122afcbd22b2", page: "Yg2bQZO6Hj" },
    "CC0 1.0",
    "9c28614f465b7dc105f908c20c22fc045f4b07caf8c5ef0e9f8049eceb6dd38d",
  ),
  source(
    "punk-man",
    "Punk",
    { uuid: "e56f23b5-3270-406f-8924-f77cad980c43", page: "BTALZymknF" },
    "CC0 1.0",
    "94afa8718093cc7f9e51cdc0b35f4432c1c2f1901177f98fbbbcb4c6fd79b163",
  ),
  source(
    "beach-man",
    "Beach Character",
    { uuid: "f771a536-1c18-4a47-bb56-ceea4b603455", page: "DojKLcO34E" },
    "CC0 1.0",
    "67c366f8c1e9ba3d3767213bc8660579a4f8028ed647a33c53d05596e8dd888c",
  ),
  source(
    "farmer-man",
    "Farmer",
    { uuid: "81f2f0cf-6f53-4b57-92ea-dba0928620f2", page: "7pn3R6hPvE" },
    "CC0 1.0",
    "f7ae6e2596c6521d296fa5948783f1dac717807456ce5355e48719e81d15e9a6",
  ),
  source(
    "swat",
    "SWAT",
    { uuid: "713f6535-f4f3-4367-a4c6-ced126ae0936", page: "Btfn3G5Xv4" },
    "CC0 1.0",
    "a835107bac833eb916c494e10997ae1709e85957ea6f6c59ace3c9a66f6d1fec",
  ),
  source(
    "woman-a",
    "Animated Woman",
    { uuid: "46d6db5a-3c9f-4238-8cdf-8eb7194498dc", page: "nIItLV9nxS" },
    "CC0 1.0",
    "a6522fe53d15de21130a957d1bf2b8a9a58d4e4e9a12af646645b667a9bb2d17",
  ),
  source(
    "woman-b",
    "Animated Woman",
    { uuid: "ba7a1955-ea51-4cb9-a561-188bdef0a6c7", page: "qJ2gsTUBHL" },
    "CC0 1.0",
    "a2212729826b718e59e698211ed3951c22459b48733b1ee6a24fac0abf74dca8",
  ),
  source(
    "punk-woman",
    "Punk",
    { uuid: "1d368679-1d9a-4d5c-9095-877144b02d00", page: "djXoqejw6w" },
    "CC0 1.0",
    "77cbb6838bf207fc948848ddb389ea43d4bb30c52ec62c5a2fc84bbf35c88c52",
  ),
  source(
    "adventurer-woman",
    "Adventurer",
    { uuid: "69689495-028d-4b81-8678-792338a5693e", page: "ZwF0K7WBmu" },
    "CC0 1.0",
    "38e4e6429d8af5849bb23e9585266f8c17dfe3e987bda89dec58f606aaedcf31",
  ),
  source(
    "hooded-woman",
    "Hooded Adventurer",
    { uuid: "3186b8e9-afd5-4d48-846c-b2b530cd23e2", page: "y9KWOVG21R" },
    "CC0 1.0",
    "703d20f529f7bc46763c4abc59db7df636d1a018e74e348c53341b4a1083608b",
  ),
  source(
    "suit-woman",
    "Suit",
    { uuid: "1bd7759c-ab76-4178-8fe6-7706dffa7d5f", page: "sOUciDsoVV" },
    "CC-BY 3.0",
    "12aece21fecd08fb079d2fa390faa40c705e26ea8f779b5005b8bf6cbe501837",
  ),
  source(
    "worker-woman",
    "Worker",
    { uuid: "c0253218-85f2-4d67-b3f2-a4611a7901fe", page: "E8079Ahx7k" },
    "CC-BY 3.0",
    "078e459440ae30ce6aa186f5fc1a5db075f308387c34eec4ada8c8f538ae2646",
  ),
];

/**
 * The URL a source downloads from.
 *
 * @param entry - The source.
 * @returns Its GLB on static.poly.pizza.
 */
export function sourceUrl(entry: CharacterSource): string {
  return `${SOURCE_HOST}/${entry.uuid}.glb`;
}

/**
 * The page a source is credited to.
 *
 * @param entry - The source.
 * @returns Its Poly Pizza page.
 */
export function pageUrl(entry: CharacterSource): string {
  return `${PAGE_HOST}/${entry.page}`;
}

/**
 * The hex sha256 of some bytes.
 *
 * @param bytes - The file.
 * @returns 64 hex digits.
 */
export function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** What the download needs from the outside world; tests pass fakes. */
export type SourceIo = {
  /** The cached file's bytes, or `null` when it is not cached. */
  read(file: string): Promise<Uint8Array | null>;
  write(file: string, bytes: Uint8Array): Promise<void>;
  fetch(
    url: string,
  ): Promise<{ ok: boolean; status: number; bytes(): Promise<Uint8Array> }>;
};

/** A downloaded source and its hash. */
export type FetchedSource = {
  entry: CharacterSource;
  bytes: Uint8Array;
  sha256: string;
};

/** Throws unless the bytes hash to the pinned value; an unpinned source passes (first download). */
function verify(entry: CharacterSource, bytes: Uint8Array): string {
  const hash = sha256Of(bytes);
  if (entry.sha256 !== "" && hash !== entry.sha256)
    throw new Error(
      `${entry.key}: sha256 ${hash} does not match the pinned ${entry.sha256}; refusing the file`,
    );
  return hash;
}

/**
 * A source from the cache, or downloaded into it, verified against its pinned sha256.
 *
 * @param entry - The source.
 * @param io - File and network access.
 * @param cacheDir - The cache directory.
 * @returns The bytes and their hash.
 */
export async function fetchSource(
  entry: CharacterSource,
  io: SourceIo,
  cacheDir: string = CHARACTER_CACHE_DIR,
): Promise<FetchedSource> {
  const file = path.join(cacheDir, `${entry.key}.glb`);
  const cached = await io.read(file);
  if (cached) return { entry, bytes: cached, sha256: verify(entry, cached) };
  const response = await io.fetch(sourceUrl(entry));
  if (!response.ok)
    throw new Error(
      `${entry.key}: download failed with HTTP ${response.status}`,
    );
  const bytes = await response.bytes();
  const sha256 = verify(entry, bytes);
  await io.write(file, bytes);
  return { entry, bytes, sha256 };
}

/** The source whose animations every model of a rig plays: all men share one skeleton, all women the other. */
export const RIG_ANIMATION_SOURCES: Record<CharacterRig, CharacterModelKey> = {
  men: "casual-man",
  women: "woman-a",
};

/**
 * The rig a source is built on.
 *
 * @param entry - The source.
 * @returns `men` or `women`.
 */
export function rigOf(entry: CharacterSource): CharacterRig {
  return entry.gender === "male" ? "men" : "women";
}

/** The pack's animation names for each role, best first; the packs name them alike for both rigs. */
export const CLIP_CANDIDATES: Record<ClipRole, readonly string[]> = {
  idle: ["Idle", "Idle_Neutral"],
  walk: ["Walk"],
  run: ["Run"],
  death: ["Death"],
  punch: ["Punch_Right", "Punch_Left"],
  gunIdle: ["Idle_Gun_Pointing", "Idle_Gun"],
  gunShoot: ["Gun_Shoot", "Idle_Gun_Shoot"],
  swing: ["Sword_Slash"],
};

/**
 * An animation's name without the armature prefix Blender writes (`CharacterArmature|Walk`).
 *
 * @param name - The name in the file.
 * @returns The part after the last `|`.
 */
export function shortClipName(name: string): string {
  return name.slice(name.lastIndexOf("|") + 1);
}

/**
 * The clip playing each role, picked from a rig's animation names.
 *
 * @param names - The animation names in the file, with or without the armature prefix.
 * @returns The short name for every role.
 * @throws When a role has none of its candidates.
 */
export function clipRolesFrom(
  names: readonly string[],
): Record<ClipRole, string> {
  const available = new Set(names.map(shortClipName));
  const roles: Partial<Record<ClipRole, string>> = {};
  for (const role of CLIP_ROLES) {
    const pick = CLIP_CANDIDATES[role].find((name) => available.has(name));
    if (!pick)
      throw new Error(
        `no animation for "${role}" among ${[...available].join(", ")}`,
      );
    roles[role] = pick;
  }
  return roles as Record<ClipRole, string>;
}

/** Keyframes closer to the rest value than this are the rest value. */
export const REST_TOLERANCE = 1e-5;

/** True when `values` holds the same tuple as `rest` (or, for a quaternion, its negation). */
function sameTuple(
  values: ArrayLike<number>,
  offset: number,
  rest: readonly number[],
): boolean {
  let same = true;
  let negated = rest.length === 4;
  for (let index = 0; index < rest.length; index += 1) {
    const value = values[offset + index];
    if (Math.abs(value - rest[index]) > REST_TOLERANCE) same = false;
    if (Math.abs(value + rest[index]) > REST_TOLERANCE) negated = false;
  }
  return same || negated;
}

/**
 * Whether an animation channel only ever holds its node's rest value — a scale of one, a bone's
 * own offset — and so can be dropped. Dropping it also lets a model whose bones sit a little
 * differently keep its own proportions.
 *
 * @param values - The sampler's output, tuples back to back.
 * @param rest - The node's rest translation, rotation or scale.
 * @returns `true` when every keyframe equals the rest value.
 */
export function isRestChannel(
  values: ArrayLike<number>,
  rest: readonly number[],
): boolean {
  for (let offset = 0; offset < values.length; offset += rest.length)
    if (!sameTuple(values, offset, rest)) return false;
  return true;
}

/**
 * Parts whose colours get their own palette slot when their material also colours another part:
 * some models paint the hair and the top, or the hair and the shoes, with one material.
 */
const SPLIT_PARTS: ReadonlySet<string> = new Set(["Head", "Feet"]);

/**
 * The body part a mesh is (`Casual2_Head` → `Head`): the packs name each mesh after its part.
 *
 * @param meshName - The mesh's name.
 * @returns The part after the last `_`.
 */
export function partOfMesh(meshName: string): string {
  return meshName.slice(meshName.lastIndexOf("_") + 1);
}

/**
 * The palette slot a material takes on a part: its own name, or `Part/Name` on the head or feet
 * when the material also colours another part, so hair and shoes can be recoloured apart from
 * the clothes.
 *
 * @param material - The material's name.
 * @param part - The mesh's part.
 * @param partsUsing - Every part the material colours.
 * @returns The slot name.
 */
export function slotName(
  material: string,
  part: string,
  partsUsing: ReadonlySet<string>,
): string {
  return SPLIT_PARTS.has(part) && partsUsing.size > 1
    ? `${part}/${material}`
    : material;
}

/** Bone influences per vertex. */
const INFLUENCES = 4;
/** A normalised byte's full scale. */
const UNORM8_MAX = 255;

/**
 * Skin weights as normalised bytes that still sum to one per vertex: each weight is rounded down
 * and the leftover steps go to the weights that lost the most.
 *
 * @param weights - Four weights per vertex, each group summing to one.
 * @returns The same weights in 0…255.
 */
export function unormWeights(weights: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(weights.length);
  const order = [0, 1, 2, 3];
  for (let base = 0; base < weights.length; base += INFLUENCES) {
    let spare = UNORM8_MAX;
    for (let index = 0; index < INFLUENCES; index += 1) {
      out[base + index] = Math.floor(weights[base + index] * UNORM8_MAX);
      spare -= out[base + index];
    }
    const lost = (index: number): number =>
      weights[base + index] * UNORM8_MAX - out[base + index];
    order.sort((first, second) => lost(second) - lost(first));
    for (let step = 0; step < spare && step < INFLUENCES; step += 1)
      out[base + order[step]] += 1;
  }
  return out;
}

/** sRGB transfer below this linear value is a straight line. */
const SRGB_LINEAR_KNEE = 0.0031308;
/** Slope of that line. */
const SRGB_LINEAR_SLOPE = 12.92;
/** The curve's exponent, scale and offset. */
const SRGB_GAMMA = 2.4;
const SRGB_SCALE = 1.055;
const SRGB_OFFSET = 0.055;
/** One 8-bit channel. */
const CHANNEL_MAX = 255;

/** One linear channel to an 8-bit sRGB value. */
function srgbChannel(linear: number): number {
  const clamped = Math.min(1, Math.max(0, linear));
  const encoded =
    clamped <= SRGB_LINEAR_KNEE
      ? clamped * SRGB_LINEAR_SLOPE
      : SRGB_SCALE * clamped ** (1 / SRGB_GAMMA) - SRGB_OFFSET;
  return Math.round(encoded * CHANNEL_MAX);
}

/**
 * A glTF base colour factor (linear) as an sRGB hex colour.
 *
 * @param linear - `[r, g, b, …]` in 0…1.
 * @returns `0xRRGGBB`.
 */
export function srgbHexOf(linear: readonly number[]): number {
  return (
    (srgbChannel(linear[0]) << 16) |
    (srgbChannel(linear[1]) << 8) |
    srgbChannel(linear[2])
  );
}

/** What the pack learned about one model. */
export type PackedModel = {
  entry: CharacterSource;
  materials: string[];
  colours: number[];
  height: number;
  bytes: number;
};

/** What the pack wrote for one rig's animations. */
export type PackedRig = {
  rig: CharacterRig;
  clips: Record<ClipRole, string>;
  bytes: number;
};

/**
 * The file a packed model is written to.
 *
 * @param key - The model.
 * @returns Its file name under {@link CHARACTER_OUT_DIR}.
 */
export function modelFile(key: CharacterModelKey): string {
  return `${key}.glb`;
}

/**
 * The file a rig's animations are written to.
 *
 * @param rig - The rig.
 * @returns Its file name under {@link CHARACTER_OUT_DIR}.
 */
export function animationFile(rig: CharacterRig): string {
  return `anim-${rig}.glb`;
}

/** Digits a height keeps in the manifest (a tenth of a millimetre). */
const HEIGHT_DECIMALS = 4;

/**
 * The manifest for what the pack wrote, validated against the schema the 3D view reads.
 *
 * @param models - Every packed model.
 * @param rigs - Both rigs' animations.
 * @returns The manifest.
 */
export function buildManifest(
  models: readonly PackedModel[],
  rigs: readonly PackedRig[],
): CharacterManifest {
  const manifest = {
    models: Object.fromEntries(
      models.map(({ entry, materials, colours, height }) => [
        entry.key,
        {
          file: modelFile(entry.key),
          rig: rigOf(entry),
          gender: entry.gender,
          materials,
          colours,
          height: Number(height.toFixed(HEIGHT_DECIMALS)),
        },
      ]),
    ),
    animations: Object.fromEntries(
      rigs.map(({ rig, clips }) => [rig, { file: animationFile(rig), clips }]),
    ),
  };
  return CharacterManifestSchema.parse(manifest);
}

/** The pack both licences' sources come from. */
const PACK_NAME = "Quaternius — Ultimate Modular Men/Women";
/** Their author. */
const AUTHOR = "Quaternius";

/** The licences' deeds, linked from the credits. */
const LICENCE_LINKS: Record<CharacterLicence, string> = {
  "CC0 1.0": "[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)",
  "CC-BY 3.0": "[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)",
};

/** A credits row. */
function creditRow(
  file: string,
  what: string,
  licence: CharacterLicence,
  url: string,
): string {
  return `| ${file} | ${what} (${PACK_NAME}, via Poly Pizza) | ${AUTHOR} | ${LICENCE_LINKS[licence]} | ${url} |`;
}

/**
 * `public/arena/characters/CREDITS.md`: one row per packed file. A rig's animation file is
 * credited to the model it was taken from.
 *
 * @param sources - Every source, in table order.
 * @returns The file contents.
 */
export function characterCredits(sources: readonly CharacterSource[]): string {
  const rows = sources.map((entry) =>
    creditRow(modelFile(entry.key), entry.title, entry.licence, pageUrl(entry)),
  );
  for (const rig of CHARACTER_RIGS) {
    const from = sources.find(
      (entry) => entry.key === RIG_ANIMATION_SOURCES[rig],
    );
    if (!from) continue;
    rows.push(
      creditRow(
        animationFile(rig),
        `${from.title} — animations`,
        from.licence,
        pageUrl(from),
      ),
    );
  }
  return creditsFile(
    "Character credits",
    "Every file under `public/arena/characters/`, where it came from, and the licence it carries. Modified by `npm run arena:pack-characters`: each model's meshes are merged into one, its materials become a recolourable palette, its normals, UVs and animations are dropped; each rig's animation file keeps only the clips the game plays.",
    rows,
  );
}
