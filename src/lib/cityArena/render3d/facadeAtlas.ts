/**
 * The façade atlas: every wall of the city painted into one canvas texture (and one glow map on the
 * same layout), so a cell's walls draw in a single call whatever mix of façades it holds.
 *
 * The atlas holds one block per kind of wall: each sheet's upper floors (4 modules × 4 storeys),
 * its ground floor with doors (4 × 1) and a plain stretch for gables (1 × 1), and the shared
 * shopfronts (4 × 2). A wall vertex carries its block's rectangle in the `facadeBlock` attribute
 * and a UV in block units; the material's fragment shader wraps that UV with `fract` into the
 * block and samples with `textureGrad` on the unwrapped UV, so the mip level stays smooth across
 * the wrap. Each block is surrounded by a gutter holding a wrapped copy of its opposite edge, so
 * filtering at a block's edge reads the wall's own continuation, not the next block.
 */
import {
  CanvasTexture,
  ClampToEdgeWrapping,
  MeshLambertMaterial,
  SRGBColorSpace,
  type WebGLProgramParametersWithUniforms,
} from "three";
import type { RasterContext } from "../render/canvasTypes";
import { createRng, seedFromString } from "../sim/rng";
import {
  GROUND_MODULES,
  SHOP_MODULES,
  paintGroundGlow,
  paintGroundModule,
  paintShopGlow,
  paintShopModule,
} from "./facadeGround";
import {
  MODULE_BOX,
  MODULE_HEIGHT_PX,
  MODULE_WIDTH_PX,
  NO_GLOW,
  WINDOWS_PER_MODULE,
  fillBox,
  paintUpperGlow,
  paintUpperModule,
  seededLights,
} from "./facadePaint";
import { FACADE_SHEETS, type FacadeSheet } from "./facadeSheets";
import { paintWall } from "./facadeWalls";

/** The kinds of wall the atlas holds. */
export type FacadeBlockKind = "upper" | "ground" | "plain" | "shop";

/** A block's rectangle in atlas UV: origin (bottom left) and size, `[u0, v0, du, dv]`. */
export type FacadeBlockRect = readonly [number, number, number, number];

/** The name of the per-vertex attribute holding a wall's {@link FacadeBlockRect}. */
export const FACADE_BLOCK_ATTRIBUTE = "facadeBlock";

/** Modules across and storeys up in each kind of block. */
export const BLOCK_MODULES: Record<FacadeBlockKind, readonly [number, number]> =
  {
    upper: [4, 4],
    ground: [GROUND_MODULES, 1],
    plain: [1, 1],
    shop: [SHOP_MODULES / 2, 2],
  };

/** Colour map pixels per design px: a module is 128 × 66 px. */
const COLOUR_SCALE = 0.5;
/** Glow map pixels per design px: half the colour map again; the lit panes are flat rectangles. */
const GLOW_SCALE = 0.25;
/** Gutter around every block, in colour map px (the glow map's is half as wide). */
const GUTTER_PX = 4;
/** Blocks side by side in one atlas row. */
const BLOCKS_PER_ROW = 4;
/** Plain blocks side by side in the last row, beside the shopfronts. */
const PLAINS_PER_ROW = 11;
/** Lit shares of the windows upstairs and on the ground floor. */
const UPPER_LIT_SHARE = 0.35;
const GROUND_LIT_SHARE = 0.4;
/** Anisotropic filtering: walls are mostly seen at a grazing angle along a street. */
const ANISOTROPY = 4;
/** The emissive colour the glow map is multiplied by: the map shows through at full strength. */
const FULL_EMISSION = 0xffffff;

/** A block placed in the atlas, colour map px: its slot's corner and its content size. */
type Placed = { x: number; y: number; width: number; height: number };

/** The atlas layout: its size and every block's place, keyed `kind:sheet` (`shop` alone). */
type Layout = { width: number; height: number; blocks: Map<string, Placed> };

/** The key of a block. */
function blockKey(kind: FacadeBlockKind, sheet: number): string {
  return kind === "shop" ? "shop" : `${kind}:${sheet}`;
}

