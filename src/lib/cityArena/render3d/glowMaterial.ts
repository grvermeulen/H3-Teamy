/**
 * The light the 3D view's guidance is drawn in — the route along the road, the mission beacons,
 * the zone wall: a flat colour added to the scene (or laid over it, for a beacon's core), soft at
 * its edges, fading toward its top, and fading out with the fog instead of turning fog-coloured (a
 * fogged additive colour would glow as a pale band against the far sky). A glow may keep most of
 * itself in the fog, as a beacon must to be found from across town. {@link glowAlpha} is the
 * fragment shader's strength in TypeScript, so the shapes can be tested without WebGL.
 */
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  type Blending,
  type ColorRepresentation,
  type Side,
} from "three";

const VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uColour;
uniform float uOpacity;
uniform float uRiseFade;
uniform float uAcrossFade;
uniform float uFogShare;
varying vec2 vUv;
#include <fog_pars_fragment>
void main() {
  float alpha = uOpacity;
  if (uRiseFade > 0.0) alpha *= pow(1.0 - clamp(vUv.y, 0.0, 1.0), uRiseFade);
  if (uAcrossFade > 0.0) alpha *= pow(1.0 - abs(vUv.x * 2.0 - 1.0), uAcrossFade);
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    alpha *= 1.0 - uFogShare * fogFactor;
  #endif
  gl_FragColor = vec4(uColour, alpha);
  #include <colorspace_fragment>
}
`;

/** The fog takes all of a glow unless the glow says otherwise. */
const FULL_FOG_SHARE = 1;

/** How a glow's strength is shaped. */
export type GlowShape = {
  /** Strength at its brightest, 0..1. */
  opacity: number;
  /** Fades to nothing toward the top (uv.y = 1) with this power; 0 keeps it even. */
  riseFade?: number;
  /** Fades to nothing toward both side edges (uv.x = 0 and 1) with this power; 0 keeps it even. */
  acrossFade?: number;
  /** How much of the glow the fog takes where it is thickest: 1 all of it, 0 none. */
  fogShare?: number;
};

/** How a glow is shaped and drawn. */
export type GlowOptions = GlowShape & {
  /** sRGB colour of the light. */
  colour: ColorRepresentation;
  /** The faces that glow: both by default; the front only for a closed shape seen from outside. */
  side?: Side;
  /** Additive by default; normal blending keeps a colour over a bright sky. */
  blending?: Blending;
};

/**
 * A glow's strength at a point, exactly as its fragment shader works it out.
 *
 * @param shape - Its strength and fades.
 * @param u - Across the glow, 0..1.
 * @param v - Up (or along) the glow, 0..1.
 * @param fogFactor - How thick the fog is there, 0 (clear) to 1 (the fog's far end).
 * @returns The alpha, 0..opacity.
 */
export function glowAlpha(
  shape: GlowShape,
  u: number,
  v: number,
  fogFactor: number,
): number {
  let alpha = shape.opacity;
  const rise = shape.riseFade ?? 0;
  const across = shape.acrossFade ?? 0;
  if (rise > 0) alpha *= (1 - Math.min(1, Math.max(0, v))) ** rise;
  if (across > 0) alpha *= (1 - Math.abs(u * 2 - 1)) ** across;
  return alpha * (1 - (shape.fogShare ?? FULL_FOG_SHARE) * fogFactor);
}

/**
 * How thick three.js's linear fog is at a depth, as its shaders work it out (a smoothstep).
 *
 * @param depth - Distance from the camera, metres.
 * @param near - Where the fog starts.
 * @param far - Where it is complete.
 * @returns 0 before `near`, 1 beyond `far`.
 */
export function linearFogFactor(
  depth: number,
  near: number,
  far: number,
): number {
  const t = Math.min(1, Math.max(0, (depth - near) / (far - near)));
  return t * t * (3 - 2 * t);
}

/** A glow material; recolour or dim it through its uniforms. */
export type GlowMaterial = ShaderMaterial & {
  uniforms: {
    /** Linear colour of the light. */
    uColour: { value: Color };
    /** Strength at its brightest. */
    uOpacity: { value: number };
    uRiseFade: { value: number };
    uAcrossFade: { value: number };
    uFogShare: { value: number };
  };
};

/**
 * Creates a glow: additive and seen from both sides unless told otherwise, never writing depth
 * (so glows cross without cutting each other) but hidden behind walls, and faded out by the fog
 * as far as its {@link GlowShape.fogShare} lets it.
 *
 * @param options - Colour, strength, fades, faces and blending.
 * @returns The material; its geometry's UVs run across (x) and up or along (y).
 */
export function createGlowMaterial(options: GlowOptions): GlowMaterial {
  return new ShaderMaterial({
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        uColour: { value: new Color(options.colour) },
        uOpacity: { value: options.opacity },
        uRiseFade: { value: options.riseFade ?? 0 },
        uAcrossFade: { value: options.acrossFade ?? 0 },
        uFogShare: { value: options.fogShare ?? FULL_FOG_SHARE },
      },
    ]),
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    blending: options.blending ?? AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: options.side ?? DoubleSide,
    fog: true,
    // The 2D marker colours as they are: tone mapping would wash them toward a pale cream.
    toneMapped: false,
  }) as GlowMaterial;
}
