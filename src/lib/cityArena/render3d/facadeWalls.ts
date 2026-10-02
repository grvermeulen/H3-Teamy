/**
 * The wall finishes the façade modules are painted over, in design px: brick in half-bond courses
 * with a highlight along each course and a few darker and lighter bricks, weathered plaster,
 * modern panels with a wood-slat accent, concrete panels over the slab edge, and a glass curtain
 * wall. Each takes a sheet's colours, so one painter serves every colourway of its finish.
 */
import type { RasterContext } from "../render/canvasTypes";
import type { FacadeSheet } from "./facadeSheets";

/** A rectangle, design px (the same shape as `facadePaint.PixelBox`). */
type Box = { x: number; y: number; width: number; height: number };

/** A brick's length and course height including the mortar joint, px; both divide a module. */
const BRICK_LENGTH_PX = 16;
const BRICK_COURSE_PX = 6;
/** Mortar joint width, px. */
const MORTAR_PX = 1;
/** Shares of the bricks fired a shade darker, and a shade lighter. */
const DARK_BRICK_SHARE = 0.13;
const LIGHT_BRICK_SHARE = 0.08;
/** The light catching each course's top and the shade under it. */
const COURSE_LIGHT = "rgba(255,255,255,0.07)";
const COURSE_SHADE = "rgba(0,0,0,0.14)";
/** Weathering blotches on plaster: how many per module, their size and tints. */
const PLASTER_BLOTCHES = 7;
const BLOTCH_MAX_PX = 60;
const BLOTCH_LIGHT = "rgba(255,255,255,0.05)";
const BLOTCH_DARK = "rgba(0,0,0,0.06)";
/** Share of the blotches that are lighter than the plaster. */
const BLOTCH_LIGHT_SHARE = 0.5;
/** Panel joints: spacing across, the height of the horizontal joint, and joint width, px. */
const PANEL_JOINT_SPACING_PX = 64;
const PANEL_JOINT_Y_PX = 66;
const JOINT_PX = 2;
/** The wood-slat accent between a panel module's windows: where it stands and its slat pitch. */
const SLAT_BAND: Box = { x: 116, y: 0, width: 24, height: 132 };
const SLAT_PITCH_PX = 4;
const SLAT_SHADE = "rgba(0,0,0,0.28)";
/** Concrete: the floor slab's edge along the bottom of a storey, px, and the panel width. */
const SLAB_PX = 10;
const CONCRETE_PANEL_PX = 128;
/** Glass curtain wall: mullion spacing, spandrel height and mullion width, px. */
const MULLION_SPACING_PX = 32;
const SPANDREL_PX = 26;
const MULLION_PX = 3;
/** Height of the plinth along the bottom of a ground floor, px. */
const PLINTH_PX = 16;
/** Lighter variant of a brick colour, as a factor on its channels. */
const LIGHT_BRICK_FACTOR = 1.18;
/** Radix of a CSS hex colour and the largest channel value. */
const HEX_RADIX = 16;
const CHANNEL_MAX = 0xff;

/** Fills one rectangle. */
function fill(context: RasterContext, colour: string, box: Box): void {
  context.fillStyle = colour;
  context.fillRect(box.x, box.y, box.width, box.height);
}

