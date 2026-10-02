/**
 * The evening sky (spec §6.5): a large inverted sphere that follows the camera, shaded from the
 * deep blue zenith down to the horizon with a warm band of the last light, and fog-coloured
 * below the horizon so the ground's fogged edge meets it without a seam. At full city detail
 * stars and the moon hang inside it.
 */
import {
  BackSide,
  Color,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  type Object3D,
} from "three";
import type { CityDetail } from "./cityDetail";
import { FOG_COLOUR, HORIZON_GLOW, SKY_HORIZON, SKY_TOP } from "./palette3d";
import { createMoon, createStarField } from "./skyDetail";

/** Radius of the sky dome, metres; inside the camera's far plane, beyond the fog. */
export const SKY_RADIUS_M = 900;
/** Sphere tessellation; the gradient is smooth, so a coarse sphere is enough. */
const SKY_WIDTH_SEGMENTS = 32;
const SKY_HEIGHT_SEGMENTS = 16;

const VERTEX_SHADER = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// h is the view direction's height: 0 on the horizon, 1 at the zenith. The glow band peaks just
// above the horizon and fades within a few degrees either side.
const FRAGMENT_SHADER = /* glsl */ `
uniform vec3 topColour;
uniform vec3 horizonColour;
uniform vec3 glowColour;
uniform vec3 groundColour;
varying vec3 vDirection;
void main() {
  float h = normalize(vDirection).y;
  vec3 sky = mix(horizonColour, topColour, smoothstep(0.0, 0.55, h));
  float band = exp(-abs(h - 0.03) * 22.0);
  sky = mix(sky, glowColour, band * 0.55);
  vec3 colour = mix(sky, groundColour, smoothstep(0.0, 0.06, -h));
  gl_FragColor = vec4(colour, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Builds the sky dome with the stars and the moon inside it. It draws first and writes no depth,
 * so the city always covers it; move it to the camera's position every frame.
 *
 * @param moonLight - The moonlight's direction (where it shines from), y up: the moon hangs on its bearing.
 * @returns The dome mesh, owning its geometry, material, stars and moon.
 */
export function createSkyDome(
  moonLight: readonly [number, number, number],
): Mesh {
  const material = new ShaderMaterial({
    uniforms: {
      topColour: { value: new Color(SKY_TOP) },
      horizonColour: { value: new Color(SKY_HORIZON) },
      glowColour: { value: new Color(HORIZON_GLOW) },
      groundColour: { value: new Color(FOG_COLOUR) },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    side: BackSide,
    depthWrite: false,
  });
  const dome = new Mesh(
    new SphereGeometry(SKY_RADIUS_M, SKY_WIDTH_SEGMENTS, SKY_HEIGHT_SEGMENTS),
    material,
  );
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  dome.add(createStarField(SKY_RADIUS_M), createMoon(SKY_RADIUS_M, moonLight));
  return dome;
}

/**
 * Shows the stars and the moon at full city detail; "laag" keeps the plain evening gradient.
 *
 * @param dome - The dome from {@link createSkyDome}.
 * @param detail - The city detail the quality builds.
 */
export function setSkyDetail(dome: Object3D, detail: CityDetail): void {
  for (const child of dome.children) child.visible = detail === "full";
}
