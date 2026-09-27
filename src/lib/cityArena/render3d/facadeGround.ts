/**
 * Ground floors of the façade atlas, in design px: a sheet's own ground floor — windows over a
 * plinth, front doors in two of its four modules (a glass lobby on offices, double doors on
 * flats) — and the shared shopfronts: a lit display window, a glazed door and a sign board with
 * pale letters over a stall riser, in eight sign colours.
 */
import type { RasterContext } from "../render/canvasTypes";
import type { FacadeSheet } from "./facadeSheets";
import {
  MODULE_BOX,
  MODULE_WIDTH_PX,
  NO_GLOW,
  WINDOWS_PER_MODULE,
  cssHex,
  dimmed,
  fillBox,
  paintWindow,
  paintWindowGlow,
  windowPanes,
  type PixelBox,
  type WindowLight,
} from "./facadePaint";
import { paintPlinth, paintWall } from "./facadeWalls";
import { WINDOW_DARK, WINDOW_WARM } from "./palette3d";

/** Ground-floor modules per sheet; modules 0 and 2 hold the front door. */
export const GROUND_MODULES = 4;
/** Shopfront modules in the atlas's shop block (4 across, 2 rows). */
export const SHOP_MODULES = 8;
/** Top of a ground-floor window, px: a little higher than upstairs. */
const GROUND_WINDOW_TOP_PX = 24;
/** A front door: width, top, frame width and the glass in its upper part, px. */
const DOOR = { width: 46, top: 34, frame: 4, glassInset: 9, glassHeight: 24 };
/** Double doors on flats and halls are this much wider, px. */
const DOUBLE_DOOR_WIDTH_PX = 84;
/** The transom light above a door: its height and gap above the frame, px. */
const TRANSOM_PX = 10;
/** The doorstep: height and overhang each side, px. */
const STEP_PX = 4;
const STEP_OVERHANG_PX = 5;
/** The house number plate beside a door: offset from the door, top, size, px. */
const NUMBER_PLATE = { gap: 6, top: 48, size: 7, colour: "#e8e2d0" };
/** A recessed door panel's shade. */
const PANEL_SHADE = "rgba(0,0,0,0.25)";
/** Shopfront layout, px: sign band, pilasters, display window and door. */
const SHOP = {
  signTop: 6,
  signHeight: 28,
  pilaster: 8,
  openingTop: 42,
  riser: 16,
  doorWidth: 42,
  doorInset: 14,
  gap: 8,
};
/** The dark joinery of every shopfront. */
const SHOP_FRAME = "#1d1b19";
/** Warm display lighting, a touch whiter than a home's bulb. */
const SHOP_LIGHT = 0xf2d49a;
/** How brightly a display window glows at night, as a share of its light: bright, not blown out. */
const SHOP_WINDOW_GLOW = 0.55;
/**
 * The display window on the colour map, as a share of its light: the interior's own tone, which
 * the evening light and the glow add to — at full strength the two together burn out to cream.
 */
const SHOP_WINDOW_DIFFUSE = 0.45;
/** Goods take on some of the sign's colour, so each shop's window looks its own. */
const GOODS_SIGN_TINT = 0.5;
/** The shop's ceiling at the top of its window: its height as a share of the window, and shade. */
const SHOP_CEILING_SHARE = 0.22;
const SHOP_CEILING_SHADE = 0.55;
/** Sign boards: board, letter and stall-riser colours, one per shopfront. */
const SIGNS: readonly (readonly [string, string, string])[] = [
  ["#8e1b1b", "#f4eee0", "#551010"],
  ["#1d4d2b", "#f1e7c8", "#112e1a"],
  ["#1f3a6b", "#f4f1e6", "#132340"],
  ["#d9a21b", "#231d14", "#6e5212"],
  ["#1f1f1f", "#f0c95a", "#131313"],
  ["#e6dfcc", "#3a2a22", "#2a1e18"],
  ["#5a2d6b", "#f2ecf2", "#361b40"],
  ["#b5561c", "#fbf3e2", "#6c3311"],
];
/** Letters on a sign: how many, their size and spacing, px. */
const LETTERS = { minCount: 4, extra: 4, width: 7, height: 10, gap: 4 };
/** How brightly a sign's letters glow, as a share of their ink. */
const LETTER_GLOW = 0.75;
/** Steps the letter count from one sign variant to the next, so neighbours differ. */
const LETTER_COUNT_STEP = 3;
/** Goods in a display window: each silhouette's height as a share of the window's. */
const GOODS_HEIGHTS: readonly number[] = [0.42, 0.3, 0.52, 0.36];
/** Each silhouette's width, and its margin, as shares of its slot. */
const GOODS_WIDTH_SHARE = 0.7;
const GOODS_MARGIN_SHARE = 0.15;
/** How dark the goods are against the display light, as a share of it. */
const GOODS_SHADE = 0.38;
/** The glazing of a shop door: its inset from the door's edges and the kick plate under it, px. */
const SHOP_DOOR_GLASS_INSET_PX = 4;
const SHOP_DOOR_KICK_PX = 12;
/** Width of the display window's mullion, px. */
const SHOP_MULLION_PX = 3;
/** A lit sign board glows at this share of its colour. */
const SIGN_BOARD_GLOW = 0.3;
/** The glass of a lit door or transom glows at this share of the window light. */
const DOOR_GLASS_GLOW = 0.6;
/** Radix of a CSS hex colour, and the largest value of a colour channel. */
const HEX_RADIX = 16;
const CHANNEL_MAX = 0xff;

