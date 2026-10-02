/**
 * Painters for one façade module — 6 m of wall, one storey high — in design px (256 × 132, about
 * 43 per metre); the atlas scales them to its own resolution. A module is painted twice: once for
 * the colour map (wall, windows, doors, shopfronts, with the light and shade of their depth baked
 * in) and once for the glow map (black but for what is lit at night).
 */
import type { RasterContext } from "../render/canvasTypes";
import { createRng, seedFromString } from "../sim/rng";
import type { FacadeSheet } from "./facadeSheets";
import { WINDOW_COLD, WINDOW_DARK, WINDOW_WARM } from "./palette3d";
import { paintWall } from "./facadeWalls";

/** Module width in design px: 6 m of wall. */
export const MODULE_WIDTH_PX = 256;
/** Module height in design px: one 3.1 m storey. */
export const MODULE_HEIGHT_PX = 132;
/** Windows side by side in one module. */
export const WINDOWS_PER_MODULE = 2;

/** A rectangle on a module, design px. */
export type PixelBox = { x: number; y: number; width: number; height: number };

/** A lit window: its colour and the tint of its half-drawn curtains, if any; `null` when dark. */
export type WindowLight = { colour: number; curtain: string | null } | null;

/** Window size and height in a module, px from the top of the storey. */
type WindowShape = { width: number; height: number; top: number };

/** One module as a box. */
export const MODULE_BOX: PixelBox = {
  x: 0,
  y: 0,
  width: MODULE_WIDTH_PX,
  height: MODULE_HEIGHT_PX,
};

/** Width of a window frame and of its mullion and transom, px. */
const FRAME_PX = 3;
/** Height of the transom bar, as a share of the window height from the top. */
const TRANSOM_SHARE = 0.3;
/** Height of a window sill and how far it sticks out past the frame on each side, px. */
const SILL_PX = 5;
const SILL_OVERHANG_PX = 5;
/** The shadow the reveal casts inside the top and left of the frame, px. */
const REVEAL_TOP_PX = 6;
const REVEAL_SIDE_PX = 3;
/** The reveal's shadow and a sill's underside shade, as translucent black. */
const REVEAL_SHADE = "rgba(0,0,0,0.38)";
const UNDERSIDE_SHADE = "rgba(0,0,0,0.3)";
/** A brick lintel over a window: its height and overhang each side, px. */
const LINTEL_PX = 8;
const LINTEL_OVERHANG_PX = 5;
/** Width of a shutter panel beside a window, px, and the share of house modules that have them. */
const SHUTTER_PX = 16;
const SHUTTER_SHARE = 0.18;
/** Shutter paint: Dutch green and a deep oxblood. */
const SHUTTER_COLOURS: readonly string[] = ["#27432f", "#5a1f1c"];
/** Width of each half-drawn curtain, as a share of the pane, and its tints. */
const CURTAIN_SHARE = 0.22;
const CURTAIN_COLOURS: readonly string[] = [
  "#b7704a",
  "#8c5a7a",
  "#c9b27a",
  "#6d7f9a",
];
/** How much light a drawn curtain lets through, as a share of the window's. */
const CURTAIN_GLOW = 0.35;
/** Share of the lit windows lit by a warm bulb rather than a screen or a cold tube. */
const WARM_WINDOW_SHARE = 0.7;
/** Share of the lit windows with curtains half drawn. */
const CURTAIN_WINDOW_SHARE = 0.45;
/** What the glow map shows where nothing is lit. */
export const NO_GLOW = "#000000";
/** Radix and digits of a CSS hex colour. */
const HEX_RADIX = 16;
const CSS_HEX_DIGITS = 6;
/** Largest value of an 8-bit colour channel. */
const CHANNEL_MAX = 0xff;

/** Each finish's windows (the finish's own modules use them; glass fills the module). */
const WINDOW_SHAPES: Record<FacadeSheet["finish"], WindowShape> = {
  brick: { width: 52, height: 66, top: 28 },
  plaster: { width: 52, height: 66, top: 28 },
  panel: { width: 88, height: 62, top: 30 },
  concrete: { width: 60, height: 60, top: 32 },
  glass: { width: 104, height: 92, top: 14 },
};

/**
 * A hex colour number as a CSS colour string.
 *
 * @param colour - `0xrrggbb`.
 * @returns `#rrggbb`.
 */
export function cssHex(colour: number): string {
  return `#${colour.toString(HEX_RADIX).padStart(CSS_HEX_DIGITS, "0")}`;
}

