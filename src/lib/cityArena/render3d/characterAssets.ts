/**
 * The packed glTF characters (spec §7), loaded lazily once the 3D view starts: the manifest, every
 * model and both rigs' animations, parsed with three's `GLTFLoader` and kept for the session. A
 * network failure leaves a breadcrumb and a broken file an exception; either way the characters
 * stay procedural for the session. `disposeGltfCharacterAssets` frees the geometry with the rest
 * of the view's shared assets; the next view loads them again.
 */
import * as Sentry from "@sentry/nextjs";
import {
  AnimationClip,
  Sphere,
  type BufferGeometry,
  type Object3D,
  type SkinnedMesh,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
import { isBenignTransientClientFetchError } from "../../benignClientFetchErrors";
import {
  CHARACTER_MODEL_KEYS,
  CHARACTER_RIGS,
  CLIP_ROLES,
  CharacterManifestSchema,
  PALETTE_SLOTS,
  type CharacterManifest,
  type CharacterModelKey,
  type CharacterRig,
  type ClipRole,
} from "../characterManifest";
import {
  RIG_STRIDES,
  isUpperBodyTrack,
  type GaitRole,
  type GaitStride,
} from "./characterAnimation";
import { writePaletteSlot } from "./characterPalette";

/** Where the packed characters are served from. */
export const CHARACTER_ASSET_BASE = "/arena/characters/";
/** The manifest's file name. */
const MANIFEST_FILE = "manifest.json";
/**
 * The models ship without normals; they are rebuilt creased at this angle (smooth across gentler
 * folds, hard edges beyond), which matches the packs' own shading.
 */
const CREASE_ANGLE_RAD = (50 * Math.PI) / 180;
/**
 * `toCreasedNormals` merges vertices on a 0.01-unit grid; the meshes are authored in hundredths
 * of a metre, so they are scaled up for the merge and back afterwards.
 */
const NORMAL_MERGE_SCALE = 1e4;
/** The culling sphere grows by this much over the standing bind pose, to hold any pose. */
const CULL_MARGIN = 1.8;
/** The gait clips, split into legs and upper body so a raised gun can replace the arms. */
const GAIT_ROLES: readonly GaitRole[] = ["idle", "walk", "run"];
/** Clips the upper body plays over the gait. */
const OVERLAY_ROLES: readonly ClipRole[] = [
  "gunIdle",
  "gunShoot",
  "punch",
  "swing",
];
/** Tags on everything this module reports. */
const SENTRY_TAGS = { component: "arena-3d", area: "characters" } as const;

/** One packed model, ready to clone. */
export type ModelAsset = {
  key: CharacterModelKey;
  /** The parsed scene; cloned per character, never added to a scene itself. */
  scene: Object3D;
  rig: CharacterRig;
  female: boolean;
  /** Palette slot names, by slot. */
  slots: readonly string[];
  /** The model's own colours by slot, linear RGB — the default palette. */
  palette: Float32Array;
};

/** One rig's animations, split for layering. */
export type RigAsset = {
  /** Full-body clips (the death). */
  clips: Record<ClipRole, AnimationClip>;
  /** The legs and hips of the idle, walk and run. */
  lower: Record<GaitRole, AnimationClip>;
  /** The upper body of every clip. */
  upper: Record<ClipRole, AnimationClip>;
  /** Standing height of a typical model of the rig (the median), in the files' units. */
  referenceHeight: number;
  /** Stride per cycle at {@link RigAsset.referenceHeight}. */
  stride: GaitStride;
};

/** Everything the glTF characters need. */
export type CharacterAssets = {
  models: Record<CharacterModelKey, ModelAsset>;
  rigs: Record<CharacterRig, RigAsset>;
};

/** A parsed glTF: its scene and its animations. */
export type ParsedGltf = { scene: Object3D; animations: AnimationClip[] };

/** What loading needs from the outside; tests pass fakes. */
export type CharacterAssetIo = {
  fetch: (url: string) => Promise<Response>;
  parse: (bytes: ArrayBuffer) => Promise<ParsedGltf>;
};

/** A response that is not a 2xx: the file is broken or missing on the server, not the network. */
class CharacterFileError extends Error {}

/** Fetches a file's bytes; a non-2xx status is a {@link CharacterFileError}. */
async function fetchBytes(
  io: CharacterAssetIo,
  file: string,
): Promise<ArrayBuffer> {
  const response = await io.fetch(`${CHARACTER_ASSET_BASE}${file}`);
  if (!response.ok)
    throw new CharacterFileError(`${file}: HTTP ${response.status}`);
  return response.arrayBuffer();
}

/** Fetches and validates the manifest. */
async function fetchManifest(io: CharacterAssetIo): Promise<CharacterManifest> {
  const bytes = await fetchBytes(io, MANIFEST_FILE);
  return CharacterManifestSchema.parse(
    JSON.parse(new TextDecoder().decode(bytes)),
  );
}

/** The one skinned mesh of a packed model. */
function skinnedMeshOf(scene: Object3D, key: string): SkinnedMesh {
  let found: SkinnedMesh | null = null;
  scene.traverse((node) => {
    if ((node as SkinnedMesh).isSkinnedMesh) found = node as SkinnedMesh;
  });
  if (!found) throw new CharacterFileError(`${key}: no skinned mesh`);
  return found;
}

/** Rebuilds creased normals (the pack drops them) and a culling sphere that holds any pose. */
function prepareGeometry(mesh: SkinnedMesh): void {
  const source = mesh.geometry;
  source.scale(NORMAL_MERGE_SCALE, NORMAL_MERGE_SCALE, NORMAL_MERGE_SCALE);
  const creased: BufferGeometry = toCreasedNormals(source, CREASE_ANGLE_RAD);
  const back = 1 / NORMAL_MERGE_SCALE;
  creased.scale(back, back, back);
  source.dispose();
  creased.computeBoundingSphere();
  const sphere = creased.boundingSphere ?? new Sphere();
  sphere.radius *= CULL_MARGIN;
  mesh.geometry = creased;
  mesh.boundingSphere = sphere;
}

/** A model's default palette from the manifest's colours. */
function paletteOf(colours: readonly number[]): Float32Array {
  const palette = new Float32Array(PALETTE_SLOTS * 3).fill(1);
  colours.forEach((hex, slot) => writePaletteSlot(palette, slot, hex));
  return palette;
}

/** One model from its manifest entry and parsed file. */
function modelAsset(
  key: CharacterModelKey,
  entry: CharacterManifest["models"][CharacterModelKey],
  gltf: ParsedGltf,
): ModelAsset {
  prepareGeometry(skinnedMeshOf(gltf.scene, key));
  return {
    key,
    scene: gltf.scene,
    rig: entry.rig,
    female: entry.gender === "female",
    slots: entry.materials,
    palette: paletteOf(entry.colours),
  };
}

/** A clip keeping only the tracks `keep` accepts. */
function subClip(
  clip: AnimationClip,
  name: string,
  keep: (trackName: string) => boolean,
): AnimationClip {
  const tracks = clip.tracks.filter((track) => keep(track.name));
  return new AnimationClip(name, clip.duration, tracks);
}

/** The rig's clips by role, looked up by the manifest's names. */
function clipsByRole(
  names: Record<ClipRole, string>,
  animations: readonly AnimationClip[],
): Record<ClipRole, AnimationClip> {
  const clips = {} as Record<ClipRole, AnimationClip>;
  for (const role of CLIP_ROLES) {
    const clip = animations.find((candidate) => candidate.name === names[role]);
    if (!clip) throw new CharacterFileError(`no clip ${names[role]}`);
    clips[role] = clip;
  }
  return clips;
}

/** The median of some numbers. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** One rig's animations, split into legs and upper body. */
function rigAsset(
  rig: CharacterRig,
  manifest: CharacterManifest,
  gltf: ParsedGltf,
): RigAsset {
  const clips = clipsByRole(manifest.animations[rig].clips, gltf.animations);
  const lower = {} as Record<GaitRole, AnimationClip>;
  const upper = {} as Record<ClipRole, AnimationClip>;
  const isLower = (name: string): boolean => !isUpperBodyTrack(name);
  for (const role of GAIT_ROLES)
    lower[role] = subClip(clips[role], `${role}:lower`, isLower);
  for (const role of [...GAIT_ROLES, ...OVERLAY_ROLES])
    upper[role] = subClip(clips[role], `${role}:upper`, isUpperBodyTrack);
  upper.death = clips.death;
  const heights = Object.values(manifest.models)
    .filter((model) => model.rig === rig)
    .map((model) => model.height);
  return {
    clips,
    lower,
    upper,
    referenceHeight: median(heights),
    stride: RIG_STRIDES[rig],
  };
}

/**
 * Builds the assets from the manifest and every parsed file.
 *
 * @param manifest - The validated manifest.
 * @param files - Each file the manifest names, parsed.
 * @returns The assets.
 */
export function assembleCharacterAssets(
  manifest: CharacterManifest,
  files: ReadonlyMap<string, ParsedGltf>,
): CharacterAssets {
  const parsed = (file: string): ParsedGltf => {
    const gltf = files.get(file);
    if (!gltf) throw new CharacterFileError(`${file}: not loaded`);
    return gltf;
  };
  const models = {} as Record<CharacterModelKey, ModelAsset>;
  for (const key of CHARACTER_MODEL_KEYS) {
    const entry = manifest.models[key];
    models[key] = modelAsset(key, entry, parsed(entry.file));
  }
  const rigs = {} as Record<CharacterRig, RigAsset>;
  for (const rig of CHARACTER_RIGS)
    rigs[rig] = rigAsset(rig, manifest, parsed(manifest.animations[rig].file));
  return { models, rigs };
}

/** Fetches and parses every file the manifest names. */
async function loadFiles(
  io: CharacterAssetIo,
  manifest: CharacterManifest,
): Promise<Map<string, ParsedGltf>> {
  const files = [
    ...Object.values(manifest.models).map((model) => model.file),
    ...Object.values(manifest.animations).map((rig) => rig.file),
  ];
  const parsed = await Promise.all(
    files.map(async (file) => io.parse(await fetchBytes(io, file))),
  );
  return new Map(files.map((file, index) => [file, parsed[index]]));
}

/** Frees a parsed scene's geometry and materials. */
function disposeScene(scene: Object3D): void {
  scene.traverse((node) => {
    const mesh = node as SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const material of materials) material.dispose();
  });
}

