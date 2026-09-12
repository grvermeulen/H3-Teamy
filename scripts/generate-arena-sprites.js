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

// Vehicles are drawn straight into the device-pixel-ratio-scaled main canvas and rotated by
// heading, so they get twice the ground texture's density as resampling headroom.
const VEHICLE_PX_PER_METRE = 32;

// Person size in metres, mirroring PLAYER_RADIUS_M in sim/player.ts. The art is stretched over
// the collision circle's box, so what you see is what you bump into.
const PERSON_RADIUS_M = 0.4;
// A person is only 0.8 m across and the camera never passes 12 px/m, so 64 px/m is ample
// headroom for rotation and still a few kB.
const PERSON_PX_PER_METRE = 64;

// Scenery is painted into the chunk rasters like the ground, so a tree canopy ships at the
// textures' density; a piece of street furniture is a metre or three across and gets the
// vehicles' density so it survives being turned to its street.
const TREE_PX_PER_METRE = 16;
const FURNITURE_PX_PER_METRE = 32;

// Items are drawn at real size in a hand and blown up to a metre-long icon on the ground, so
// every item ships this many pixels long, its own aspect kept: the art decides the width.
const ITEM_PX_LONG = 128;

// Landmark art is painted into the chunk rasters over its building, laid along the footprint's
// longest edge (render/drawLandmarks.ts), so it ships at the textures' density. Like an item it
// keeps its own aspect: the painter stretches the long side over the building and the art
// decides how far the eaves and the terrace reach past the walls.
const LANDMARK_PX_PER_METRE = 16;

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

// Every seamless texture, keyed the way the renderer asks for it: the two road surfaces, water,
// and one per GroundKind in world/mapTypes.ts. Adding a key here is the only step needed to give
// a surface art — the manifest, the loader and the painters all read these names.
const surfaceSources = {
  road: "road-tarmac.png",
  pavement: "pavement-slabs.png",
  water: "water-river.png",
  grass: "ground-grass.png",
  field: "ground-field.png",
  forest: "ground-forest.png",
  urban: "ground-urban.png",
  // Roofs: the painter lays a building's roof along its longest edge (render/drawRoofs.ts).
  // gpt-image-2 renders them in daylight, so they are dimmed here to sit with the night-dark
  // ground (palette.ts: the roof shades run from luminance 52 to 85).
  roofTiles: { file: "roof-tiles.png", brightness: 0.55 },
  roofFlat: { file: "roof-flat.png", brightness: 0.6 },
};

/** A surface source's file name, whether it is a bare name or a name with a brightness. */
function surfaceFile(source) {
  return typeof source === "string" ? source : source.file;
}
// Vehicles by kind, mirroring VEHICLE_SPECS in sim/vehicle.ts: each source is a nose-up cut-out
// packed onto its own metre box at VEHICLE_PX_PER_METRE. `tint: true` ships greyscale art the
// renderer recolours from the palette; `tint: false` keeps the art's own colours — the police
// striping, the bus livery, the tractor's green. A kind without art (compact, sport) draws the
// sedan's.
const vehicleSources = {
  sedan: { file: "car-sedan.png", lengthM: 4.2, widthM: 1.8, tint: true },
  police: {
    file: "vehicle-police.png",
    lengthM: 4.2,
    widthM: 1.8,
    tint: false,
  },
  van: { file: "vehicle-van.png", lengthM: 5, widthM: 2, tint: true },
  pickup: { file: "vehicle-pickup.png", lengthM: 5.2, widthM: 1.9, tint: true },
  bus: { file: "vehicle-bus.png", lengthM: 12, widthM: 2.5, tint: false },
  oldtimer: {
    file: "vehicle-oldtimer.png",
    lengthM: 4.4,
    widthM: 1.7,
    tint: true,
  },
  tractor: {
    file: "vehicle-tractor.png",
    lengthM: 4,
    widthM: 2.2,
    tint: false,
  },
  // Drawn in code by scripts/arena/draw-tank-sprite.js, so it needs no generator run.
  tank: { file: "vehicle-tank.png", lengthM: 7, widthM: 3.4, tint: false },
};
// Character art: a horizontal strip of square frames, drawn facing down its own image so the
// canvas can rotate it by the person's facing. One frame means a still character; a still
// source is turned into an eight-frame walk here. `ped1`…`ped6` are the pedestrians' looks
// (sim/peds.ts pedLook), `cop` the officers'.
const personSources = {
  player: { file: "person-player.png", frames: 8 },
  ped1: { file: "person-ped1.png", frames: 8 },
  ped2: { file: "person-ped2.png", frames: 8 },
  ped3: { file: "person-ped3.png", frames: 8 },
  ped4: { file: "person-ped4.png", frames: 8 },
  ped5: { file: "person-ped5.png", frames: 8 },
  ped6: { file: "person-ped6.png", frames: 8 },
  cop: { file: "person-cop.png", frames: 8 },
};

