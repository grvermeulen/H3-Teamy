/**
 * Textures of the 3D city: the 2D map's seamless surface art, loaded as repeating textures, and
 * façades painted on a canvas from a seed.
 *
 * Every texture here repeats once per UV unit, so the geometry decides the scale: ground, road,
 * water and roof UVs are world metres / {@link TEXTURE_REPEAT_M}, the same 8 m per repeat the 2D
 * map paints them at; wall UVs run along the perimeter in metres / {@link FACADE_MODULE_M} and up
 * in storeys.
 */
import {
  CanvasTexture,
  MeshLambertMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from "three";
import type { RasterContext } from "../render/canvasTypes";
import { createRng } from "../sim/rng";
import type { GroundKind } from "../world/mapTypes";
import { WINDOW_COLD, WINDOW_DARK, WINDOW_WARM } from "./palette3d";

/** Ground covered by one repeat of a surface texture, metres (the manifest's `tileMetres`). */
export const TEXTURE_REPEAT_M = 8;

/** Wall covered by one façade texture across, metres; it is one storey high. */
export const FACADE_MODULE_M = 6;

/** A seamless surface texture: the two road surfaces, water, each ground kind and both roofs. */
export type SurfaceKey =
  "road" | "pavement" | "water" | GroundKind | "roofTiles" | "roofFlat";

/** Where each surface's art is served; the sprite manifest's `surfaces` files, pinned by a test. */
const SURFACE_URLS: Record<SurfaceKey, string> = {
  road: "/arena/sprites/road-tarmac.png",
  pavement: "/arena/sprites/pavement-slabs.png",
  water: "/arena/sprites/water-river.png",
  grass: "/arena/sprites/ground-grass.png",
  field: "/arena/sprites/ground-field.png",
  forest: "/arena/sprites/ground-forest.png",
  urban: "/arena/sprites/ground-urban.png",
  roofTiles: "/arena/sprites/roof-tiles.png",
  roofFlat: "/arena/sprites/roof-flat.png",
};

/** Every {@link SurfaceKey}, in a stable order. */
export const SURFACE_KEYS: readonly SurfaceKey[] = [
  "road",
  "pavement",
  "water",
  "grass",
  "field",
  "forest",
  "urban",
  "roofTiles",
  "roofFlat",
];

/**
 * The URL of a surface's texture, the same file the 2D map paints with.
 *
 * @param key - The surface.
 * @returns A path under `/arena/sprites/`.
 */
export function surfaceUrl(key: SurfaceKey): string {
  return SURFACE_URLS[key];
}

/** Makes a colour texture repeat in both directions and decode as sRGB; returns it. */
function repeatingColourMap<T extends Texture>(texture: T): T {
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * One material per surface, each mapping its 2D texture so it repeats once per UV unit.
 *
 * @param load - Loads a texture by URL, e.g. `TextureLoader.load`; called once per surface.
 * @returns The surface materials.
 */
export function createSurfaceMaterials(
  load: (url: string) => Texture,
): Record<SurfaceKey, MeshLambertMaterial> {
  const material = (key: SurfaceKey): MeshLambertMaterial =>
    new MeshLambertMaterial({ map: repeatingColourMap(load(surfaceUrl(key))) });
  return {
    road: material("road"),
    pavement: material("pavement"),
    water: material("water"),
    grass: material("grass"),
    field: material("field"),
    forest: material("forest"),
    urban: material("urban"),
    roofTiles: material("roofTiles"),
    roofFlat: material("roofFlat"),
  };
}

/** How a wall is finished: red-brown brick, pale plaster, grey concrete or a dark glass office. */
export type FacadeStyle = "brick" | "plaster" | "concrete" | "glass";

/** Every {@link FacadeStyle}, in a stable order. */
export const FACADE_STYLES: readonly FacadeStyle[] = [
  "brick",
  "plaster",
  "concrete",
  "glass",
];

/** Façade canvas width: {@link FACADE_MODULE_M} of wall, about 43 px per metre. */
const FACADE_WIDTH_PX = 256;
/** Façade canvas height: one 3.1 m storey at the same scale. */
const FACADE_HEIGHT_PX = 132;
/** Windows side by side in one module. */
const WINDOWS_PER_MODULE = 2;
/** Share of the lit windows lit by a warm bulb rather than a screen or a cold tube. */
const WARM_WINDOW_SHARE = 0.7;
/** Width of the frame around a window and of its mullion and transom, px. */
const FRAME_PX = 3;
/** Height of the transom bar, as a share of the window height from the top. */
const TRANSOM_SHARE = 0.3;
/** Height of a window sill, px. */
const SILL_PX = 5;
/** How far a sill sticks out past the window on each side, px. */
const SILL_OVERHANG_PX = 4;
/** What the glow map shows where nothing is lit: no emission. */
const NO_GLOW = "#000000";
/** The emissive colour the glow map is multiplied by: the map shows through at full strength. */
const FULL_EMISSION = 0xffffff;
/** Radix of a CSS hex colour. */
const HEX_RADIX = 16;
/** Digits of a CSS hex colour. */
const CSS_HEX_DIGITS = 6;

/** Window size and height in a module, px from the top of the storey. */
type WindowShape = { width: number; height: number; top: number };

/** A style's colours, window shape and the wall finish painted behind the windows. */
type FacadeLook = {
  frame: string;
  sill: string | null;
  window: WindowShape;
  paintWall: (context: RasterContext, rng: () => number) => void;
};

/** A rectangle on the façade canvas, px. */
type PixelBox = { x: number; y: number; width: number; height: number };

/** A hex colour number as a CSS colour string. */
function cssHex(colour: number): string {
  return `#${colour.toString(HEX_RADIX).padStart(CSS_HEX_DIGITS, "0")}`;
}

/** Fills one rectangle in a colour. */
function fillBox(context: RasterContext, colour: string, box: PixelBox): void {
  context.fillStyle = colour;
  context.fillRect(box.x, box.y, box.width, box.height);
}

/** The whole canvas as a box. */
const FULL_CANVAS: PixelBox = {
  x: 0,
  y: 0,
  width: FACADE_WIDTH_PX,
  height: FACADE_HEIGHT_PX,
};

/** A brick's size including its mortar joint, px; both divide the canvas, so it tiles. */
const BRICK_LENGTH_PX = 16;
const BRICK_COURSE_PX = 6;
/** Mortar joint width, px. */
const MORTAR_PX = 1;
/** Share of bricks fired a shade darker, so the wall is not a flat grid. */
const DARK_BRICK_SHARE = 0.15;
const BRICK = "#6d3b2c";
const BRICK_DARK = "#5a3024";
const MORTAR = "#7d6d62";

/** Red-brown brick in half-bond courses over light mortar, a few bricks darker. */
function paintBrick(context: RasterContext, rng: () => number): void {
  fillBox(context, MORTAR, FULL_CANVAS);
  for (let row = 0; row * BRICK_COURSE_PX < FACADE_HEIGHT_PX; row++) {
    const offset = (row % 2) * (BRICK_LENGTH_PX / 2);
    for (let x = -offset; x < FACADE_WIDTH_PX; x += BRICK_LENGTH_PX) {
      const colour = rng() < DARK_BRICK_SHARE ? BRICK_DARK : BRICK;
      fillBox(context, colour, {
        x,
        y: row * BRICK_COURSE_PX,
        width: BRICK_LENGTH_PX - MORTAR_PX,
        height: BRICK_COURSE_PX - MORTAR_PX,
      });
    }
  }
}

/** Band heights along the bottom of a storey, px: a plaster plinth, a concrete slab edge. */
const PLINTH_PX = 18;
const SLAB_PX = 10;
/** Width of the joint between two concrete panels, px. */
const PANEL_JOINT_PX = 2;
const PLASTER = "#8f8878";
const PLASTER_PLINTH = "#6f695c";
const CONCRETE = "#5f6368";
const CONCRETE_SLAB = "#6a6e73";
const CONCRETE_JOINT = "#4c5055";

/** Pale plaster over a darker plinth. */
function paintPlaster(context: RasterContext): void {
  fillBox(context, PLASTER, FULL_CANVAS);
  fillBox(context, PLASTER_PLINTH, {
    ...FULL_CANVAS,
    y: FACADE_HEIGHT_PX - PLINTH_PX,
    height: PLINTH_PX,
  });
}

/** Grey concrete panels, a joint between each, over the floor slab's edge. */
function paintConcrete(context: RasterContext): void {
  fillBox(context, CONCRETE, FULL_CANVAS);
  fillBox(context, CONCRETE_SLAB, {
    ...FULL_CANVAS,
    y: FACADE_HEIGHT_PX - SLAB_PX,
    height: SLAB_PX,
  });
  for (let x = 0; x < FACADE_WIDTH_PX; x += FACADE_WIDTH_PX / 2) {
    fillBox(context, CONCRETE_JOINT, {
      ...FULL_CANVAS,
      x,
      width: PANEL_JOINT_PX,
    });
  }
}

/** Glass curtain wall: mullion spacing, spandrel height and mullion width, px. */
const MULLION_SPACING_PX = 32;
const SPANDREL_PX = 26;
const MULLION_PX = 3;
const GLASS = "#2b3c4f";
const GLASS_SPANDREL = "#1f2b38";
const GLASS_MULLION = "#18202a";

/** Dark glass between mullions, over an opaque spandrel band at the floor. */
function paintGlass(context: RasterContext): void {
  fillBox(context, GLASS, FULL_CANVAS);
  fillBox(context, GLASS_SPANDREL, {
    ...FULL_CANVAS,
    y: FACADE_HEIGHT_PX - SPANDREL_PX,
    height: SPANDREL_PX,
  });
  for (let x = 0; x < FACADE_WIDTH_PX; x += MULLION_SPACING_PX) {
    fillBox(context, GLASS_MULLION, { ...FULL_CANVAS, x, width: MULLION_PX });
  }
}

/** Each style's look; windows in px (about 43 px per metre, sill some 0.9 m up). */
const FACADE_LOOKS: Record<FacadeStyle, FacadeLook> = {
  brick: {
    frame: "#d8d2c4",
    sill: "#a8a196",
    window: { width: 52, height: 64, top: 30 },
    paintWall: paintBrick,
  },
  plaster: {
    frame: "#3f3d39",
    sill: "#bdb6a6",
    window: { width: 52, height: 64, top: 30 },
    paintWall: paintPlaster,
  },
  concrete: {
    frame: "#2f3236",
    sill: "#4b4f54",
    window: { width: 60, height: 60, top: 32 },
    paintWall: paintConcrete,
  },
  glass: {
    frame: GLASS_MULLION,
    sill: null,
    window: { width: 104, height: 92, top: 14 },
    paintWall: paintGlass,
  },
};

/** The panes of a module's windows, each centred in its share of the width. */
function windowBoxes(shape: WindowShape): PixelBox[] {
  const bay = FACADE_WIDTH_PX / WINDOWS_PER_MODULE;
  return Array.from({ length: WINDOWS_PER_MODULE }, (_, index) => ({
    x: Math.round(bay * (index + 0.5) - shape.width / 2),
    y: shape.top,
    width: shape.width,
    height: shape.height,
  }));
}

/**
 * Each window's light, drawn first from a fresh seeded generator so the colour map and the glow
 * map agree: a lit colour, or `null` for a dark window.
 */
function windowLights(rng: () => number, litShare: number): (number | null)[] {
  return Array.from({ length: WINDOWS_PER_MODULE }, () => {
    if (rng() >= litShare) return null;
    return rng() < WARM_WINDOW_SHARE ? WINDOW_WARM : WINDOW_COLD;
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

/** One window on the colour map: frame, pane (lit or dark), bars and the sill below. */
function paintWindow(
  context: RasterContext,
  look: FacadeLook,
  pane: PixelBox,
  light: number | null,
): void {
  fillBox(context, look.frame, {
    x: pane.x - FRAME_PX,
    y: pane.y - FRAME_PX,
    width: pane.width + 2 * FRAME_PX,
    height: pane.height + 2 * FRAME_PX,
  });
  fillBox(context, cssHex(light ?? WINDOW_DARK), pane);
  for (const bar of windowBars(pane)) fillBox(context, look.frame, bar);
  if (!look.sill) return;
  fillBox(context, look.sill, {
    x: pane.x - SILL_OVERHANG_PX,
    y: pane.y + pane.height + FRAME_PX,
    width: pane.width + 2 * SILL_OVERHANG_PX,
    height: SILL_PX,
  });
}

/** A façade-sized canvas painted by `paint`, as a repeating sRGB texture. */
function facadeCanvasTexture(
  paint: (context: RasterContext) => void,
): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = FACADE_WIDTH_PX;
  canvas.height = FACADE_HEIGHT_PX;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas context unavailable for façades");
  paint(context);
  return repeatingColourMap(new CanvasTexture(canvas));
}

/**
 * A seeded canvas texture: one storey (3.1 m) tall, 6 m wide, windows lit by `litShare`.
 *
 * Two windows with frames (and sills, except on glass) over the style's wall; each window is lit
 * with probability `litShare`, warm or cold, else dark. The same seed paints the same texture.
 *
 * @param style - The wall finish.
 * @param seed - Seeds the lit windows and the wall's variation.
 * @param litShare - Chance in [0, 1] that a window is lit.
 * @returns A 256 × 132 px texture that repeats in both directions.
 */
export function createFacadeTexture(
  style: FacadeStyle,
  seed: number,
  litShare: number,
): CanvasTexture {
  const look = FACADE_LOOKS[style];
  return facadeCanvasTexture((context) => {
    const rng = createRng(seed);
    const lights = windowLights(rng, litShare);
    look.paintWall(context, rng);
    windowBoxes(look.window).forEach((pane, index) =>
      paintWindow(context, look, pane, lights[index]),
    );
  });
}

/** The glow map matching {@link createFacadeTexture}: black but for the lit panes. */
function createFacadeGlowTexture(
  style: FacadeStyle,
  seed: number,
  litShare: number,
): CanvasTexture {
  const look = FACADE_LOOKS[style];
  return facadeCanvasTexture((context) => {
    const lights = windowLights(createRng(seed), litShare);
    fillBox(context, NO_GLOW, FULL_CANVAS);
    windowBoxes(look.window).forEach((pane, index) => {
      const light = lights[index];
      if (light === null) return;
      fillBox(context, cssHex(light), pane);
      for (const bar of windowBars(pane)) fillBox(context, NO_GLOW, bar);
    });
  });
}

/**
 * A wall material whose lit windows glow at night: the façade texture as `map`, a second canvas
 * holding only the lit panes as `emissiveMap`, emissive white. Vertex colours are on, so the
 * walls geometry must carry a `color` attribute (white leaves the wall as painted; darker
 * scorches it).
 *
 * @param style - The wall finish.
 * @param seed - Seeds the lit windows and the wall's variation.
 * @param litShare - Chance in [0, 1] that a window is lit.
 * @returns The material; it owns both textures.
 */
export function createFacadeMaterial(
  style: FacadeStyle,
  seed: number,
  litShare: number,
): MeshLambertMaterial {
  return new MeshLambertMaterial({
    map: createFacadeTexture(style, seed, litShare),
    emissiveMap: createFacadeGlowTexture(style, seed, litShare),
    emissive: FULL_EMISSION,
    vertexColors: true,
  });
}
