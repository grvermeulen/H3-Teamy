import * as Sentry from "@sentry/nextjs";
import type { CanvasFactory } from "./canvasTypes";
import { CAR_BODY_COLOURS } from "./palette";
import {
  NO_SPRITES,
  SPRITE_MANIFEST_PATH,
  parseSpriteManifest,
  type ArenaSprites,
  type GroundTextures,
  type PersonSprite,
  type SpriteManifest,
  type SurfaceTexture,
  type VehicleSprite,
} from "./sprites";

/** Decodes one image URL; injectable so tests need no real network or `Image` decoding. */
export type ImageLoader = (src: string) => Promise<CanvasImageSource>;

/** Everything {@link createSpriteStore} needs; each field has a browser default. */
export type SpriteStoreOptions = {
  fetchImpl?: typeof fetch;
  loadImage?: ImageLoader;
  canvasFactory?: CanvasFactory;
  manifestPath?: string;
};

/**
 * The sprite set the painters read. `current()` returns {@link NO_SPRITES} until `load()` has
 * resolved, so a frame drawn before the art arrives — or after it failed — uses the flat fills.
 */
export type SpriteStore = {
  current(): ArenaSprites;
  load(): Promise<boolean>;
};

/** Reports a sprite failure once, tagged so it is not confused with map-tile failures. */
function reportSpriteFailure(error: unknown, step: string): void {
  Sentry.captureException(error, {
    tags: { area: "arena", kind: "sprite", step },
  });
}

/** Decodes one image with the browser's `Image`, rejecting when the file is missing or corrupt. */
function loadImageElement(src: string): Promise<CanvasImageSource> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error(`Sprite image failed to load: ${src}`));
    image.src = src;
  });
}

/** Fetches and validates the generated manifest. */
async function fetchManifest(
  fetchImpl: typeof fetch,
  manifestPath: string,
): Promise<SpriteManifest> {
  const response = await fetchImpl(manifestPath);
  if (!response.ok)
    throw new Error(
      `Sprite manifest ${manifestPath} returned ${response.status}`,
    );
  return parseSpriteManifest(await response.json());
}

/**
 * One greyscale sprite recoloured to `colour`: the art is multiplied by a flat fill, then masked
 * back to its own alpha so the transparent surround stays transparent. Returns `null` when the
 * factory has no 2D context, which leaves the untinted art in play.
 */
function tintSprite(
  factory: CanvasFactory,
  image: CanvasImageSource,
  width: number,
  height: number,
  colour: string,
): CanvasImageSource | null {
  const target = factory(width, height);
  if (!target) return null;
  const { ctx } = target;
  ctx.drawImage(image, 0, 0, width, height);
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(image, 0, 0, width, height);
  ctx.globalCompositeOperation = "source-over";
  return target.canvas;
}

/** The car sprite plus one copy per entry of {@link CAR_BODY_COLOURS}. */
function buildVehicleSprite(
  factory: CanvasFactory,
  image: CanvasImageSource,
  manifest: SpriteManifest,
): VehicleSprite {
  const { pixelWidth, pixelHeight } = manifest.vehicles.sedan;
  const tinted: CanvasImageSource[] = [];
  for (const colour of CAR_BODY_COLOURS) {
    const copy = tintSprite(factory, image, pixelWidth, pixelHeight, colour);
    if (copy) tinted.push(copy);
  }
  return { base: image, tinted };
}

/** Loads one ground texture, or `undefined` when its file is missing. */
async function loadSurface(
  loadImage: ImageLoader,
  entry: SpriteManifest["surfaces"]["road"],
): Promise<SurfaceTexture | undefined> {
  try {
    return {
      image: await loadImage(entry.file),
      tileMetres: entry.tileMetres,
      tilePixels: entry.tilePixels,
    };
  } catch (error: unknown) {
    reportSpriteFailure(error, "surface");
    return undefined;
  }
}

/** Loads the car sprite and its tints, or `undefined` when the file is missing. */
async function loadVehicle(
  loadImage: ImageLoader,
  factory: CanvasFactory,
  manifest: SpriteManifest,
): Promise<VehicleSprite | undefined> {
  try {
    const image = await loadImage(manifest.vehicles.sedan.file);
    return buildVehicleSprite(factory, image, manifest);
  } catch (error: unknown) {
    reportSpriteFailure(error, "vehicle");
    return undefined;
  }
}

/** Loads the player's character strip, or `undefined` when the file is missing. */
async function loadPerson(
  loadImage: ImageLoader,
  manifest: SpriteManifest,
): Promise<PersonSprite | undefined> {
  const { file, pixelSize, frames } = manifest.people.player;
  try {
    return { image: await loadImage(file), pixelSize, frames };
  } catch (error: unknown) {
    reportSpriteFailure(error, "person");
    return undefined;
  }
}

/** Loads the four ground textures; a texture that fails leaves its kind on the flat fill. */
async function loadGround(
  loadImage: ImageLoader,
  surfaces: SpriteManifest["surfaces"],
): Promise<GroundTextures> {
  const [grass, field, forest, urban] = await Promise.all([
    loadSurface(loadImage, surfaces.grass),
    loadSurface(loadImage, surfaces.field),
    loadSurface(loadImage, surfaces.forest),
    loadSurface(loadImage, surfaces.urban),
  ]);
  return { grass, field, forest, urban };
}

/** Loads every sprite the manifest lists; each one falls back on its own. */
async function loadAll(
  options: Required<SpriteStoreOptions>,
): Promise<ArenaSprites> {
  const manifest = await fetchManifest(options.fetchImpl, options.manifestPath);
  const [road, pavement, water, ground, car, player] = await Promise.all([
    loadSurface(options.loadImage, manifest.surfaces.road),
    loadSurface(options.loadImage, manifest.surfaces.pavement),
    loadSurface(options.loadImage, manifest.surfaces.water),
    loadGround(options.loadImage, manifest.surfaces),
    loadVehicle(options.loadImage, options.canvasFactory, manifest),
    loadPerson(options.loadImage, manifest),
  ]);
  return { road, pavement, water, ground, car, player };
}

/** True when at least one sprite decoded, i.e. the renderer has something new to paint with. */
function hasAnySprite(sprites: ArenaSprites): boolean {
  if (Object.values(sprites.ground ?? {}).some(Boolean)) return true;
  return Boolean(
    sprites.road ??
    sprites.pavement ??
    sprites.water ??
    sprites.car ??
    sprites.player,
  );
}

/**
 * Creates the store the arena session reads sprites from. `load()` never rejects: a missing
 * manifest or a failed image is reported to Sentry and leaves the painters on their flat fills,
 * because losing the art must not take the game down with it.
 */
export function createSpriteStore(
  options: SpriteStoreOptions & { canvasFactory: CanvasFactory },
): SpriteStore {
  const resolved: Required<SpriteStoreOptions> = {
    fetchImpl: options.fetchImpl ?? fetch,
    loadImage: options.loadImage ?? loadImageElement,
    canvasFactory: options.canvasFactory,
    manifestPath: options.manifestPath ?? SPRITE_MANIFEST_PATH,
  };
  let sprites: ArenaSprites = NO_SPRITES;
  let pending: Promise<boolean> | null = null;
  const runLoad = async (): Promise<boolean> => {
    try {
      sprites = await loadAll(resolved);
      return hasAnySprite(sprites);
    } catch (error: unknown) {
      reportSpriteFailure(error, "manifest");
      return false;
    }
  };
  return {
    current: () => sprites,
    load: () => (pending ??= runLoad()),
  };
}