/** Reports a failed load: a breadcrumb for a network blip, an exception for anything else. */
function reportLoadFailure(error: unknown): void {
  if (isBenignTransientClientFetchError(error)) {
    Sentry.addBreadcrumb({
      category: "arena",
      level: "warning",
      message: "3D characters failed to download; the procedural cast stays",
      data: { error: String(error) },
    });
    return;
  }
  Sentry.captureException(error, { tags: SENTRY_TAGS });
}

/** The session's loading state. */
type LoadState = {
  pending: Promise<CharacterAssets | null> | null;
  assets: CharacterAssets | null;
  /** A load failed: stay procedural for the rest of the session. */
  failed: boolean;
  /** Bumped by every dispose, so a load that lands after one is thrown away. */
  generation: number;
};

const state: LoadState = {
  pending: null,
  assets: null,
  failed: false,
  generation: 0,
};

/** Loads everything; resolves `null` (after reporting) when anything fails. */
async function load(
  io: CharacterAssetIo,
  generation: number,
): Promise<CharacterAssets | null> {
  try {
    const manifest = await fetchManifest(io);
    const assets = assembleCharacterAssets(
      manifest,
      await loadFiles(io, manifest),
    );
    if (generation !== state.generation) {
      for (const model of Object.values(assets.models))
        disposeScene(model.scene);
      return null;
    }
    state.assets = assets;
    return assets;
  } catch (error: unknown) {
    state.failed = true;
    reportLoadFailure(error);
    return null;
  }
}

