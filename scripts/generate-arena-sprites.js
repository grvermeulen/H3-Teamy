#!/usr/bin/env node
/**
 * Packs the generated arena sprite art in assets/arena/sprites/ into the runtime sizes the
 * renderer expects, and writes public/arena/sprites/manifest.json describing each asset in
 * metres so the canvas can size it without hard-coding pixel numbers.
 * Runs as part of `prebuild`; run manually with `node scripts/generate-arena-sprites.js`
 * after replacing artwork.
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

// Ground textures are authored per real-world size: one tile covers TEXTURE_TILE_METRES metres
// and ships at TEXTURE_TILE_PX pixels, i.e. 16 px/m — twice the highest camera zoom (8 px/m in
// ZOOM_LEVELS), which is also the density chunk rasters are painted at.
const TEXTURE_TILE_METRES = 8;
const TEXTURE_TILE_PX = 128;

// Car body size in metres, mirroring VEHICLE_LENGTH_M / VEHICLE_WIDTH_M in sim/vehicle.ts.
const VEHICLE_LENGTH_M = 4.2;
const VEHICLE_WIDTH_M = 1.8;
// Vehicles are drawn straight into the device-pixel-ratio-scaled main canvas and rotated by
// heading, so they get twice the ground texture's density as resampling headroom.
const VEHICLE_PX_PER_METRE = 32;

// The generator's cut-out leaves the whole car body around 55 % opaque and only its silhouette
// fully transparent, so the alpha channel is rebuilt: at or below ALPHA_BACKGROUND_MAX is
// background, at or above ALPHA_BODY_MIN is solid bodywork, and the narrow band between the two
// is rescaled so the outline keeps its anti-aliased edge.
const ALPHA_BACKGROUND_MAX = 16;
const ALPHA_BODY_MIN = 112;
const ALPHA_MAX = 255;

const root = path.join(__dirname, "..");
const sourceDir = path.join(root, "assets", "arena", "sprites");
const outputDir = path.join(root, "public", "arena", "sprites");
/** Where the generated files are served from, used verbatim by the renderer's sprite loader. */
const PUBLIC_BASE_PATH = "/arena/sprites";

const surfaceSources = {
  road: "road-tarmac.png",
  pavement: "pavement-slabs.png",
};
const vehicleSources = {
  sedan: "car-sedan.png",
};

/**
 * Exits the process if any sprite source file is missing from assets/arena/sprites/.
 */
function assertSourcesExist() {
  const files = [
    ...Object.values(surfaceSources),
    ...Object.values(vehicleSources),
  ];
  for (const file of files) {
    const full = path.join(sourceDir, file);
    if (!fs.existsSync(full)) {
      console.error(`Missing arena sprite source ${full}`);
      process.exit(1);
    }
  }
}

/**
 * Creates the output directory the packed sprites and the manifest are written to.
 */
function ensureOutputDirectory() {
  fs.mkdirSync(outputDir, { recursive: true });
}

/**
 * Downscales one seamless ground texture to the runtime tile size. The source is resized with
 * `fit: "fill"` so the repeat stays exactly TEXTURE_TILE_METRES wide and the edges keep lining
 * up; cropping or padding here would break the seam.
 */
async function packSurfaceTexture(file) {
  await sharp(path.join(sourceDir, file))
    .resize(TEXTURE_TILE_PX, TEXTURE_TILE_PX, { fit: "fill" })
    .png()
    .toFile(path.join(outputDir, file));
  return {
    file: `${PUBLIC_BASE_PATH}/${file}`,
    tileMetres: TEXTURE_TILE_METRES,
    tilePixels: TEXTURE_TILE_PX,
  };
}

/**
 * Rewrites `data`'s alpha channel in place so the bodywork is opaque and only the silhouette
 * keeps a soft edge. Without this the road shows straight through every car.
 */
function hardenAlpha(data, channels) {
  const span = ALPHA_BODY_MIN - ALPHA_BACKGROUND_MAX;
  for (let index = channels - 1; index < data.length; index += channels) {
    const alpha = data[index];
    if (alpha <= ALPHA_BACKGROUND_MAX) data[index] = 0;
    else if (alpha >= ALPHA_BODY_MIN) data[index] = ALPHA_MAX;
    else
      data[index] = Math.round(
        ((alpha - ALPHA_BACKGROUND_MAX) / span) * ALPHA_MAX,
      );
  }
}

/**
 * Smallest rectangle containing every pixel that is not background. Sharp's own `trim` keys off
 * the corner colour, which leaves the generated art's alpha halo in place, so the bounds are
 * measured from the alpha channel instead.
 */
function alphaBounds(data, info) {
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * info.channels + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error("Vehicle sprite is fully transparent");
  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

/**
 * Trims one vehicle sprite to its artwork and resizes it to the car's own metre box. The resize
 * uses `fit: "fill"`, so the sprite is stretched onto the exact hull the simulation collides with
 * rather than being letterboxed inside it — a car that draws wider than it drives reads as a bug.
 */
async function packVehicleSprite(file) {
  const pixelWidth = Math.round(VEHICLE_WIDTH_M * VEHICLE_PX_PER_METRE);
  const pixelHeight = Math.round(VEHICLE_LENGTH_M * VEHICLE_PX_PER_METRE);
  const { data, info } = await sharp(path.join(sourceDir, file))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  hardenAlpha(data, info.channels);
  await sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
    .extract(alphaBounds(data, info))
    .resize(pixelWidth, pixelHeight, { fit: "fill" })
    .png()
    .toFile(path.join(outputDir, file));
  return {
    file: `${PUBLIC_BASE_PATH}/${file}`,
    lengthMetres: VEHICLE_LENGTH_M,
    widthMetres: VEHICLE_WIDTH_M,
    pixelWidth,
    pixelHeight,
  };
}

/**
 * Packs every source asset and writes the manifest the renderer loads at runtime.
 */
async function packSprites() {
  const surfaces = {};
  for (const [name, file] of Object.entries(surfaceSources))
    surfaces[name] = await packSurfaceTexture(file);
  const vehicles = {};
  for (const [name, file] of Object.entries(vehicleSources))
    vehicles[name] = await packVehicleSprite(file);
  const manifest = { version: 1, surfaces, vehicles };
  fs.writeFileSync(
    path.join(outputDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

/**
 * Logs which sprites were written and at what size.
 */
function reportDone(manifest) {
  for (const [name, surface] of Object.entries(manifest.surfaces))
    console.log(
      `${name}: ${surface.file} ${surface.tilePixels}px per ${surface.tileMetres} m`,
    );
  for (const [name, vehicle] of Object.entries(manifest.vehicles))
    console.log(
      `${name}: ${vehicle.file} ${vehicle.pixelWidth}×${vehicle.pixelHeight}px for ${vehicle.widthMetres}×${vehicle.lengthMetres} m`,
    );
  console.log(`Arena sprites written to ${outputDir}`);
}

async function main() {
  assertSourcesExist();
  ensureOutputDirectory();
  reportDone(await packSprites());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
