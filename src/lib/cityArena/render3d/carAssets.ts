/**
 * The packed Kenney Car Kit models (spec §8), loaded lazily once the 3D view asks for a vehicle:
 * the manifest and one file per kind, parsed with three's `GLTFLoader` and kept for the session.
 * A network failure leaves a breadcrumb and a broken file an exception; either way the vehicles
 * stay procedural for the session. `disposeGltfCarAssets` frees them with the rest of the view's
 * shared assets; the next view loads them again.
 */
import * as Sentry from "@sentry/nextjs";
import type { Material, Mesh, Object3D } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { isBenignTransientClientFetchError } from "../../benignClientFetchErrors";
import {
  CAR_KINDS,
  CAR_WHEEL_NODES,
  CarManifestSchema,
  type CarEntry,
  type CarKind,
  type CarManifest,
} from "../carManifest";

/** Where the packed cars are served from. */
export const CAR_ASSET_BASE = "/arena/cars/";
/** The manifest's file name. */
const MANIFEST_FILE = "manifest.json";
/** The node every packed body's primitives hang under. */
export const CAR_BODY_NODE = "body";
/** Tags on everything this module reports. */
const SENTRY_TAGS = { component: "arena-3d", area: "cars" } as const;

/** One packed car, ready to build vehicles from. */
export type CarAsset = {
  kind: CarKind;
  entry: CarEntry;
  /** The parsed scene; its geometry is read, never added to a scene itself. */
  scene: Object3D;
};

/** Every packed car. */
export type CarAssets = { cars: Record<CarKind, CarAsset> };

/** What loading needs from the outside; tests pass fakes. */
export type CarAssetIo = {
  fetch: (url: string) => Promise<Response>;
  parse: (bytes: ArrayBuffer) => Promise<{ scene: Object3D }>;
};

/** A response that is not a 2xx, or a file missing a part: broken on the server, not the network. */
class CarFileError extends Error {}

/** Fetches a file's bytes; a non-2xx status is a {@link CarFileError}. */
async function fetchBytes(io: CarAssetIo, file: string): Promise<ArrayBuffer> {
  const response = await io.fetch(`${CAR_ASSET_BASE}${file}`);
  if (!response.ok) throw new CarFileError(`${file}: HTTP ${response.status}`);
  return response.arrayBuffer();
}

/** Fetches and validates the manifest. */
async function fetchManifest(io: CarAssetIo): Promise<CarManifest> {
  const bytes = await fetchBytes(io, MANIFEST_FILE);
  return CarManifestSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
}

/**
 * The object a glTF node became: `GLTFLoader` keeps the node's own name in `userData.name` and
 * may make `name` unique.
 *
 * @param scene - A parsed scene.
 * @param node - The node's name in the file.
 * @returns The object, or undefined.
 */
export function carNode(scene: Object3D, node: string): Object3D | undefined {
  let found: Object3D | undefined;
  scene.traverse((object) => {
    if (!found && (object.userData.name ?? object.name) === node)
      found = object;
  });
  return found;
}

/** Throws unless a parsed car has its body and all four wheels. */
function checkParts(kind: CarKind, scene: Object3D): void {
  for (const node of [CAR_BODY_NODE, ...CAR_WHEEL_NODES])
    if (!carNode(scene, node)) throw new CarFileError(`${kind}: no ${node}`);
}

/**
 * Builds the assets from the manifest and every parsed file.
 *
 * @param manifest - The validated manifest.
 * @param files - Each file the manifest names, parsed.
 * @returns The assets.
 * @throws When a file is missing, or lacks its body or a wheel.
 */
export function assembleCarAssets(
  manifest: CarManifest,
  files: ReadonlyMap<string, { scene: Object3D }>,
): CarAssets {
  const cars = {} as Record<CarKind, CarAsset>;
  for (const kind of CAR_KINDS) {
    const entry = manifest.cars[kind];
    const parsed = files.get(entry.file);
    if (!parsed) throw new CarFileError(`${entry.file}: not loaded`);
    checkParts(kind, parsed.scene);
    cars[kind] = { kind, entry, scene: parsed.scene };
  }
  return { cars };
}

/** Fetches and parses every file the manifest names. */
async function loadFiles(
  io: CarAssetIo,
  manifest: CarManifest,
): Promise<Map<string, { scene: Object3D }>> {
  const files = Object.values(manifest.cars).map((car) => car.file);
  const parsed = await Promise.all(
    files.map(async (file) => io.parse(await fetchBytes(io, file))),
  );
  return new Map(files.map((file, index) => [file, parsed[index]]));
}

/**
 * Frees a parsed scene's geometry and materials.
 *
 * @param scene - The scene.
 */
export function disposeCarScene(scene: Object3D): void {
  scene.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const materials: Material[] = Array.isArray(mesh.material)
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
      message: "3D cars failed to download; the procedural vehicles stay",
      data: { error: String(error) },
    });
    return;
  }
  Sentry.captureException(error, { tags: SENTRY_TAGS });
}

/** The session's loading state. */
type LoadState = {
  pending: Promise<CarAssets | null> | null;
  assets: CarAssets | null;
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
  io: CarAssetIo,
  generation: number,
): Promise<CarAssets | null> {
  try {
    const manifest = await fetchManifest(io);
    const assets = assembleCarAssets(manifest, await loadFiles(io, manifest));
    if (generation !== state.generation) {
      for (const car of Object.values(assets.cars)) disposeCarScene(car.scene);
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
function browserIo(): CarAssetIo {
  const loader = new GLTFLoader();
  return {
    fetch: (url) => fetch(url),
    parse: (bytes) => loader.parseAsync(bytes, CAR_ASSET_BASE),
  };
}

/**
 * Starts loading the cars (once per session; again after a dispose) and resolves with them, or
 * `null` when loading failed — reported once, and never retried this session.
 *
 * @param io - Fetching and parsing; the browser's by default.
 * @returns The assets, or `null`.
 */
export function loadCarAssets(io?: CarAssetIo): Promise<CarAssets | null> {
  if (state.assets) return Promise.resolve(state.assets);
  if (state.failed) return Promise.resolve(null);
  state.pending ??= load(io ?? browserIo(), state.generation);
  return state.pending;
}

/**
 * Starts loading the cars in the browser unless they are loaded, loading or failed. Cheap enough
 * to call every frame: it allocates nothing once loading has started.
 */
export function requestCarAssets(): void {
  if (state.assets || state.pending || state.failed) return;
  state.pending = load(browserIo(), state.generation);
}

/**
 * The loaded cars, or `null` while they load, after a failure, or before anyone asked.
 *
 * @returns The assets or `null`.
 */
export function carAssetsReady(): CarAssets | null {
  return state.assets;
}

/**
 * Frees the loaded cars' geometry and materials and forgets them (a load still in flight is
 * thrown away when it lands). A failed load stays failed: the session keeps procedural vehicles.
 */
export function disposeGltfCarAssets(): void {
  if (state.assets)
    for (const car of Object.values(state.assets.cars))
      disposeCarScene(car.scene);
  state.assets = null;
  state.pending = null;
  state.generation += 1;
}

/** Forgets a failure too; for tests, which each start a fresh session. */
export function resetCarAssetsForTests(): void {
  disposeGltfCarAssets();
  state.failed = false;
}