/** Whether a sheet's ground-floor module holds the front door. */
function holdsDoor(moduleIndex: number): boolean {
  return moduleIndex % 2 === 0;
}

/** The door of a ground-floor module: in the left bay of module 0, the right bay of module 2. */
function doorBox(sheet: FacadeSheet, moduleIndex: number): PixelBox {
  const bay = MODULE_WIDTH_PX / WINDOWS_PER_MODULE;
  const centre = moduleIndex === 0 ? bay / 2 : bay * 1.5;
  const double = sheet.finish === "concrete" || sheet.finish === "panel";
  const width = double ? DOUBLE_DOOR_WIDTH_PX : DOOR.width;
  const top = DOOR.top;
  return {
    x: Math.round(centre - width / 2),
    y: top,
    width,
    height: MODULE_BOX.height - top,
  };
}

/** The glass in a door's upper part. */
function doorGlass(door: PixelBox): PixelBox {
  return {
    x: door.x + DOOR.glassInset,
    y: door.y + DOOR.glassInset,
    width: door.width - 2 * DOOR.glassInset,
    height: DOOR.glassHeight,
  };
}

/** A front door: frame, transom, painted door with its glass and panels, step and number. */
function paintDoor(
  context: RasterContext,
  sheet: FacadeSheet,
  door: PixelBox,
  lit: boolean,
): void {
  const { frame } = DOOR;
  fillBox(context, sheet.frame, {
    x: door.x - frame,
    y: door.y - frame - TRANSOM_PX - frame,
    width: door.width + 2 * frame,
    height: door.height + 2 * frame + TRANSOM_PX,
  });
  fillBox(context, cssHex(lit ? WINDOW_WARM : WINDOW_DARK), {
    ...door,
    y: door.y - TRANSOM_PX - frame,
    height: TRANSOM_PX,
  });
  fillBox(context, sheet.door, door);
  const glass = doorGlass(door);
  fillBox(context, cssHex(lit ? WINDOW_WARM : WINDOW_DARK), glass);
  const panelTop = glass.y + glass.height + DOOR.glassInset;
  fillBox(context, PANEL_SHADE, { ...glass, y: panelTop, height: 2 });
  fillBox(context, PANEL_SHADE, {
    ...glass,
    y: panelTop,
    width: 2,
    height: door.y + door.height - panelTop - DOOR.glassInset,
  });
  fillBox(context, sheet.sill ?? sheet.accent, {
    x: door.x - STEP_OVERHANG_PX,
    y: door.y + door.height - STEP_PX,
    width: door.width + 2 * STEP_OVERHANG_PX,
    height: STEP_PX,
  });
  const plate = door.x + door.width + frame + NUMBER_PLATE.gap;
  fillBox(context, NUMBER_PLATE.colour, {
    x: plate,
    y: NUMBER_PLATE.top,
    width: NUMBER_PLATE.size,
    height: NUMBER_PLATE.size,
  });
}

/** The windows of a ground-floor module that are not covered by its door. */
function groundPanes(sheet: FacadeSheet, moduleIndex: number): PixelBox[] {
  const panes = windowPanes(sheet.finish, GROUND_WINDOW_TOP_PX);
  if (!holdsDoor(moduleIndex)) return panes;
  const door = doorBox(sheet, moduleIndex);
  return panes.filter(
    (pane) => pane.x + pane.width < door.x || pane.x > door.x + door.width,
  );
}

