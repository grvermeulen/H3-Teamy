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

/** Whether a mesh carries the vertex colours a packed car is drawn in. */
function isColouredMesh(object: Object3D): boolean {
  const mesh = object as Mesh;
  return (
    mesh.isMesh === true && mesh.geometry.getAttribute("color") !== undefined
  );
}

/**
 * Throws unless a parsed car has its body (every mesh in it coloured) and all four wheels, each
 * one coloured mesh: what the view builds from, checked once so a broken file fails the load
 * instead of a frame.
 */
function checkParts(kind: CarKind, scene: Object3D): void {
  const body = carNode(scene, CAR_BODY_NODE);
  if (!body) throw new CarFileError(`${kind}: no ${CAR_BODY_NODE}`);
  body.traverse((node) => {
    if ((node as Mesh).isMesh && !isColouredMesh(node))
      throw new CarFileError(`${kind}: a body part without vertex colours`);
  });
  for (const node of CAR_WHEEL_NODES) {
    const wheel = carNode(scene, node);
    if (!wheel || !isColouredMesh(wheel))
      throw new CarFileError(`${kind}: no coloured ${node}`);
  }
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

/** The parsed files by name. */
type CarFiles = Map<string, { scene: Object3D }>;

/** Fetches and parses every file the manifest names; when one fails, frees the others first. */
async function loadFiles(
  io: CarAssetIo,
  manifest: CarManifest,
): Promise<CarFiles> {
  const files = Object.values(manifest.cars).map((car) => car.file);
  const settled = await Promise.allSettled(
    files.map(async (file) => io.parse(await fetchBytes(io, file))),
  );
  const parsed: CarFiles = new Map();
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") parsed.set(files[index]!, result.value);
  });
  const failure = settled.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (!failure) return parsed;
  disposeCarFiles(parsed);
  throw failure.reason;
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

/** Frees every parsed file's scene. */
function disposeCarFiles(files: CarFiles): void {
  for (const { scene } of files.values()) disposeCarScene(scene);
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

/**
 * Loads everything; resolves `null` (after reporting) when anything fails. Whatever was parsed is
 * freed unless it is kept, and only a load still current marks the session failed: one a dispose
 * threw away must not keep the next view procedural.
 */
async function load(
  io: CarAssetIo,
  generation: number,
): Promise<CarAssets | null> {
  let files: CarFiles | null = null;
  try {
    const manifest = await fetchManifest(io);
    files = await loadFiles(io, manifest);
    const assets = assembleCarAssets(manifest, files);
    if (generation !== state.generation) {
      disposeCarFiles(files);
      return null;
    }
    state.assets = assets;
    return assets;
  } catch (error: unknown) {
    if (files) disposeCarFiles(files);
    if (generation === state.generation) state.failed = true;
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