// Scenery props, mirroring TREE_CANOPY_M and FURNITURE_SIZE_M in world/mapTypes.ts (Plan 9b).
// A tree is a canopy seen from above, packed square onto its diameter; furniture is packed onto
// its footprint with the long side along the image's x axis, which the painter turns to the
// piece's heading. The keys are what the manifest's `props` record and the painter use.
const propSources = {
  treeSmall: {
    file: "tree-small.png",
    lengthM: 6,
    widthM: 6,
    pxPerMetre: TREE_PX_PER_METRE,
  },
  treeLarge: {
    file: "tree-large.png",
    lengthM: 10,
    widthM: 10,
    pxPerMetre: TREE_PX_PER_METRE,
  },
  lamp: {
    file: "furniture-lamp.png",
    lengthM: 1,
    widthM: 0.6,
    pxPerMetre: FURNITURE_PX_PER_METRE,
  },
  bench: {
    file: "furniture-bench.png",
    lengthM: 1.8,
    widthM: 0.6,
    pxPerMetre: FURNITURE_PX_PER_METRE,
  },
  busStop: {
    file: "furniture-busstop.png",
    lengthM: 3,
    widthM: 1.5,
    pxPerMetre: FURNITURE_PX_PER_METRE,
  },
};
// Items, keyed as the pickups and the weapons name them (sim/types.ts PickupKind, WeaponKind):
// a side profile pointing right, muzzle or barrel end first, so a person's facing turns it. Real
// lengths; the manifest's width follows from the art.
const itemSources = {
  pistol: { file: "item-pistol.png", lengthM: 0.2 },
  uzi: { file: "item-uzi.png", lengthM: 0.5 },
  shotgun: { file: "item-shotgun.png", lengthM: 1 },
  rifle: { file: "item-rifle.png", lengthM: 1.1 },
  bat: { file: "item-bat.png", lengthM: 0.85 },
  health: { file: "item-health.png", lengthM: 0.4 },
};
// Landmark art by landmark style (world/mapTypes.ts LandmarkStyle): a building seen from
// directly above, its long side along the image's x axis, on a transparent background. The
// length is nominal — the painter fits it to each building — and sets the packed pixel size.
const landmarkSources = {
  brewery: { file: "landmark-brewery.png", lengthM: 16 },
};

/**
 * Exits the process if any sprite source file is missing from assets/arena/sprites/.
 */