/** A CSS hex colour with its channels scaled. */
function scaled(css: string, factor: number): string {
  const value = Number.parseInt(css.slice(1), HEX_RADIX);
  const channel = (shift: number): string =>
    Math.min(CHANNEL_MAX, Math.round(((value >> shift) & CHANNEL_MAX) * factor))
      .toString(HEX_RADIX)
      .padStart(2, "0");
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

/** Brick in half-bond courses over the mortar, with each course's light and shade. */
function paintBrick(
  context: RasterContext,
  sheet: FacadeSheet,
  box: Box,
  rng: () => number,
): void {
  const light = scaled(sheet.wall, LIGHT_BRICK_FACTOR);
  fill(context, sheet.joint, box);
  for (let row = 0; row * BRICK_COURSE_PX < box.height; row++) {
    const y = box.y + row * BRICK_COURSE_PX;
    const offset = (row % 2) * (BRICK_LENGTH_PX / 2);
    for (let x = box.x - offset; x < box.x + box.width; x += BRICK_LENGTH_PX) {
      const roll = rng();
      const colour =
        roll < DARK_BRICK_SHARE
          ? sheet.accent
          : roll < DARK_BRICK_SHARE + LIGHT_BRICK_SHARE
            ? light
            : sheet.wall;
      const width = BRICK_LENGTH_PX - MORTAR_PX;
      fill(context, colour, {
        x,
        y,
        width,
        height: BRICK_COURSE_PX - MORTAR_PX,
      });
    }
    fill(context, COURSE_LIGHT, { x: box.x, y, width: box.width, height: 1 });
    fill(context, COURSE_SHADE, {
      x: box.x,
      y: y + BRICK_COURSE_PX - MORTAR_PX - 1,
      width: box.width,
      height: 1,
    });
  }
}

/** Plaster with a few soft weathering blotches. */
function paintPlaster(
  context: RasterContext,
  sheet: FacadeSheet,
  box: Box,
  rng: () => number,
): void {
  fill(context, sheet.wall, box);
  for (let index = 0; index < PLASTER_BLOTCHES; index++) {
    const width = rng() * BLOTCH_MAX_PX + BLOTCH_MAX_PX / 2;
    const height = rng() * BLOTCH_MAX_PX + BLOTCH_MAX_PX / 4;
    fill(context, rng() < BLOTCH_LIGHT_SHARE ? BLOTCH_LIGHT : BLOTCH_DARK, {
      x: box.x + rng() * (box.width - width),
      y: box.y + rng() * (box.height - height),
      width,
      height,
    });
  }
}

/** Anthracite panels with their joints and a wood-slat band between the windows. */
function paintPanel(
  context: RasterContext,
  sheet: FacadeSheet,
  box: Box,
): void {
  fill(context, sheet.wall, box);
  for (let x = box.x; x < box.x + box.width; x += PANEL_JOINT_SPACING_PX) {
    fill(context, sheet.joint, { ...box, x, width: JOINT_PX });
  }
  fill(context, sheet.joint, {
    ...box,
    y: box.y + PANEL_JOINT_Y_PX,
    height: JOINT_PX,
  });
  const band = {
    ...SLAT_BAND,
    x: box.x + SLAT_BAND.x,
    y: box.y,
    height: box.height,
  };
  fill(context, sheet.accent, band);
  for (let x = band.x; x < band.x + band.width; x += SLAT_PITCH_PX) {
    fill(context, SLAT_SHADE, { ...band, x, width: 1 });
  }
}

/** Concrete panels over the floor slab's edge. */
function paintConcrete(
  context: RasterContext,
  sheet: FacadeSheet,
  box: Box,
): void {
  fill(context, sheet.wall, box);
  fill(context, sheet.accent, {
    ...box,
    y: box.y + box.height - SLAB_PX,
    height: SLAB_PX,
  });
  for (let x = box.x; x < box.x + box.width; x += CONCRETE_PANEL_PX) {
    fill(context, sheet.joint, { ...box, x, width: JOINT_PX });
  }
}

/** Dark glass between mullions over an opaque spandrel band at the floor. */
function paintGlass(
  context: RasterContext,
  sheet: FacadeSheet,
  box: Box,
): void {
  fill(context, sheet.wall, box);
  fill(context, sheet.accent, {
    ...box,
    y: box.y + box.height - SPANDREL_PX,
    height: SPANDREL_PX,
  });
  for (let x = box.x; x < box.x + box.width; x += MULLION_SPACING_PX) {
    fill(context, sheet.joint, { ...box, x, width: MULLION_PX });
  }
}

/**
 * Paints a sheet's wall finish over a box.
 *
 * @param context - The canvas.
 * @param sheet - The colourway.
 * @param box - The area, design px.
 * @param rng - Varies the bricks and the weathering.
 */
export function paintWall(
  context: RasterContext,
  sheet: FacadeSheet,
  box: Box,
  rng: () => number,
): void {
  if (sheet.finish === "brick") paintBrick(context, sheet, box, rng);
  else if (sheet.finish === "plaster") paintPlaster(context, sheet, box, rng);
  else if (sheet.finish === "panel") paintPanel(context, sheet, box);
  else if (sheet.finish === "concrete") paintConcrete(context, sheet, box);
  else paintGlass(context, sheet, box);
}

/**
 * The plinth along the bottom of a ground-floor module: the sheet's accent with a light edge.
 *
 * @param context - The canvas, moved to the module's corner.
 * @param sheet - The colourway.
 * @param module - The module's box.
 */
export function paintPlinth(
  context: RasterContext,
  sheet: FacadeSheet,
  module: Box,
): void {
  const plinth = {
    ...module,
    y: module.y + module.height - PLINTH_PX,
    height: PLINTH_PX,
  };
  fill(context, sheet.accent, plinth);
  fill(context, COURSE_LIGHT, { ...plinth, height: 2 });
}
