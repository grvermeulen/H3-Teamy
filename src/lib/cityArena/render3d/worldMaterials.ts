/**
 * The shared materials the 3D city is built from. One set serves every cell, so cells merge their
 * geometry per material and never own (or dispose) a material themselves.
 */
import {
  AdditiveBlending,
  DataTexture,
  DoubleSide,
  LinearFilter,
  MeshLambertMaterial,
  SpriteMaterial,
  type Texture,
} from "three";
import {
  FURNITURE_FILL,
  ROAD_CENTRE_LINE,
  TREE_CANOPY_FILL,
} from "../render/palette";
import { seedFromString } from "../sim/rng";
import { LAMP_GLOW } from "./palette3d";
import {
  FACADE_STYLES,
  createFacadeMaterial,
  createSurfaceMaterials,
  type FacadeStyle,
  type SurfaceKey,
} from "./textures";

/** Seeded façade variants per style, so neighbouring buildings of one style differ. */
export const FACADE_VARIANTS = 3;
/** Lit window share of each variant, around a third, as in an evening town. */
const FACADE_LIT_SHARES: readonly number[] = [0.28, 0.35, 0.42];
/** Bark brown of a tree trunk. */
const TRUNK_COLOUR = 0x4a3728;
/** Opacity of the bus shelter's glass back panel. */
const SHELTER_GLASS_OPACITY = 0.35;
/** Side of the lamp glow sprite's texture, px. */
const GLOW_TEXTURE_PX = 64;
/** Exponent of the glow's falloff from centre to rim; higher is a tighter core. */
const GLOW_FALLOFF_POWER = 2;
/** Channels per pixel of the glow texture (RGBA). */
const RGBA_CHANNELS = 4;
/** A full 8-bit channel. */
const MAX_BYTE = 255;

/** Every material the city builder draws with; all are shared across cells. */
export type WorldMaterials = {
  /** Ground, road, pavement, water and roofs; UVs are world metres / `TEXTURE_REPEAT_M`. */
  surfaces: Record<SurfaceKey, MeshLambertMaterial>;
  /**
   * {@link FACADE_VARIANTS} wall materials per style (pick one by structure id). UVs run along the
   * perimeter in metres / `FACADE_MODULE_M` and up in storeys; the walls geometry must carry a
   * `color` attribute (vertex colours are on for damage shading), and lit windows are emissive.
   */
  facades: Record<FacadeStyle, readonly MeshLambertMaterial[]>;
  /** The centre line on the bigger roads, the 2D map's amber. */
  roadMarking: MeshLambertMaterial;
  /** Tree trunks. */
  treeTrunk: MeshLambertMaterial;
  /** The two canopy greens, alternated by tree id. */
  canopies: readonly [MeshLambertMaterial, MeshLambertMaterial];
  /** Galvanised street metal: lamp poles, and the bus shelter's frame. */
  lampPole: MeshLambertMaterial;
  /** A lamp head, emissive in the lamp colour so it shines without a light. */
  lampHead: MeshLambertMaterial;
  /** The additive halo sprite around a lamp head; it writes no depth. */
  lampGlow: SpriteMaterial;
  /** Weathered wooden benches. */
  bench: MeshLambertMaterial;
  /** The bus shelter's see-through glass back panel, visible from both sides. */
  shelterGlass: MeshLambertMaterial;
};

/** {@link FACADE_VARIANTS} seeded wall materials for one style. */
function createFacadeVariants(style: FacadeStyle): MeshLambertMaterial[] {
  return Array.from({ length: FACADE_VARIANTS }, (_, variant) =>
    createFacadeMaterial(
      style,
      seedFromString(`${style}:${variant}`),
      FACADE_LIT_SHARES[variant % FACADE_LIT_SHARES.length],
    ),
  );
}

