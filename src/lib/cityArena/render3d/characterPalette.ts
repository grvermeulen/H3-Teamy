/**
 * The glTF characters' material: lit like the procedural characters (Lambert), coloured per
 * vertex from a small colour table indexed by the pack's `_PALETTE` slot attribute. Every
 * character owns one material and so one table — recolouring a pedestrian rewrites 48 floats —
 * while all of them share a single shader program.
 */
import { Color, MeshLambertMaterial, SRGBColorSpace } from "three";
import { PALETTE_ATTRIBUTE, PALETTE_SLOTS } from "../characterManifest";

/** Components per palette entry (linear RGB). */
const RGB = 3;
/** The attribute's name as three.js's GLTFLoader gives it (lower-cased). */
export const PALETTE_ATTRIBUTE_NAME = PALETTE_ATTRIBUTE.toLowerCase();
/** Every palette material shares this program. */
const PROGRAM_KEY = "arena-character-palette";
/** Scratch colour for sRGB → linear conversion. */
const SCRATCH = new Color();

/** A character's material and the colour table it reads. */
export type PaletteMaterial = {
  material: MeshLambertMaterial;
  /** Linear RGB per slot, {@link PALETTE_SLOTS} entries; write, then nothing else is needed. */
  colours: Float32Array;
};

/** Declares the slot attribute and the table, and hands each vertex its slot's colour. */
const VERTEX_HEADER = `#include <common>
attribute float ${PALETTE_ATTRIBUTE_NAME};
uniform vec3 paletteColours[${PALETTE_SLOTS}];
varying vec3 vPaletteColour;`;
const VERTEX_BODY = `#include <begin_vertex>
vPaletteColour = paletteColours[int(${PALETTE_ATTRIBUTE_NAME} + 0.5)];`;
const FRAGMENT_HEADER = `#include <common>
varying vec3 vPaletteColour;`;
const DIFFUSE_LINE = "vec4 diffuseColor = vec4( diffuse, opacity );";
const DIFFUSE_PALETTE =
  "vec4 diffuseColor = vec4( diffuse * vPaletteColour, opacity );";

/**
 * A fresh palette material, every slot white.
 *
 * @returns The material and its colour table.
 */
export function createPaletteMaterial(): PaletteMaterial {
  const colours = new Float32Array(PALETTE_SLOTS * RGB).fill(1);
  const material = new MeshLambertMaterial();
  material.name = PROGRAM_KEY;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.paletteColours = { value: colours };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", VERTEX_HEADER)
      .replace("#include <begin_vertex>", VERTEX_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", FRAGMENT_HEADER)
      .replace(DIFFUSE_LINE, DIFFUSE_PALETTE);
  };
  material.customProgramCacheKey = () => PROGRAM_KEY;
  return { material, colours };
}

/**
 * Writes an sRGB hex colour into one slot of a colour table.
 *
 * @param colours - The table.
 * @param slot - The slot, 0…{@link PALETTE_SLOTS} − 1.
 * @param hex - `0xRRGGBB`, sRGB.
 */
export function writePaletteSlot(
  colours: Float32Array,
  slot: number,
  hex: number,
): void {
  SCRATCH.setHex(hex, SRGBColorSpace);
  colours[slot * RGB] = SCRATCH.r;
  colours[slot * RGB + 1] = SCRATCH.g;
  colours[slot * RGB + 2] = SCRATCH.b;
}