/**
 * A sheet's ground-floor module on the colour map: wall, plinth, windows and — in modules 0 and
 * 2 — the front door. A glass sheet's ground floor is its curtain wall with a door.
 *
 * @param context - The canvas, moved to the module's corner.
 * @param sheet - The colourway.
 * @param moduleIndex - 0…{@link GROUND_MODULES}−1.
 * @param lights - Window lights (two, left first), the last also lighting the door's glass.
 * @param rng - Varies the wall.
 */
export function paintGroundModule(
  context: RasterContext,
  sheet: FacadeSheet,
  moduleIndex: number,
  lights: readonly WindowLight[],
  rng: () => number,
): void {
  paintWall(context, sheet, MODULE_BOX, rng);
  if (sheet.finish !== "glass") paintPlinth(context, sheet, MODULE_BOX);
  const panes = groundPanes(sheet, moduleIndex);
  panes.forEach((pane, index) =>
    paintWindow(context, sheet, pane, lights[index]),
  );
  if (!holdsDoor(moduleIndex)) return;
  paintDoor(context, sheet, doorBox(sheet, moduleIndex), lights[1] !== null);
}

/**
 * A sheet's ground-floor module on the glow map.
 *
 * @param context - The glow canvas, moved to the module's corner.
 * @param sheet - The colourway.
 * @param moduleIndex - 0…{@link GROUND_MODULES}−1.
 * @param lights - As for {@link paintGroundModule}.
 */
export function paintGroundGlow(
  context: RasterContext,
  sheet: FacadeSheet,
  moduleIndex: number,
  lights: readonly WindowLight[],
): void {
  fillBox(context, NO_GLOW, MODULE_BOX);
  groundPanes(sheet, moduleIndex).forEach((pane, index) =>
    paintWindowGlow(context, pane, lights[index]),
  );
  if (!holdsDoor(moduleIndex) || lights[1] === null) return;
  const door = doorBox(sheet, moduleIndex);
  const light = dimmed(WINDOW_WARM, DOOR_GLASS_GLOW);
  fillBox(context, light, doorGlass(door));
  fillBox(context, light, {
    ...door,
    y: door.y - TRANSOM_PX - DOOR.frame,
    height: TRANSOM_PX,
  });
}

/** Where a shopfront's door and display window go; the door sits left on even variants. */
function shopLayout(variant: number): { door: PixelBox; window: PixelBox } {
  const { pilaster, openingTop, riser, doorWidth, doorInset, gap } = SHOP;
  const bottom = MODULE_BOX.height;
  const doorLeft = variant % 2 === 0;
  const doorX = doorLeft
    ? pilaster + doorInset
    : MODULE_WIDTH_PX - pilaster - doorInset - doorWidth;
  const door = {
    x: doorX,
    y: openingTop,
    width: doorWidth,
    height: bottom - openingTop,
  };
  const windowX = doorLeft ? doorX + doorWidth + gap : pilaster + gap;
  const windowWidth =
    MODULE_WIDTH_PX - 2 * pilaster - doorInset - doorWidth - 2 * gap;
  const window = {
    x: windowX,
    y: openingTop,
    width: windowWidth,
    height: bottom - openingTop - riser,
  };
  return { door, window };
}

/** The letters of a sign, centred on its board. */
function signLetters(variant: number): PixelBox[] {
  const count =
    LETTERS.minCount + ((variant * LETTER_COUNT_STEP) % LETTERS.extra);
  const span = count * LETTERS.width + (count - 1) * LETTERS.gap;
  const left = Math.round((MODULE_WIDTH_PX - span) / 2);
  const top = SHOP.signTop + Math.round((SHOP.signHeight - LETTERS.height) / 2);
  return Array.from({ length: count }, (_, index) => ({
    x: left + index * (LETTERS.width + LETTERS.gap),
    y: top,
    width: LETTERS.width,
    height: LETTERS.height,
  }));
}

/** Silhouettes of goods on the display window's floor, their heights turned by the variant. */
function goods(window: PixelBox, variant: number): PixelBox[] {
  const step = window.width / GOODS_HEIGHTS.length;
  return GOODS_HEIGHTS.map((_, index) => {
    const share = GOODS_HEIGHTS[(index + variant) % GOODS_HEIGHTS.length];
    const height = Math.round(window.height * share);
    return {
      x: Math.round(window.x + index * step + step * GOODS_MARGIN_SHARE),
      y: window.y + window.height - height,
      width: Math.round(step * GOODS_WIDTH_SHARE),
      height,
    };
  });
}

