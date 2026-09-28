/**
 * The glow of a fireball: bright where the ball faces the camera and fading to nothing at its rim,
 * so an additive sphere reads as a ball of fire rather than a glass dome.
 */
import { AdditiveBlending, Color, FrontSide, ShaderMaterial } from "three";

/** How sharply the glow falls off toward the rim; higher keeps a tighter core. */
const RIM_FALLOFF = 1.6;

const VERTEX_SHADER = /* glsl */ `
varying vec3 vNormal;
varying vec3 vToCamera;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vToCamera = normalize(-mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uColour;
uniform float uOpacity;
uniform float uRimFalloff;
varying vec3 vNormal;
varying vec3 vToCamera;
void main() {
  float facing = max(dot(normalize(vNormal), normalize(vToCamera)), 0.0);
  gl_FragColor = vec4(uColour, uOpacity * pow(facing, uRimFalloff));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** A fireball's material; animate it through its two uniforms. */
export type FireballMaterial = ShaderMaterial & {
  uniforms: {
    /** Linear colour of the glow. */
    uColour: { value: Color };
    /** Opacity at the ball's centre, 0..1. */
    uOpacity: { value: number };
  };
};

/**
 * Creates one fireball's glow material.
 *
 * @param colour - sRGB hex colour it starts at.
 * @returns An additive material that never writes depth and ignores fog, so a far blast still glows.
 */
export function createFireballMaterial(colour: number): FireballMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColour: { value: new Color(colour) },
      uOpacity: { value: 1 },
      uRimFalloff: { value: RIM_FALLOFF },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: FrontSide,
  }) as FireballMaterial;
}