/** The browser's fetch and three's `GLTFLoader`. */
function browserIo(): CharacterAssetIo {
  const loader = new GLTFLoader();
  return {
    fetch: (url) => fetch(url),
    parse: (bytes) => loader.parseAsync(bytes, CHARACTER_ASSET_BASE),
  };
}

/**
 * Starts loading the characters (once per session; again after a dispose) and resolves with
 * them, or `null` when loading failed — reported once, and never retried this session.
 *
 * @param io - Fetching and parsing; the browser's by default.
 * @returns The assets, or `null`.
 */
export function loadCharacterAssets(
  io?: CharacterAssetIo,
): Promise<CharacterAssets | null> {
  if (state.assets) return Promise.resolve(state.assets);
  if (state.failed) return Promise.resolve(null);
  if (!state.pending) {
    state.pending = load(io ?? browserIo(), state.generation);
  }
  return state.pending;
}

/**
 * Starts loading the characters in the browser unless they are loaded, loading or failed. Cheap
 * enough to call every frame: it allocates nothing once loading has started.
 */
export function requestCharacterAssets(): void {
  if (state.assets || state.pending || state.failed) return;
  state.pending = load(browserIo(), state.generation);
}

/**
 * The loaded characters, or `null` while they load, after a failure, or before anyone asked.
 *
 * @returns The assets or `null`.
 */
export function characterAssetsReady(): CharacterAssets | null {
  return state.assets;
}

/**
 * Frees the loaded characters' geometry and materials and forgets them (a load still in flight is
 * thrown away when it lands). A failed load stays failed: the session keeps the procedural cast.
 */
export function disposeGltfCharacterAssets(): void {
  if (state.assets)
    for (const model of Object.values(state.assets.models))
      disposeScene(model.scene);
  state.assets = null;
  state.pending = null;
  state.generation += 1;
}

/** Forgets a failure too; for tests, which each start a fresh session. */
export function resetCharacterAssetsForTests(): void {
  disposeGltfCharacterAssets();
  state.failed = false;
}
