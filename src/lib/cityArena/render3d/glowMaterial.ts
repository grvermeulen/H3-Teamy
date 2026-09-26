/**
 * The light the 3D view's guidance is drawn in — the route along the road, the mission beacons,
 * the zone wall: a flat colour added to the scene, soft at its edges, fading toward its top, and
 * fading out with the fog instead of turning fog-coloured (a fogged additive colour would glow as
 * a pale band against the far sky).
 */
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  ShaderMaterial,
  type Side,
  UniformsLib,
  UniformsUtils,
  type ColorRepresentation,
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
    alpha *= 1.0 - fogFactor;
  #endif
  gl_FragColor = vec4(uColour, alpha);
  #include <colorspace_fragment>
}
`;

/** How a glow is shaped. */
export type GlowOptions = {
  /** sRGB colour of the light. */
  colour: ColorRepresentation;
  /** Strength at its brightest, 0..1. */
  opacity: number;
  /** Fades to nothing toward the top (uv.y = 1) with this power; 0 keeps it even. */
  riseFade?: number;
  /** Fades to nothing toward both side edges (uv.x = 0 and 1) with this power; 0 keeps it even. */
  acrossFade?: number;
  /** The faces that glow: both by default; the front only for a closed shape seen from outside. */
  side?: Side;
};

/** A glow material; recolour or dim it through its uniforms. */
export type GlowMaterial = ShaderMaterial & {
  uniforms: {
    /** Linear colour of the light. */
    uColour: { value: Color };
    /** Strength at its brightest. */
    uOpacity: { value: number };
    uRiseFade: { value: number };
    uAcrossFade: { value: number };
  };
};

/**
 * Creates a glow: additive, seen from both sides unless told otherwise, never writing depth (so
 * glows cross without cutting each other) but hidden behind walls, and faded out by the fog.
 *
 * @param options - Colour, strength and fades.
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
      },
    ]),
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: options.side ?? DoubleSide,
    fog: true,
    // The 2D marker colours as they are: tone mapping would wash them toward a pale cream.
    toneMapped: false,
  }) as GlowMaterial;
}