/** A block's content size in colour map px. */
function contentSize(kind: FacadeBlockKind): [number, number] {
  const [cols, rows] = BLOCK_MODULES[kind];
  return [
    cols * MODULE_WIDTH_PX * COLOUR_SCALE,
    rows * MODULE_HEIGHT_PX * COLOUR_SCALE,
  ];
}

/** Places `count` blocks of a kind in rows of `perRow` from `top` at `left`; returns the bottom. */
function placeRows(
  blocks: Map<string, Placed>,
  kind: FacadeBlockKind,
  sheets: readonly number[],
  origin: { left: number; top: number; perRow: number },
): number {
  const [width, height] = contentSize(kind);
  const [slotW, slotH] = [width + 2 * GUTTER_PX, height + 2 * GUTTER_PX];
  sheets.forEach((sheet, index) => {
    const x = origin.left + (index % origin.perRow) * slotW;
    const y = origin.top + Math.floor(index / origin.perRow) * slotH;
    blocks.set(blockKey(kind, sheet), { x, y, width, height });
  });
  return origin.top + Math.ceil(sheets.length / origin.perRow) * slotH;
}

/** The fixed layout: upper floors, then ground floors, then shopfronts beside the plain blocks. */
function computeLayout(): Layout {
  const sheets = FACADE_SHEETS.map((_, index) => index);
  const blocks = new Map<string, Placed>();
  const [upperWidth] = contentSize("upper");
  const width = BLOCKS_PER_ROW * (upperWidth + 2 * GUTTER_PX);
  const perRow = BLOCKS_PER_ROW;
  let top = placeRows(blocks, "upper", sheets, { left: 0, top: 0, perRow });
  top = placeRows(blocks, "ground", sheets, { left: 0, top, perRow });
  const shopBottom = placeRows(blocks, "shop", [0], { left: 0, top, perRow });
  const [shopWidth] = contentSize("shop");
  const left = shopWidth + 2 * GUTTER_PX;
  const plainBottom = placeRows(blocks, "plain", sheets, {
    left,
    top,
    perRow: PLAINS_PER_ROW,
  });
  return { width, height: Math.max(shopBottom, plainBottom), blocks };
}

/** The layout, computed once. */
const LAYOUT = computeLayout();

/** A placed block's rectangle in UV (v up, as the texture is flipped). */
function uvRect(placed: Placed): FacadeBlockRect {
  const { width: atlasWidth, height: atlasHeight } = LAYOUT;
  return [
    (placed.x + GUTTER_PX) / atlasWidth,
    1 - (placed.y + GUTTER_PX + placed.height) / atlasHeight,
    placed.width / atlasWidth,
    placed.height / atlasHeight,
  ];
}

/** Every block's rectangle, by kind and sheet (the shopfronts under every sheet). */
const BLOCK_RECTS: Record<FacadeBlockKind, FacadeBlockRect[]> = {
  upper: [],
  ground: [],
  plain: [],
  shop: [],
};
for (const kind of Object.keys(BLOCK_RECTS) as FacadeBlockKind[]) {
  BLOCK_RECTS[kind] = FACADE_SHEETS.map((_, sheet) => {
    const placed = LAYOUT.blocks.get(blockKey(kind, sheet));
    if (!placed) throw new Error(`No façade block ${blockKey(kind, sheet)}`);
    return uvRect(placed);
  });
}

/**
 * Where a block lies in the atlas, in UV (v up, as the texture is flipped): the rectangle a wall
 * vertex's `facadeBlock` attribute holds.
 *
 * @param kind - The kind of wall.
 * @param sheet - The sheet (ignored for shopfronts).
 * @returns `[u0, v0, du, dv]`.
 */
export function facadeBlockRect(
  kind: FacadeBlockKind,
  sheet: number,
): FacadeBlockRect {
  return BLOCK_RECTS[kind][sheet];
}

/**
 * The atlas's size in colour map px.
 *
 * @returns Width and height.
 */
export function facadeAtlasSize(): { width: number; height: number } {
  return { width: LAYOUT.width, height: LAYOUT.height };
}

/** Paints one module of a block into the canvas (already moved to the module's corner). */
type ModulePainter = (
  context: RasterContext,
  kind: FacadeBlockKind,
  sheet: FacadeSheet,
  moduleIndex: number,
) => void;

