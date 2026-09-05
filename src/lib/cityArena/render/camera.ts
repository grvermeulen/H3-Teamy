import type { Rect } from "../mapBuild/geometry";
import type { Point } from "../world/projection";

/** Raster zoom levels in px per metre; intermediate zooms are not used. */
export const ZOOM_LEVELS = [4, 6, 8] as const;
/** One of {@link ZOOM_LEVELS}. */
export type ZoomLevel = (typeof ZOOM_LEVELS)[number];
/** Canvas size in CSS pixels. */
export type Viewport = { width: number; height: number };
/** Camera centre in metres plus its zoom. */
export type Camera = { x: number; y: number; zoom: ZoomLevel };

/** Look-ahead time in seconds: the camera leads the player by velocity × this (spec §8). */
export const LOOK_AHEAD_S = 0.4;
/** Maximum look-ahead distance in metres (spec §8). */
export const LOOK_AHEAD_MAX_M = 15;
/** Look-ahead cap while driving; the on-foot cap stays spec §8's 15 m. */
export const DRIVING_LOOK_AHEAD_MAX_M = 30;
/** Exponential easing rate per second. */
export const CAMERA_EASE_PER_S = 6;
/** Target width of the view in metres on phones. */
export const PHONE_VIEW_METRES = 60;
/** Target width of the view in metres on desktop-sized viewports. */
export const DESKTOP_VIEW_METRES = 120;
/** Viewports at least this wide count as desktop. */
export const DESKTOP_MIN_WIDTH_PX = 768;

/** Nearest zoom level so that the viewport shows ≈ 60 m (phone) or ≈ 120 m (desktop). */
export function zoomLevelForViewport(widthPx: number): ZoomLevel {
  const targetMetres =
    widthPx < DESKTOP_MIN_WIDTH_PX ? PHONE_VIEW_METRES : DESKTOP_VIEW_METRES;
  const ideal = widthPx / targetMetres;
  let best: ZoomLevel = ZOOM_LEVELS[0];
  for (const level of ZOOM_LEVELS) {
    if (Math.abs(level - ideal) < Math.abs(best - ideal)) best = level;
  }
  return best;
}

/** A camera centred on `centre`. */
export function createCamera(centre: Point, zoom: ZoomLevel): Camera {
  return { x: centre[0], y: centre[1], zoom };
}

/** Eases the camera toward the target plus a velocity look-ahead capped at `maxLookAheadM`. */
export function updateCamera(
  camera: Camera,
  target: Point,
  velocity: Point,
  dt: number,
  maxLookAheadM: number = LOOK_AHEAD_MAX_M,
): Camera {
  let aheadX = velocity[0] * LOOK_AHEAD_S;
  let aheadY = velocity[1] * LOOK_AHEAD_S;
  const aheadLength = Math.hypot(aheadX, aheadY);
  if (aheadLength > maxLookAheadM) {
    aheadX *= maxLookAheadM / aheadLength;
    aheadY *= maxLookAheadM / aheadLength;
  }
  const ease = 1 - Math.exp(-CAMERA_EASE_PER_S * dt);
  return {
    x: camera.x + (target[0] + aheadX - camera.x) * ease,
    y: camera.y + (target[1] + aheadY - camera.y) * ease,
    zoom: camera.zoom,
  };
}

/** World rectangle visible through the viewport. */
export function visibleRect(camera: Camera, viewport: Viewport): Rect {
  const halfWidth = viewport.width / camera.zoom / 2;
  const halfHeight = viewport.height / camera.zoom / 2;
  return {
    minX: camera.x - halfWidth,
    minY: camera.y - halfHeight,
    maxX: camera.x + halfWidth,
    maxY: camera.y + halfHeight,
  };
}

/** Metres → CSS pixels. */
export function worldToScreen(
  camera: Camera,
  viewport: Viewport,
  point: Point,
): [number, number] {
  return [
    viewport.width / 2 + (point[0] - camera.x) * camera.zoom,
    viewport.height / 2 + (point[1] - camera.y) * camera.zoom,
  ];
}

/** CSS pixels → metres. */
export function screenToWorld(
  camera: Camera,
  viewport: Viewport,
  point: [number, number],
): Point {
  return [
    camera.x + (point[0] - viewport.width / 2) / camera.zoom,
    camera.y + (point[1] - viewport.height / 2) / camera.zoom,
  ];
}
