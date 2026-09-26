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
  type Camera,
  type Light,
} from "three";
import { DESKTOP_MIN_WIDTH_PX } from "../render/camera";
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
/*
 * The evening's light levels. three.js lights a matte surface by intensity / π, and ACES's toe
 * crushes whatever lands below about 0.05, so at dusk levels the side of a character facing away
 * from the moon went black. The fill below lifts that side into ACES's straight part — a person
 * 10 m down the street shows skin and clothes — while the scene still reads as evening: the road
 * and walls stay well below the lit windows and lamps, which are emissive and do not rise with it.
 */
/** ACES filmic exposure; a quarter over 1 lifts the dusk palette out of the curve's toe. */
const TONE_MAPPING_EXPOSURE = 1.25;
/** Hemisphere fill strength (sky over ground): the light every side of a character gets. */
const HEMISPHERE_INTENSITY = 4;
/** Moonlight strength: the side facing the moon reads a step brighter than the fill. */
const MOON_INTENSITY = 1.9;
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
 * How far the city is drawn for a quality (spec §6.5). At "auto" a phone-sized viewport draws as
 * near as "laag", by the rule the 2D view lowers its render scale by.
 *
 * @param quality - The settings' render quality.
 * @param viewportWidth - The canvas's CSS width.
 * @returns Metres: 260, 380 or 520.
 */
export function viewDistanceFor(
  quality: RenderQuality,
  viewportWidth: number,
): number {
  if (quality === "auto" && viewportWidth < DESKTOP_MIN_WIDTH_PX)
    return VIEW_DISTANCE_M.low;
  return VIEW_DISTANCE_M[quality];
}

/**
 * A second scene drawn over the city once its depth is cleared, so nothing in the city can hide
 * or cut through it: the first-person hands.
 */
export type OverlayPass = { scene: Scene; camera: Camera };

/** A WebGL renderer with its scene and camera. */
export type Renderer3d = {
  scene: Scene;
  camera: PerspectiveCamera;
  /** Sizes the drawing buffer and fog for the canvas's CSS size and quality; cheap when unchanged. */
  configure(
    size: { width: number; height: number },
    quality: RenderQuality,
  ): void;
  /**
   * Renders the scene from the camera, with the sky moved onto it, then `overlay` (if any) over
   * it with the depth buffer cleared.
   */
  render(overlay?: OverlayPass | null): void;
  /** Frees the sky, the renderer and its WebGL context. */
  dispose(): void;
};

/** The WebGL2 context of `canvas`, or a {@link WebGl2UnavailableError} — the 2D fallback's signal. */
function webgl2Context(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const context = canvas.getContext("webgl2", CONTEXT_ATTRIBUTES);
  if (!context) throw new WebGl2UnavailableError();
  return context;
}

/**
 * The evening's light (spec §6.5): a hemisphere fill, sky over ground, and the moon. Every call
 * makes new lights, so a second scene (the first-person hands) can be lit the same way.
 *
 * @returns The hemisphere light and the moon's directional light.
 */
export function createEveningLights(): Light[] {
  const moon = new DirectionalLight(MOON_LIGHT, MOON_INTENSITY);
  moon.position.set(...MOON_DIRECTION);
  return [
    new HemisphereLight(AMBIENT_SKY, AMBIENT_GROUND, HEMISPHERE_INTENSITY),
    moon,
  ];
}

/** The evening scene: fog in the horizon colour, a hemisphere fill and the moon. */
function createEveningScene(): Scene {
  const scene = new Scene();
  scene.background = new Color(FOG_COLOUR);
  scene.fog = new Fog(FOG_COLOUR, 0, VIEW_DISTANCE_M.auto);
  scene.add(...createEveningLights());
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
      fog.far = viewDistanceFor(quality, size.width);
      fog.near = fog.far * FOG_NEAR_SHARE;
    },
    render(overlay) {
      sky.position.copy(camera.position);
      renderer.render(scene, camera);
      if (overlay) renderOver(renderer, overlay);
    },
    dispose() {
      disposeObject(sky);
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

/** Draws `overlay` over what the renderer drew, keeping its colour but not its depth. */
function renderOver(renderer: WebGLRenderer, overlay: OverlayPass): void {
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.render(overlay.scene, overlay.camera);
  renderer.autoClear = true;
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