/** The lights of one module's windows. */
function lightsOf(
  kind: FacadeBlockKind,
  sheet: FacadeSheet,
  moduleIndex: number,
): ReturnType<typeof seededLights> {
  const share = kind === "ground" ? GROUND_LIT_SHARE : UPPER_LIT_SHARE;
  return seededLights(
    `${sheet.key}:${kind}:${moduleIndex}`,
    WINDOWS_PER_MODULE,
    share,
  );
}

/** Paints a module on the colour map. */
function paintColourModule(
  context: RasterContext,
  kind: FacadeBlockKind,
  sheet: FacadeSheet,
  moduleIndex: number,
): void {
  const rng = createRng(
    seedFromString(`${sheet.key}:${kind}:wall:${moduleIndex}`),
  );
  const lights = lightsOf(kind, sheet, moduleIndex);
  if (kind === "upper") paintUpperModule(context, sheet, lights, rng);
  else if (kind === "ground")
    paintGroundModule(context, sheet, moduleIndex, lights, rng);
  else if (kind === "shop") paintShopModule(context, moduleIndex);
  else paintWall(context, sheet, MODULE_BOX, rng);
}

/** Paints a module on the glow map. */
function paintGlowModule(
  context: RasterContext,
  kind: FacadeBlockKind,
  sheet: FacadeSheet,
  moduleIndex: number,
): void {
  const lights = lightsOf(kind, sheet, moduleIndex);
  if (kind === "upper") paintUpperGlow(context, sheet, lights);
  else if (kind === "ground")
    paintGroundGlow(context, sheet, moduleIndex, lights);
  else if (kind === "shop") paintShopGlow(context, moduleIndex);
  else fillBox(context, NO_GLOW, MODULE_BOX);
}

/** Paints one block's modules into its place, clipped to it, at `scale` px per design px. */
function paintBlock(
  context: RasterContext,
  placed: Placed,
  scale: number,
  paint: () => void,
): void {
  const unit = scale / COLOUR_SCALE;
  const [x, y] = [(placed.x + GUTTER_PX) * unit, (placed.y + GUTTER_PX) * unit];
  context.save();
  context.beginPath();
  context.rect(x, y, placed.width * unit, placed.height * unit);
  context.clip();
  context.translate(x, y);
  context.scale(scale, scale);
  paint();
  context.restore();
}

/**
 * Fills a block's gutter with wrapped copies of its opposite edges, in canvas px: the strip to its
 * left repeats its right edge, and so on round, corners included.
 */
function wrapGutter(
  context: RasterContext,
  canvas: CanvasImageSource,
  area: { x: number; y: number; width: number; height: number; gutter: number },
): void {
  const { x, y, width, height, gutter } = area;
  const spans = (start: number, size: number): [number, number, number][] => [
    [start + size - gutter, start - gutter, gutter],
    [start, start, size],
    [start, start + size, gutter],
  ];
  for (const [sx, dx, w] of spans(x, width)) {
    for (const [sy, dy, h] of spans(y, height)) {
      if (dx === sx && dy === sy) continue;
      context.drawImage(canvas, sx, sy, w, h, dx, dy, w, h);
    }
  }
}

/** Paints every module of one block. */
function paintModules(
  context: RasterContext,
  kind: FacadeBlockKind,
  sheet: FacadeSheet,
  painter: ModulePainter,
): void {
  const [cols, rows] = BLOCK_MODULES[kind];
  for (let moduleIndex = 0; moduleIndex < cols * rows; moduleIndex++) {
    context.save();
    context.translate(
      (moduleIndex % cols) * MODULE_WIDTH_PX,
      Math.floor(moduleIndex / cols) * MODULE_HEIGHT_PX,
    );
    painter(context, kind, sheet, moduleIndex);
    context.restore();
  }
}

/** Every block of the layout with its kind and sheet. */
function eachBlock(
  visit: (kind: FacadeBlockKind, sheet: number, placed: Placed) => void,
): void {
  for (const [key, placed] of LAYOUT.blocks) {
    const [kind, sheet] = key.split(":");
    visit(kind as FacadeBlockKind, Number(sheet ?? 0), placed);
  }
}