/** A white disc whose alpha falls from the centre to nothing at the rim. */
function createGlowTexture(): DataTexture {
  const data = new Uint8Array(
    GLOW_TEXTURE_PX * GLOW_TEXTURE_PX * RGBA_CHANNELS,
  );
  const centre = (GLOW_TEXTURE_PX - 1) / 2;
  for (let y = 0; y < GLOW_TEXTURE_PX; y++) {
    for (let x = 0; x < GLOW_TEXTURE_PX; x++) {
      const rim = Math.hypot(x - centre, y - centre) / centre;
      const offset = (y * GLOW_TEXTURE_PX + x) * RGBA_CHANNELS;
      data.fill(MAX_BYTE, offset, offset + RGBA_CHANNELS - 1);
      data[offset + RGBA_CHANNELS - 1] = Math.round(
        MAX_BYTE * Math.max(0, 1 - rim) ** GLOW_FALLOFF_POWER,
      );
    }
  }
  const texture = new DataTexture(data, GLOW_TEXTURE_PX, GLOW_TEXTURE_PX);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** A plain matte material in one colour. */
function matte(colour: number | string): MeshLambertMaterial {
  return new MeshLambertMaterial({ color: colour });
}

/** The street's lamps: pole, glowing head and its halo. */
function createLampMaterials(): Pick<
  WorldMaterials,
  "lampPole" | "lampHead" | "lampGlow"
> {
  return {
    lampPole: matte(FURNITURE_FILL.lamp),
    lampHead: new MeshLambertMaterial({
      color: LAMP_GLOW,
      emissive: LAMP_GLOW,
    }),
    lampGlow: new SpriteMaterial({
      map: createGlowTexture(),
      color: LAMP_GLOW,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  };
}

/**
 * Creates the city's shared materials: the 2D surface art as repeating textures, seeded façades
 * (brick, plaster, concrete, glass; windows lit warm and cold at random), trees and furniture.
 *
 * @param load - Loads a texture by URL, e.g. `TextureLoader.load`; called once per surface.
 * @returns The materials; free them with {@link disposeWorldMaterials}.
 */
export function createWorldMaterials(
  load: (url: string) => Texture,
): WorldMaterials {
  return {
    surfaces: createSurfaceMaterials(load),
    facades: {
      brick: createFacadeVariants("brick"),
      plaster: createFacadeVariants("plaster"),
      concrete: createFacadeVariants("concrete"),
      glass: createFacadeVariants("glass"),
    },
    roadMarking: matte(ROAD_CENTRE_LINE),
    treeTrunk: matte(TRUNK_COLOUR),
    canopies: [matte(TREE_CANOPY_FILL[0]), matte(TREE_CANOPY_FILL[1])],
    ...createLampMaterials(),
    bench: matte(FURNITURE_FILL.bench),
    shelterGlass: new MeshLambertMaterial({
      color: FURNITURE_FILL.busStop,
      transparent: true,
      opacity: SHELTER_GLASS_OPACITY,
      depthWrite: false,
      side: DoubleSide,
    }),
  };
}

/** Every material in a set, each once. */
function listWorldMaterials(
  materials: WorldMaterials,
): (MeshLambertMaterial | SpriteMaterial)[] {
  return [
    ...Object.values(materials.surfaces),
    ...FACADE_STYLES.flatMap((style) => materials.facades[style]),
    materials.roadMarking,
    materials.treeTrunk,
    ...materials.canopies,
    materials.lampPole,
    materials.lampHead,
    materials.lampGlow,
    materials.bench,
    materials.shelterGlass,
  ];
}

/**
 * Frees the GPU memory of a material set: every material and the textures it owns. Call it once,
 * when the 3D view shuts down, after every mesh using them is gone.
 *
 * @param materials - The set from {@link createWorldMaterials}.
 */
export function disposeWorldMaterials(materials: WorldMaterials): void {
  for (const material of listWorldMaterials(materials)) {
    material.map?.dispose();
    if (material instanceof MeshLambertMaterial) {
      material.emissiveMap?.dispose();
    }
    material.dispose();
  }
}
