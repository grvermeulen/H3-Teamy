/**
 * Textures of the 3D city: the 2D map's seamless surface art, loaded as repeating textures, and
 * the scales the walls are measured in (the façades themselves are painted in `facadeAtlas.ts`).
 *
 * Every surface texture repeats once per UV unit, so the geometry decides the scale: ground, road,
 * water and roof UVs are world metres / {@link TEXTURE_REPEAT_M}, the same 8 m per repeat the 2D
 * map paints them at; wall UVs count façade modules of {@link FACADE_MODULE_M} along the wall and
 * storeys up it.
 */
import {
  MeshLambertMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from "three";
import {
  GROUND_FILL,
  PAVEMENT_FILL,
  ROAD_FILL,
  WATER_FILL,
  buildingFill,
} from "../render/palette";
import type { GroundKind } from "../world/mapTypes";
import type { FacadeFinish } from "./facadeSheets";

/** Ground covered by one repeat of a surface texture, metres (the manifest's `tileMetres`). */
export const TEXTURE_REPEAT_M = 8;

/** Wall covered by one façade module across, metres; a module is one storey high. */
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

/**
 * The pavement's material colour, a multiplier on its art. The 2D slab texture is painted light
 * so pavements read under the night map's overlays; lit by the evening sky at eye level it glared
 * like snow, so the 3D view darkens it to dusk concrete. Every other surface keeps its art as is.
 */
export const PAVEMENT_DUSK_SHADE = 0.55;

/** Each surface's material colour, a multiplier on its art (or on its flat fallback colour). */
const SURFACE_SHADES: Partial<Record<SurfaceKey, number>> = {
  pavement: PAVEMENT_DUSK_SHADE,
};

/**
 * How much the 3D view darkens a surface's art: {@link PAVEMENT_DUSK_SHADE} for the pavement, 1
 * for the rest.
 *
 * @param key - The surface.
 * @returns A multiplier in (0, 1].
 */
export function surfaceShade(key: SurfaceKey): number {
  return SURFACE_SHADES[key] ?? 1;
}

/** Storeys whose 2D roof shade stands in for a tiled roof's art: a small house. */
const TILED_ROOF_SHADE_LEVELS = 2;
/** Storeys whose 2D roof shade stands in for a gravel roof's art: a block or a hall. */
const FLAT_ROOF_SHADE_LEVELS = 4;

/**
 * The flat colour of each surface, as the 2D map fills it before (or instead of) its art: the
 * mean tone of that art, so a surface whose texture fails to load keeps its look, not black.
 */
const SURFACE_FALLBACK_COLOURS: Record<SurfaceKey, string> = {
  road: ROAD_FILL,
  pavement: PAVEMENT_FILL,
  water: WATER_FILL,
  ...GROUND_FILL,
  roofTiles: buildingFill(TILED_ROOF_SHADE_LEVELS),
  roofFlat: buildingFill(FLAT_ROOF_SHADE_LEVELS),
};

/**
 * The surface whose art is served at a URL.
 *
 * @param url - A URL from {@link surfaceUrl}.
 * @returns The surface, or `undefined` for any other URL.
 */
export function surfaceOfUrl(url: string): SurfaceKey | undefined {
  return SURFACE_KEYS.find((key) => SURFACE_URLS[key] === url);
}

/**
 * A surface's flat colour: the 2D map's fill for it, the mean tone of its art.
 *
 * @param key - The surface.
 * @returns A CSS hex colour.
 */
export function surfaceFallbackColour(key: SurfaceKey): string {
  return SURFACE_FALLBACK_COLOURS[key];
}

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
 * One material per surface, each mapping its 2D texture so it repeats once per UV unit, shaded by
 * {@link surfaceShade}.
 *
 * @param load - Loads a texture by URL, e.g. `TextureLoader.load`; called once per surface.
 * @returns The surface materials.
 */
export function createSurfaceMaterials(
  load: (url: string) => Texture,
): Record<SurfaceKey, MeshLambertMaterial> {
  const material = (key: SurfaceKey): MeshLambertMaterial => {
    const surface = new MeshLambertMaterial({
      map: repeatingColourMap(load(surfaceUrl(key))),
    });
    surface.color.setScalar(surfaceShade(key));
    return surface;
  };
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

/**
 * The colour each finish's walls read as from across the street: what a collapsing building's
 * stand-in and its rubble are painted in.
 */
const FACADE_WALL_COLOURS: Record<FacadeFinish, string> = {
  brick: "#6d3b2c",
  plaster: "#8f8878",
  panel: "#3c4046",
  concrete: "#5f6368",
  glass: "#2b3c4f",
};

/**
 * The colour a finish's walls are painted in behind their windows and frames: what a wall of it
 * reads as from across the street.
 *
 * @param finish - The façade finish.
 * @returns A CSS hex colour: brick red-brown, pale plaster, anthracite panels, grey concrete or
 *   dark glass.
 */
export function facadeWallColour(finish: FacadeFinish): string {
  return FACADE_WALL_COLOURS[finish];
}