/**
 * Paints the whole atlas at `scale` px per design px onto a context of the atlas's size at that
 * scale: every block, then every gutter.
 *
 * @param context - The atlas canvas's context, untransformed.
 * @param canvas - That canvas, the source of the gutter copies.
 * @param scale - {@link COLOUR_SCALE} or {@link GLOW_SCALE}.
 * @param painter - Paints one module.
 */
export function paintFacadeAtlas(
  context: RasterContext,
  canvas: CanvasImageSource,
  scale: number,
  painter: ModulePainter,
): void {
  eachBlock((kind, sheet, placed) =>
    paintBlock(context, placed, scale, () =>
      paintModules(context, kind, FACADE_SHEETS[sheet], painter),
    ),
  );
  const unit = scale / COLOUR_SCALE;
  eachBlock((_kind, _sheet, placed) =>
    wrapGutter(context, canvas, {
      x: (placed.x + GUTTER_PX) * unit,
      y: (placed.y + GUTTER_PX) * unit,
      width: placed.width * unit,
      height: placed.height * unit,
      gutter: GUTTER_PX * unit,
    }),
  );
}

/** A canvas the size of the atlas at `scale`, painted, as a clamped sRGB texture. */
function atlasTexture(scale: number, painter: ModulePainter): CanvasTexture {
  const unit = scale / COLOUR_SCALE;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(LAYOUT.width * unit);
  canvas.height = Math.round(LAYOUT.height * unit);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas context unavailable for façades");
  paintFacadeAtlas(context, canvas, scale, painter);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = ANISOTROPY;
  return texture;
}

/** The vertex shader's additions: the block attribute handed on to the fragment shader. */
const VERTEX_PARS = /* glsl */ `#include <uv_pars_vertex>
attribute vec4 facadeBlock;
varying vec4 vFacadeBlock;`;
const VERTEX_MAIN = /* glsl */ `#include <uv_vertex>
vFacadeBlock = facadeBlock;`;
const FRAGMENT_PARS = /* glsl */ `#include <uv_pars_fragment>
varying vec4 vFacadeBlock;`;
/** Wraps the UV into its block and samples with the unwrapped UV's derivatives. */
const FRAGMENT_MAP = /* glsl */ `vec2 facadeUv = vFacadeBlock.xy + fract( vMapUv ) * vFacadeBlock.zw;
vec2 facadeDx = dFdx( vMapUv ) * vFacadeBlock.zw;
vec2 facadeDy = dFdy( vMapUv ) * vFacadeBlock.zw;
diffuseColor *= textureGrad( map, facadeUv, facadeDx, facadeDy );`;
const FRAGMENT_EMISSIVE = /* glsl */ `totalEmissiveRadiance *= textureGrad( emissiveMap, facadeUv, facadeDx, facadeDy ).rgb;`;

/**
 * Rewrites a Lambert program to read its map and emissive map through the façade atlas.
 *
 * @param shader - The program's sources, as `onBeforeCompile` hands them over.
 */
export function patchFacadeShader(
  shader: Pick<
    WebGLProgramParametersWithUniforms,
    "vertexShader" | "fragmentShader"
  >,
): void {
  shader.vertexShader = shader.vertexShader
    .replace("#include <uv_pars_vertex>", VERTEX_PARS)
    .replace("#include <uv_vertex>", VERTEX_MAIN);
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <uv_pars_fragment>", FRAGMENT_PARS)
    .replace("#include <map_fragment>", FRAGMENT_MAP)
    .replace("#include <emissivemap_fragment>", FRAGMENT_EMISSIVE);
}

/**
 * The one wall material of the city: the atlas as `map`, its glow twin as `emissiveMap` (lit
 * windows and shops shine at night), vertex colours on for damage scorching, and the shader
 * patched to wrap each wall's UV into its block.
 *
 * @returns The material; it owns both textures.
 */
export function createFacadeAtlasMaterial(): MeshLambertMaterial {
  const material = new MeshLambertMaterial({
    map: atlasTexture(COLOUR_SCALE, paintColourModule),
    emissiveMap: atlasTexture(GLOW_SCALE, paintGlowModule),
    emissive: FULL_EMISSION,
    vertexColors: true,
  });
  material.onBeforeCompile = patchFacadeShader;
  material.customProgramCacheKey = () => "facade-atlas";
  return material;
}