function assertSourcesExist() {
  const files = [
    ...Object.values(surfaceSources).map(surfaceFile),
    ...Object.values(vehicleSources).map((vehicle) => vehicle.file),
    ...Object.values(personSources).map((person) => person.file),
    ...Object.values(propSources).map((prop) => prop.file),
    ...Object.values(itemSources).map((item) => item.file),
    ...Object.values(landmarkSources).map((landmark) => landmark.file),
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
 * Downscales one seamless ground texture to the runtime tile size, dimmed by the source's
 * brightness when it has one. The source is resized with `fit: "fill"` so the repeat stays
 * exactly TEXTURE_TILE_METRES wide and the edges keep lining up; cropping or padding here would
 * break the seam.
 */
async function packSurfaceTexture(source) {
  const file = surfaceFile(source);
  const brightness = typeof source === "string" ? 1 : source.brightness;
  await sharp(path.join(sourceDir, file))
    .modulate({ brightness })
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
function alphaBounds(data, info, fromX = 0, toX = info.width) {
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = fromX; x < toX; x++) {
      if (data[(y * info.width + x) * info.channels + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error("Sprite is fully transparent");
  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

/**
 * Hardens one cut-out's alpha, trims it to its artwork and writes it at the given pixel size.
 * The resize uses `fit: "fill"`, so the sprite is stretched onto the exact hull the simulation
 * collides with rather than being letterboxed inside it — art that draws wider than it moves
 * reads as a bug.
 */
async function packCutout(file, pixelWidth, pixelHeight) {
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
}

/** Trims one vehicle sprite to its artwork and resizes it to its kind's own metre box. */
async function packVehicleSprite(source) {
  const pixelWidth = Math.round(source.widthM * VEHICLE_PX_PER_METRE);
  const pixelHeight = Math.round(source.lengthM * VEHICLE_PX_PER_METRE);
  await packCutout(source.file, pixelWidth, pixelHeight);
  return {
    file: `${PUBLIC_BASE_PATH}/${source.file}`,
    lengthMetres: source.lengthM,
    widthMetres: source.widthM,
    pixelWidth,
    pixelHeight,
    tint: source.tint,
  };
}

/** Trims one prop to its artwork and resizes it onto its metre footprint. */
async function packPropSprite(source) {
  const pixelWidth = Math.round(source.lengthM * source.pxPerMetre);
  const pixelHeight = Math.round(source.widthM * source.pxPerMetre);
  await packCutout(source.file, pixelWidth, pixelHeight);
  return {
    file: `${PUBLIC_BASE_PATH}/${source.file}`,
    lengthMetres: source.lengthM,
    widthMetres: source.widthM,
    pixelWidth,
    pixelHeight,
  };
}

/**
 * Packs one cut-out along `pixelLong` pixels with its own aspect kept — hardened and trimmed to
 * its artwork, so nothing is stretched and the manifest's width comes from the art. Items and
 * landmark art both pack this way.
 */
async function packAlongLength(source, pixelLong) {
  const { data, info } = await sharp(path.join(sourceDir, source.file))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  hardenAlpha(data, info.channels);
  const bounds = alphaBounds(data, info);
  const pixelWidth = pixelLong;
  const pixelHeight = Math.max(
    1,
    Math.round((pixelLong * bounds.height) / bounds.width),
  );
  await sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
    .extract(bounds)
    .resize(pixelWidth, pixelHeight, { fit: "fill" })
    .png()
    .toFile(path.join(outputDir, source.file));
  return {
    file: `${PUBLIC_BASE_PATH}/${source.file}`,
    lengthMetres: source.lengthM,
    widthMetres:
      Math.round(((source.lengthM * pixelHeight) / pixelWidth) * 100) / 100,
    pixelWidth,
    pixelHeight,
  };
}

/** Packs one item along ITEM_PX_LONG pixels. */
function packItemSprite(source) {
  return packAlongLength(source, ITEM_PX_LONG);
}

/** Packs one landmark's art at LANDMARK_PX_PER_METRE over its nominal length. */
function packLandmarkSprite(source) {
  return packAlongLength(
    source,
    Math.round(source.lengthM * LANDMARK_PX_PER_METRE),
  );
}

/**
 * The box every frame of a strip is cut with: the union of what each frame occupies, measured
 * in frame-local coordinates. Trimming each frame to its own artwork instead would re-centre
 * every one of them and iron the walk's bob and sway flat.
 */
function stripBounds(data, info, frames) {
  const frameWidth = Math.round(info.width / frames);
  let left = frameWidth;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  for (let frame = 0; frame < frames; frame++) {
    const from = frame * frameWidth;
    const bounds = alphaBounds(data, info, from, from + frameWidth);
    left = Math.min(left, bounds.left - from);
    top = Math.min(top, bounds.top);
    right = Math.max(right, bounds.left - from + bounds.width);
    bottom = Math.max(bottom, bounds.top + bounds.height);
  }
  return { left, top, width: right - left, height: bottom - top, frameWidth };
}

/**
 * How far the body rolls at the extremes of the synthesised walk, in degrees, and how far it
 * bobs, in cell pixels. Both are deliberately small: at the size a person is actually drawn the
 * cycle has to read as a gait, not as a pratfall.
 */
const WALK_ROLL_DEG = 5;
const WALK_BOB_PX = 2;

/**
 * Builds one frame of a walk cycle from a still figure. The body rolls once per cycle and bobs
 * twice — one rise per step — which is what a two-beat gait does. Rotating first and fitting
 * afterwards keeps the whole figure inside its cell at every angle.
 */
async function walkCycleFrame(figure, frame, frames, pixelSize) {
  const phase = (frame / frames) * 2 * Math.PI;
  const roll = Math.sin(phase) * WALK_ROLL_DEG;
  const lift = Math.round(Math.abs(Math.sin(phase)) * WALK_BOB_PX);
  const body = await sharp(figure)
    .rotate(roll, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize(pixelSize, pixelSize - WALK_BOB_PX, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  return sharp({
    create: {
      width: pixelSize,
      height: pixelSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: body, left: 0, top: WALK_BOB_PX - lift }])
    .png()
    .toBuffer();
}

/**
 * Packs one character strip, each cell on the square box around the person's collision circle so
 * the renderer can draw a cell straight from the radius it already knows.
 *
 * A source that is already `frames` cells wide is cut up as it is, with every frame sharing one
 * union box so the artist's own bob survives. A single still is turned into a walk cycle here
 * instead: two attempts at generating one produced frames that re-framed and cropped his legs,
 * which reads as a wobble at 19 px, while a synthesised roll and bob reads as walking and costs
 * nothing to regenerate.
 */
async function packPersonSprite(file, frames) {
  const pixelSize = Math.round(2 * PERSON_RADIUS_M * PERSON_PX_PER_METRE);
  const { data, info } = await sharp(path.join(sourceDir, file))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  hardenAlpha(data, info.channels);
  const raw = {
    width: info.width,
    height: info.height,
    channels: info.channels,
  };
  const isStrip = frames > 1 && info.width >= info.height * frames;
  const box = stripBounds(data, info, isStrip ? frames : 1);
  const cells = [];
  for (let frame = 0; frame < frames; frame++) {
    const cut = await sharp(data, { raw })
      .extract({
        left: (isStrip ? frame * box.frameWidth : 0) + box.left,
        top: box.top,
        width: box.width,
        height: box.height,
      })
      .png()
      .toBuffer();
    cells.push({
      input: isStrip
        ? await sharp(cut)
            .resize(pixelSize, pixelSize, { fit: "fill" })
            .png()
            .toBuffer()
        : await walkCycleFrame(cut, frame, frames, pixelSize),
      left: frame * pixelSize,
      top: 0,
    });
  }
  await sharp({
    create: {
      width: pixelSize * frames,
      height: pixelSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(cells)
    .png()
    .toFile(path.join(outputDir, file));
  return {
    file: `${PUBLIC_BASE_PATH}/${file}`,
    radiusMetres: PERSON_RADIUS_M,
    pixelSize,
    frames,
  };
}

/**
 * Packs every source asset and writes the manifest the renderer loads at runtime.
 */
async function packSprites() {
  const surfaces = {};
  for (const [name, source] of Object.entries(surfaceSources))
    surfaces[name] = await packSurfaceTexture(source);
  const vehicles = {};
  for (const [name, source] of Object.entries(vehicleSources))
    vehicles[name] = await packVehicleSprite(source);
  const people = {};
  for (const [name, person] of Object.entries(personSources))
    people[name] = await packPersonSprite(person.file, person.frames);
  const props = {};
  for (const [name, source] of Object.entries(propSources))
    props[name] = await packPropSprite(source);
  const items = {};
  for (const [name, source] of Object.entries(itemSources))
    items[name] = await packItemSprite(source);
  const landmarks = {};
  for (const [name, source] of Object.entries(landmarkSources))
    landmarks[name] = await packLandmarkSprite(source);
  const manifest = {
    version: 1,
    surfaces,
    vehicles,
    people,
    props,
    items,
    landmarks,
  };
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
      `${name}: ${vehicle.file} ${vehicle.pixelWidth}×${vehicle.pixelHeight}px for ${vehicle.widthMetres}×${vehicle.lengthMetres} m${vehicle.tint ? ", tinted" : ""}`,
    );
  for (const [name, person] of Object.entries(manifest.people))
    console.log(
      `${name}: ${person.file} ${person.frames} × ${person.pixelSize}px for a ${person.radiusMetres} m radius`,
    );
  for (const [name, prop] of Object.entries(manifest.props))
    console.log(
      `${name}: ${prop.file} ${prop.pixelWidth}×${prop.pixelHeight}px for ${prop.lengthMetres}×${prop.widthMetres} m`,
    );
  for (const [name, item] of Object.entries(manifest.items))
    console.log(
      `${name}: ${item.file} ${item.pixelWidth}×${item.pixelHeight}px for ${item.lengthMetres}×${item.widthMetres} m`,
    );
  for (const [name, landmark] of Object.entries(manifest.landmarks))
    console.log(
      `${name}: ${landmark.file} ${landmark.pixelWidth}×${landmark.pixelHeight}px for ${landmark.lengthMetres}×${landmark.widthMetres} m`,
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