/**
 * Scales a colour's channels, as a CSS colour string.
 *
 * @param colour - `0xrrggbb`.
 * @param factor - Below 1 darkens.
 * @returns `#rrggbb`.
 */
export function dimmed(colour: number, factor: number): string {
  const channel = (shift: number): number =>
    Math.min(
      CHANNEL_MAX,
      Math.round(((colour >> shift) & CHANNEL_MAX) * factor),
    );
  return cssHex((channel(16) << 16) | (channel(8) << 8) | channel(0));
}

/**
 * Fills one rectangle in a colour.
 *
 * @param context - The canvas.
 * @param colour - Any CSS colour.
 * @param box - The rectangle, design px.
 */
export function fillBox(
  context: RasterContext,
  colour: string,
  box: PixelBox,
): void {
  context.fillStyle = colour;
  context.fillRect(box.x, box.y, box.width, box.height);
}

/**
 * The panes of a module's windows in a finish, each centred in its half of the module.
 *
 * @param finish - The finish.
 * @param top - Overrides the finish's window top, px (ground floors sit a little higher).
 * @returns Two panes, left first.
 */
export function windowPanes(
  finish: FacadeSheet["finish"],
  top?: number,
): PixelBox[] {
  const shape = WINDOW_SHAPES[finish];
  const bay = MODULE_WIDTH_PX / WINDOWS_PER_MODULE;
  return Array.from({ length: WINDOWS_PER_MODULE }, (_, index) => ({
    x: Math.round(bay * (index + 0.5) - shape.width / 2),
    y: top ?? shape.top,
    width: shape.width,
    height: shape.height,
  }));
}

/**
 * Seeded lights for `count` windows: each lit with probability `litShare`, mostly by a warm bulb,
 * some with curtains half drawn. Pure in its arguments, so the colour and glow maps agree.
 *
 * @param seed - Seeds the choice; one module's windows share a seed.
 * @param count - Windows.
 * @param litShare - Chance in [0, 1] that a window is lit.
 * @returns One light per window.
 */
export function seededLights(
  seed: string,
  count: number,
  litShare: number,
): WindowLight[] {
  const rng = createRng(seedFromString(seed));
  return Array.from({ length: count }, () => {
    if (rng() >= litShare) return null;
    const colour = rng() < WARM_WINDOW_SHARE ? WINDOW_WARM : WINDOW_COLD;
    const curtain =
      rng() < CURTAIN_WINDOW_SHARE
        ? CURTAIN_COLOURS[Math.floor(rng() * CURTAIN_COLOURS.length)]
        : null;
    return { colour, curtain };
  });
}

/** A window's mullion (vertical, centred) and transom (horizontal, high) bars. */
function windowBars(pane: PixelBox): PixelBox[] {
  return [
    {
      x: pane.x + Math.round((pane.width - FRAME_PX) / 2),
      y: pane.y,
      width: FRAME_PX,
      height: pane.height,
    },
    {
      x: pane.x,
      y: pane.y + Math.round(pane.height * TRANSOM_SHARE),
      width: pane.width,
      height: FRAME_PX,
    },
  ];
}

/** The two curtain strips of a pane. */
function curtainBoxes(pane: PixelBox): PixelBox[] {
  const width = Math.round(pane.width * CURTAIN_SHARE);
  return [
    { ...pane, width },
    { ...pane, x: pane.x + pane.width - width, width },
  ];
}

/** The frame around a pane. */
function frameBox(pane: PixelBox): PixelBox {
  return {
    x: pane.x - FRAME_PX,
    y: pane.y - FRAME_PX,
    width: pane.width + 2 * FRAME_PX,
    height: pane.height + 2 * FRAME_PX,
  };
}

/** A brick lintel, a stone sill with its shadow, around a framed pane. */
function paintSurround(
  context: RasterContext,
  sheet: FacadeSheet,
  pane: PixelBox,
): void {
  if (sheet.finish === "brick") {
    fillBox(context, sheet.accent, {
      x: pane.x - FRAME_PX - LINTEL_OVERHANG_PX,
      y: pane.y - FRAME_PX - LINTEL_PX,
      width: pane.width + 2 * (FRAME_PX + LINTEL_OVERHANG_PX),
      height: LINTEL_PX,
    });
  }
  if (!sheet.sill) return;
  const sill = {
    x: pane.x - FRAME_PX - SILL_OVERHANG_PX,
    y: pane.y + pane.height + FRAME_PX,
    width: pane.width + 2 * (FRAME_PX + SILL_OVERHANG_PX),
    height: SILL_PX,
  };
  fillBox(context, sheet.sill, sill);
  fillBox(context, UNDERSIDE_SHADE, {
    ...sill,
    y: sill.y + SILL_PX,
    height: 2,
  });
}

