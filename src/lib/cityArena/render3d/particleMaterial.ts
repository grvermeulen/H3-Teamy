/**
 * The one shader every 3D particle draws with: a soft round sprite, sized in metres and shrunk by
 * distance, whose colour and opacity follow its life. It needs no texture — the disc is cut from
 * `gl_PointCoord` in the fragment shader.
 */
import {
  AdditiveBlending,
  NormalBlending,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
} from "three";

/** Viewport height assumed until the first draw reports the real one, pixels. */
const DEFAULT_VIEWPORT_HEIGHT_PX = 800;
/** Fire and sparks shrink to this share of their birth size as they cool. */
const FIRE_END_SCALE = 0.35;
/** Smoke and dust billow to this multiple of their birth size. */
const SMOKE_END_SCALE = 3;
/**
 * Share of a sprite's radius that stays fully opaque before its edge fades: sparks keep a crisp
 * core, smoke fades from the middle so neighbouring puffs merge instead of reading as beads.
 */
const FIRE_SOLID_CORE = 0.35;
const SMOKE_SOLID_CORE = 0;
/** Opacity of a fresh fire sprite. */
const FIRE_PEAK_ALPHA = 1;
/** Opacity of smoke at its densest; below 1 so overlapping puffs still read as volume. */
const SMOKE_PEAK_ALPHA = 0.75;
/** Share of its life a smoke puff takes to fade in, so it swells out of the fire. */
const SMOKE_FADE_IN_SHARE = 0.1;
/**
 * Smoke fades out over this share of its diameter above the ground. A point sprite has one depth
 * for all its pixels, so without the fade the ground would cut a hard line through every puff that
 * reaches it. Sparks are too small to need it.
 */
const SMOKE_GROUND_FADE_SHARE = 0.3;

const VERTEX_SHADER = /* glsl */ `
attribute vec3 aColour;
attribute float aSize;
attribute float aLife;
uniform float uViewportHeight;
uniform float uEndScale;
uniform float uPeakAlpha;
uniform float uFadeIn;
varying vec3 vColour;
varying float vAlpha;
varying float vCentreHeight;
varying float vDiameter;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float grow = mix(1.0, uEndScale, aLife);
  vDiameter = aSize * grow;
  vCentreHeight = (modelMatrix * vec4(position, 1.0)).y;
  float pixelsPerMetre = projectionMatrix[1][1] * 0.5 * uViewportHeight;
  gl_PointSize = vDiameter * pixelsPerMetre / max(-mvPosition.z, 0.05);
  float fadeIn = uFadeIn > 0.0 ? clamp(aLife / uFadeIn, 0.0, 1.0) : 1.0;
  vAlpha = uPeakAlpha * fadeIn * (1.0 - aLife);
  vColour = aColour;
  #include <fog_vertex>
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform float uGroundFade;
uniform float uSolidCore;
varying vec3 vColour;
varying float vAlpha;
varying float vCentreHeight;
varying float vDiameter;
#include <fog_pars_fragment>
void main() {
  float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
  if (radius > 1.0) discard;
  float soft = 1.0 - smoothstep(uSolidCore, 1.0, radius);
  // Height of this pixel above the ground, as if the sprite stood upright where the particle is.
  float height = vCentreHeight + (0.5 - gl_PointCoord.y) * vDiameter;
  float ground = uGroundFade > 0.0
    ? smoothstep(0.0, uGroundFade * vDiameter, height)
    : 1.0;
  gl_FragColor = vec4(vColour, vAlpha * soft * ground);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/**
 * The particle material for one blend mode. Fire adds light and ignores the fog, so a distant blast
 * still glows; smoke blends normally, billows as it ages and fades into the fog.
 *
 * @param additive - Additive blending for fire and sparks; normal blending for smoke and dust.
 * @returns A transparent material that never writes depth; set `uViewportHeight` before drawing.
 */
export function createParticleMaterial(additive: boolean): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        uViewportHeight: { value: DEFAULT_VIEWPORT_HEIGHT_PX },
        uEndScale: { value: additive ? FIRE_END_SCALE : SMOKE_END_SCALE },
        uPeakAlpha: { value: additive ? FIRE_PEAK_ALPHA : SMOKE_PEAK_ALPHA },
        uFadeIn: { value: additive ? 0 : SMOKE_FADE_IN_SHARE },
        uGroundFade: { value: additive ? 0 : SMOKE_GROUND_FADE_SHARE },
        uSolidCore: { value: additive ? FIRE_SOLID_CORE : SMOKE_SOLID_CORE },
      },
    ]),
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    blending: additive ? AdditiveBlending : NormalBlending,
    transparent: true,
    depthWrite: false,
    fog: !additive,
  });
}