/** The colour of a shop's goods: the display light shaded, mixed with its sign's board. */
function goodsColour(board: string, strength: number): string {
  const sign = Number.parseInt(board.slice(1), HEX_RADIX);
  const mix = (shift: number): number => {
    const light = ((SHOP_LIGHT >> shift) & CHANNEL_MAX) * GOODS_SHADE;
    const tint = (sign >> shift) & CHANNEL_MAX;
    return Math.round(
      (light * (1 - GOODS_SIGN_TINT) + tint * GOODS_SIGN_TINT) * strength,
    );
  };
  return cssHex((mix(16) << 16) | (mix(8) << 8) | mix(0));
}

/** A display window: its light, the dimmer ceiling across its top, and goods on its floor. */
function paintDisplay(
  context: RasterContext,
  window: PixelBox,
  look: { strength: number; board: string; variant: number },
): void {
  const { strength } = look;
  fillBox(context, dimmed(SHOP_LIGHT, strength), window);
  fillBox(context, dimmed(SHOP_LIGHT, strength * SHOP_CEILING_SHADE), {
    ...window,
    height: Math.round(window.height * SHOP_CEILING_SHARE),
  });
  const colour = goodsColour(look.board, strength);
  for (const item of goods(window, look.variant))
    fillBox(context, colour, item);
}

/** The glazing of a shop door. */
function shopDoorGlass(door: PixelBox): PixelBox {
  return {
    x: door.x + SHOP_DOOR_GLASS_INSET_PX,
    y: door.y + SHOP_DOOR_GLASS_INSET_PX,
    width: door.width - 2 * SHOP_DOOR_GLASS_INSET_PX,
    height: door.height - SHOP_DOOR_GLASS_INSET_PX - SHOP_DOOR_KICK_PX,
  };
}

/** The sign board across the top of a shopfront. */
const SIGN_BOARD: PixelBox = {
  x: SHOP.pilaster,
  y: SHOP.signTop,
  width: MODULE_WIDTH_PX - 2 * SHOP.pilaster,
  height: SHOP.signHeight,
};

/**
 * One shopfront on the colour map: dark joinery, a sign board with letters, a lit display window
 * with goods, a glazed door and a stall riser.
 *
 * @param context - The canvas, moved to the module's corner.
 * @param variant - 0…{@link SHOP_MODULES}−1: the sign colour and which side the door is on.
 */
export function paintShopModule(context: RasterContext, variant: number): void {
  const [board, ink, riser] = SIGNS[variant % SIGNS.length];
  fillBox(context, SHOP_FRAME, MODULE_BOX);
  fillBox(context, board, SIGN_BOARD);
  for (const letter of signLetters(variant)) fillBox(context, ink, letter);
  const { door, window } = shopLayout(variant);
  paintDisplay(context, window, {
    strength: SHOP_WINDOW_DIFFUSE,
    board,
    variant,
  });
  fillBox(context, SHOP_FRAME, {
    ...window,
    x: window.x + Math.round(window.width / 2),
    width: SHOP_MULLION_PX,
  });
  fillBox(context, riser, {
    ...window,
    y: window.y + window.height,
    height: SHOP.riser,
  });
  fillBox(
    context,
    dimmed(SHOP_LIGHT, SHOP_WINDOW_DIFFUSE),
    shopDoorGlass(door),
  );
}

/**
 * One shopfront on the glow map: the display window and door glass lit, the letters bright and
 * the board faintly lit from inside.
 *
 * @param context - The glow canvas, moved to the module's corner.
 * @param variant - As for {@link paintShopModule}.
 */
export function paintShopGlow(context: RasterContext, variant: number): void {
  const [board, ink] = SIGNS[variant % SIGNS.length];
  fillBox(context, NO_GLOW, MODULE_BOX);
  const boardColour = Number.parseInt(board.slice(1), HEX_RADIX);
  fillBox(context, dimmed(boardColour, SIGN_BOARD_GLOW), SIGN_BOARD);
  const inkColour = Number.parseInt(ink.slice(1), HEX_RADIX);
  for (const letter of signLetters(variant))
    fillBox(context, dimmed(inkColour, LETTER_GLOW), letter);
  const { door, window } = shopLayout(variant);
  paintDisplay(context, window, { strength: SHOP_WINDOW_GLOW, board, variant });
  fillBox(
    context,
    dimmed(SHOP_LIGHT, SHOP_WINDOW_GLOW * DOOR_GLASS_GLOW),
    shopDoorGlass(door),
  );
}
