/**
 * The WebGL side of the 3D view: renderer, three.js scene, camera, evening lights, fog and sky
 * (spec §6.1, §6.5). What the scene contains — city, people, cars — is added by the caller.
 */
import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  WebGLRenderer,
} from "three";
import type { ArenaSettings } from "../schemas";
import { WebGl2UnavailableError } from "../webgl2";
import { disposeObject } from "./disposal";
import {
  AMBIENT_GROUND,
  AMBIENT_SKY,
  FOG_COLOUR,
  MOON_LIGHT,
} from "./palette3d";
import { SKY_RADIUS_M, createSkyDome } from "./sky";

/** The settings' render quality. */
export type RenderQuality = ArenaSettings["quality"];

/** How far the city is drawn per quality, metres (spec §6.5); fog closes at this distance. */
const VIEW_DISTANCE_M: Record<RenderQuality, number> = {
  low: 260,
  auto: 380,
  high: 520,
};
/** Most device pixels per CSS pixel per quality (spec §8): phones at "laag" render at 1. */
const MAX_PIXEL_RATIO: Record<RenderQuality, number> = {
  low: 1,
  auto: 1.5,
  high: 2,
};
/** Fog starts at this share of the view distance. */
const FOG_NEAR_SHARE = 0.35;
/** ACES filmic exposure; a touch over 1 lifts the dusk palette. */
const TONE_MAPPING_EXPOSURE = 1.1;
/** Hemisphere fill strength (sky over ground). */
const HEMISPHERE_INTENSITY = 1.4;
/** Moonlight strength. */
const MOON_INTENSITY = 0.9;
/** Where the moon shines from: high, from the north-west; only the direction matters. */
const MOON_DIRECTION: [number, number, number] = [-120, 300, -80];
/** Near and far planes, metres; the far plane holds the sky dome. */
const CAMERA_NEAR_M = 0.1;
const CAMERA_FAR_M = SKY_RADIUS_M * 1.2;
/** Placeholder field of view until the rig sets one, degrees. */
const INITIAL_FOV_DEG = 60;
/** Context attributes: the renderer takes the context it is handed as is. */
const CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  antialias: true,
  powerPreference: "high-performance",
};

/**
 * The drawing buffer's device pixels per CSS pixel for a quality (spec §8).
 *
 * @param quality - The settings' render quality.
 * @param devicePixelRatio - The screen's ratio; absent or 0 counts as 1.
 * @returns 1 at "laag", up to 1.5 at "auto", up to 2 at "hoog".
 */
export function pixelRatioFor(
  quality: RenderQuality,
  devicePixelRatio: number,
): number {
  return Math.min(devicePixelRatio || 1, MAX_PIXEL_RATIO[quality]);
}

/**
 * How far the city is drawn for a quality (spec §6.5).
 *
 * @param quality - The settings' render quality.
 * @returns Metres: 260, 380 or 520.
 */
export function viewDistanceFor(quality: RenderQuality): number {
  return VIEW_DISTANCE_M[quality];
}

/** A WebGL renderer with its scene and camera. */
export type Renderer3d = {
  scene: Scene;
  camera: PerspectiveCamera;
  /** Sizes the drawing buffer and fog for the canvas's CSS size and quality; cheap when unchanged. */
  configure(
    size: { width: number; height: number },
    quality: RenderQuality,
  ): void;
  /** Renders the scene from the camera, with the sky moved onto it. */
  render(): void;
  /** Frees the sky, the renderer and its WebGL context. */
  dispose(): void;
};

/** The WebGL2 context of `canvas`, or a {@link WebGl2UnavailableError} — the 2D fallback's signal. */
function webgl2Context(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const context = canvas.getContext("webgl2", CONTEXT_ATTRIBUTES);
  if (!context) throw new WebGl2UnavailableError();
  return context;
}

/** The evening scene: fog in the horizon colour, a hemisphere fill and the moon. */
function createEveningScene(): Scene {
  const scene = new Scene();
  scene.background = new Color(FOG_COLOUR);
  scene.fog = new Fog(FOG_COLOUR, 0, VIEW_DISTANCE_M.auto);
  const moon = new DirectionalLight(MOON_LIGHT, MOON_INTENSITY);
  moon.position.set(...MOON_DIRECTION);
  scene.add(
    new HemisphereLight(AMBIENT_SKY, AMBIENT_GROUND, HEMISPHERE_INTENSITY),
    moon,
  );
  return scene;
}

/**
 * Creates the renderer on `canvas` (spec §6.1): sRGB output, ACES filmic tone mapping, the sky
 * dome, fog, hemisphere and moon light.
 *
 * @param canvas - The WebGL canvas under the 2D HUD canvas.
 * @returns The renderer, its scene and camera.
 * @throws {WebGl2UnavailableError} When the device offers no WebGL2 context.
 */
export function createRenderer3d(canvas: HTMLCanvasElement): Renderer3d {
  const renderer = new WebGLRenderer({
    canvas,
    context: webgl2Context(canvas),
    ...CONTEXT_ATTRIBUTES,
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE;
  const scene = createEveningScene();
  const sky = createSkyDome();
  scene.add(sky);
  const camera = new PerspectiveCamera(
    INITIAL_FOV_DEG,
    1,
    CAMERA_NEAR_M,
    CAMERA_FAR_M,
  );
  const applied = { width: 0, height: 0, ratio: 0 };
  return {
    scene,
    camera,
    configure(size, quality) {
      configureSize(renderer, camera, applied, size, quality);
      const fog = scene.fog as Fog;
      fog.far = viewDistanceFor(quality);
      fog.near = fog.far * FOG_NEAR_SHARE;
    },
    render() {
      sky.position.copy(camera.position);
      renderer.render(scene, camera);
    },
    dispose() {
      disposeObject(sky);
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

/** Resizes the drawing buffer and the camera's aspect only when the size or ratio changed. */
function configureSize(
  renderer: WebGLRenderer,
  camera: PerspectiveCamera,
  applied: { width: number; height: number; ratio: number },
  size: { width: number; height: number },
  quality: RenderQuality,
): void {
  if (size.width < 1 || size.height < 1) return;
  const ratio = pixelRatioFor(quality, window.devicePixelRatio);
  if (ratio !== applied.ratio) {
    renderer.setPixelRatio(ratio);
    applied.ratio = ratio;
  }
  if (size.width === applied.width && size.height === applied.height) return;
  renderer.setSize(size.width, size.height, false);
  camera.aspect = size.width / size.height;
  camera.updateProjectionMatrix();
  applied.width = size.width;
  applied.height = size.height;
}
