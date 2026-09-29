/**
 * The Kenney Car Kit's colour atlas: 16 columns × 4 rows of swatches (each a flat colour or a
 * top-to-bottom gradient) that every model's UVs point into. The car pack bakes each vertex's
 * atlas colour into the vertex, so the packed cars need no texture and the body paint can be
 * tinted per car.
 */

/** A decoded RGBA image. */
export type Atlas = { width: number; height: number; data: Uint8Array };

/** A swatch by column and row: `"13:1"`. */
export type SwatchKey = `${number}:${number}`;

/** Swatch columns and rows across the atlas. */
export const ATLAS_COLUMNS = 16;
export const ATLAS_ROWS = 4;
/** Channels per pixel. */
const RGBA = 4;
/** A full 8-bit channel. */
const CHANNEL_MAX = 255;
/** Samples stay this many texels inside their swatch, so a vertex on its edge never reads the next. */
const SWATCH_MARGIN_TEXELS = 1;

/** The swatches the pack treats specially, as the probe found them in Car Kit 3.1. */
export const SWATCH = {
  /** Window glass: a pale blue gradient. */
  glass: "1:3",
  /** Headlamp lenses: yellow. */
  headLamp: "3:3",
  /** Tail lamp lenses, and the police light bar's red lens: red. */
  redLamp: "5:3",
  /** The police light bar's blue lens. */
  blueLamp: "7:3",
  /** Number plates, trim and the police car's white paint: light grey. */
  light: "13:2",
  /** Bumpers, sills, the lower body and the tractor: blue-grey. */
  blueGrey: "7:2",
  /** Tyres, grilles and arches: near black. */
  dark: "5:2",
  /** Wheel rims: pale grey-blue. */
  rim: "11:2",
  /** Body paints: red-orange, green, blue, amber. */
  redPaint: "13:1",
  greenPaint: "7:1",
  bluePaint: "15:1",
  amberPaint: "9:1",
} as const satisfies Record<string, SwatchKey>;

/**
 * The swatch a UV falls in.
 *
 * @param u - Across the atlas, 0…1.
 * @param v - Down the atlas (glTF's UV origin is the top left), 0…1.
 * @returns Its key.
 */
export function swatchAt(u: number, v: number): SwatchKey {
  const column = Math.min(
    ATLAS_COLUMNS - 1,
    Math.max(0, Math.floor(u * ATLAS_COLUMNS)),
  );
  const row = Math.min(ATLAS_ROWS - 1, Math.max(0, Math.floor(v * ATLAS_ROWS)));
  return `${column}:${row}`;
}

/** A swatch key's column and row. */
function cellOf(swatch: SwatchKey): [number, number] {
  const [column, row] = swatch.split(":").map(Number);
  return [column, row];
}

/** One texel's sRGB colour as `0xrrggbb`. */
function texel(atlas: Atlas, x: number, y: number): number {
  const offset = (y * atlas.width + x) * RGBA;
  return (
    (atlas.data[offset] << 16) |
    (atlas.data[offset + 1] << 8) |
    atlas.data[offset + 2]
  );
}

/**
 * The atlas colour at a UV, read inside the given swatch: a vertex on the swatch's edge reads
 * its own swatch, not its neighbour's.
 *
 * @param atlas - The decoded atlas.
 * @param swatch - The swatch the vertex's triangle lies in.
 * @param u - Across, 0…1.
 * @param v - Down, 0…1.
 * @returns The sRGB colour, `0xrrggbb`.
 */
export function sampleSwatch(
  atlas: Atlas,
  swatch: SwatchKey,
  u: number,
  v: number,
): number {
  const [column, row] = cellOf(swatch);
  const cellWidth = atlas.width / ATLAS_COLUMNS;
  const cellHeight = atlas.height / ATLAS_ROWS;
  const clamp = (value: number, start: number, size: number): number =>
    Math.min(
      start + size - 1 - SWATCH_MARGIN_TEXELS,
      Math.max(start + SWATCH_MARGIN_TEXELS, Math.floor(value)),
    );
  const x = clamp(u * atlas.width, column * cellWidth, cellWidth);
  const y = clamp(v * atlas.height, row * cellHeight, cellHeight);
  return texel(atlas, x, y);
}

/**
 * The UV of a swatch's middle.
 *
 * @param swatch - The swatch.
 * @returns `[u, v]`, v counted down from the top.
 */
export function swatchCentre(swatch: SwatchKey): [number, number] {
  const [column, row] = cellOf(swatch);
  return [(column + 0.5) / ATLAS_COLUMNS, (row + 0.5) / ATLAS_ROWS];
}

/**
 * A swatch's colour half way down: the reference its gradient's shading is measured against.
 *
 * @param atlas - The decoded atlas.
 * @param swatch - The swatch.
 * @returns The sRGB colour, `0xrrggbb`.
 */
export function swatchMiddle(atlas: Atlas, swatch: SwatchKey): number {
  const [u, v] = swatchCentre(swatch);
  return sampleSwatch(atlas, swatch, u, v);
}

/** sRGB transfer below this encoded value is a straight line. */
const SRGB_ENCODED_KNEE = 0.04045;
/** Slope of that line. */
const SRGB_LINEAR_SLOPE = 12.92;
/** The curve's exponent, scale and offset. */
const SRGB_GAMMA = 2.4;
const SRGB_SCALE = 1.055;
const SRGB_OFFSET = 0.055;

/** One 8-bit sRGB channel as a linear value. */
function linearChannel(encoded: number): number {
  const value = encoded / CHANNEL_MAX;
  return value <= SRGB_ENCODED_KNEE
    ? value / SRGB_LINEAR_SLOPE
    : ((value + SRGB_OFFSET) / SRGB_SCALE) ** SRGB_GAMMA;
}

/**
 * An sRGB colour as linear RGB, the space glTF vertex colours are in.
 *
 * @param hex - `0xrrggbb`.
 * @returns `[r, g, b]` in 0…1.
 */
export function linearOf(hex: number): [number, number, number] {
  return [
    linearChannel((hex >> 16) & CHANNEL_MAX),
    linearChannel((hex >> 8) & CHANNEL_MAX),
    linearChannel(hex & CHANNEL_MAX),
  ];
}

/** Rec. 709 luminance weights. */
const LUMA = [0.2126, 0.7152, 0.0722] as const;

/**
 * The relative luminance of a linear colour.
 *
 * @param linear - `[r, g, b]` in 0…1.
 * @returns Its luminance, 0…1.
 */
export function luminanceOf(linear: readonly number[]): number {
  return LUMA[0] * linear[0] + LUMA[1] * linear[1] + LUMA[2] * linear[2];
}