/**
 * One window on the colour map: lintel and sill, frame, the pane lit or dark with curtains, the
 * reveal's shadow and the bars.
 *
 * @param context - The canvas, moved to the module's corner.
 * @param sheet - The colourway.
 * @param pane - Where the glass is.
 * @param light - Its light.
 */
export function paintWindow(
  context: RasterContext,
  sheet: FacadeSheet,
  pane: PixelBox,
  light: WindowLight,
): void {
  paintSurround(context, sheet, pane);
  fillBox(context, sheet.frame, frameBox(pane));
  fillBox(context, cssHex(light?.colour ?? WINDOW_DARK), pane);
  if (light?.curtain) {
    for (const curtain of curtainBoxes(pane))
      fillBox(context, light.curtain, curtain);
  }
  fillBox(context, REVEAL_SHADE, { ...pane, height: REVEAL_TOP_PX });
  fillBox(context, REVEAL_SHADE, {
    ...pane,
    y: pane.y + REVEAL_TOP_PX,
    width: REVEAL_SIDE_PX,
    height: pane.height - REVEAL_TOP_PX,
  });
  for (const bar of windowBars(pane)) fillBox(context, sheet.frame, bar);
}

/**
 * One window on the glow map: the lit pane (dimmer behind curtains), bars dark.
 *
 * @param context - The glow canvas, moved to the module's corner.
 * @param pane - Where the glass is.
 * @param light - Its light; a dark window paints nothing.
 */
export function paintWindowGlow(
  context: RasterContext,
  pane: PixelBox,
  light: WindowLight,
): void {
  if (!light) return;
  fillBox(context, cssHex(light.colour), pane);
  if (light.curtain) {
    const behind = dimmed(light.colour, CURTAIN_GLOW);
    for (const curtain of curtainBoxes(pane)) fillBox(context, behind, curtain);
  }
  for (const bar of windowBars(pane)) fillBox(context, NO_GLOW, bar);
}

/** Shutters beside both windows of a module, on some brick and plaster houses. */
function paintShutters(
  context: RasterContext,
  panes: readonly PixelBox[],
  rng: () => number,
): void {
  if (rng() >= SHUTTER_SHARE) return;
  const colour = SHUTTER_COLOURS[Math.floor(rng() * SHUTTER_COLOURS.length)];
  for (const pane of panes) {
    for (const x of [
      pane.x - FRAME_PX - SHUTTER_PX,
      pane.x + pane.width + FRAME_PX,
    ]) {
      const shutter = {
        x,
        y: pane.y - FRAME_PX,
        width: SHUTTER_PX,
        height: pane.height + 2 * FRAME_PX,
      };
      fillBox(context, colour, shutter);
      fillBox(context, REVEAL_SHADE, { ...shutter, width: 2 });
    }
  }
}

/**
 * An upper-floor module on the colour map: the wall and two windows (the glass curtain wall is
 * its own window), shutters on a few brick and plaster modules.
 *
 * @param context - The canvas, moved to the module's corner.
 * @param sheet - The colourway.
 * @param lights - The two windows' lights.
 * @param rng - Varies the wall and the shutters.
 */
export function paintUpperModule(
  context: RasterContext,
  sheet: FacadeSheet,
  lights: readonly WindowLight[],
  rng: () => number,
): void {
  paintWall(context, sheet, MODULE_BOX, rng);
  const panes = windowPanes(sheet.finish);
  if (sheet.finish === "brick" || sheet.finish === "plaster") {
    paintShutters(context, panes, rng);
  }
  panes.forEach((pane, index) =>
    paintWindow(context, sheet, pane, lights[index]),
  );
}

/**
 * An upper-floor module on the glow map.
 *
 * @param context - The glow canvas, moved to the module's corner.
 * @param sheet - The colourway.
 * @param lights - The two windows' lights.
 */
export function paintUpperGlow(
  context: RasterContext,
  sheet: FacadeSheet,
  lights: readonly WindowLight[],
): void {
  fillBox(context, NO_GLOW, MODULE_BOX);
  windowPanes(sheet.finish).forEach((pane, index) =>
    paintWindowGlow(context, pane, lights[index]),
  );
}
