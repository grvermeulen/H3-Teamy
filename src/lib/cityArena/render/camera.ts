import type { Rect } from "../mapBuild/geometry";
import type { Point } from "../world/projection";

/**
 * Raster zoom levels in px per metre; display zoom is continuous. Extended past the spec's
 * 4/6/8 on 2026-09-06 so phones can hold a ≈ 45 m view and wide desktops stop overshooting 120 m.
 */
export const ZOOM_LEVELS = [4, 6, 8, 10, 12] as const;
/** One of {@link ZOOM_LEVELS}. */
export type ZoomLevel = (typeof ZOOM_LEVELS)[number];
/** Canvas size in CSS pixels. */
export type Viewport = { width: number; height: number };
/** Camera centre in metres plus its zoom. */
export type Camera = {
  x: number;
  y: number;
  zoom: number;
  rasterZoom?: ZoomLevel;
  motion?: { speed: number; velocity: Point; ahead: Point };
};

/** Look-ahead time in seconds: the camera leads the player by velocity × this (spec §8). */
export const LOOK_AHEAD_S = 0.4;
/** Maximum look-ahead distance in metres (spec §8). */
export const LOOK_AHEAD_MAX_M = 15;
/** Look-ahead cap while driving; the on-foot cap stays spec §8's 15 m. */
export const DRIVING_LOOK_AHEAD_MAX_M = 30;
/** Exponential easing rate per second. */
export const CAMERA_EASE_PER_S = 6;
/** Target width of the view in metres on phones. */
export const PHONE_VIEW_METRES = 45;
/** Target width of the view in metres on desktop-sized viewports. */
export const DESKTOP_VIEW_METRES = 120;
/** Viewports at least this wide count as desktop. */
export const DESKTOP_MIN_WIDTH_PX = 768;

const SPEED_ZOOM_CURVE = [
  [3, 1.12],
  [8, 1],
  [18, 0.82],
  [30, 0.68],
  [36, 0.62],
] as const;

/** Nearest zoom level so that the viewport shows ≈ 45 m (phone) or ≈ 120 m (desktop). */
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

/** Continuous framing curve, including reverse speed, without zoom threshold jumps. */
export function speedZoom(base: number, speedMps: number): number {
  const speed = Math.abs(speedMps);
  if (speed <= SPEED_ZOOM_CURVE[0][0]) return base * SPEED_ZOOM_CURVE[0][1];
  for (let index = 1; index < SPEED_ZOOM_CURVE.length; index++) {
    const [endSpeed, endScale] = SPEED_ZOOM_CURVE[index];
    const [startSpeed, startScale] = SPEED_ZOOM_CURVE[index - 1];
    if (speed > endSpeed) continue;
    const fraction = (speed - startSpeed) / (endSpeed - startSpeed);
    const smooth = fraction * fraction * (3 - 2 * fraction);
    return base * (startScale + (endScale - startScale) * smooth);
  }
  return base * 0.62;
}

/** Selects a cached raster resolution with a dead band around each midpoint. */
export function rasterZoomFor(zoom: number, previous?: ZoomLevel): ZoomLevel {
  let best: ZoomLevel = ZOOM_LEVELS[0];
  for (const level of ZOOM_LEVELS) {
    if (Math.abs(level - zoom) < Math.abs(best - zoom)) best = level;
  }
  if (
    previous !== undefined &&
    Math.abs(previous - zoom) <= Math.abs(best - zoom) + 0.4
  )
    return previous;
  return best;
}

/** A camera centred on `centre`. */
export function createCamera(centre: Point, zoom: number): Camera {
  return { x: centre[0], y: centre[1], zoom };
}

/** Smooth speed zoom and directional look-ahead, keeping display and raster scales separate. */
export function updateSpeedCamera(
  camera: Camera,
  baseZoom: number,
  target: Point,
  velocity: Point,
  dt: number,
  driving: boolean,
  viewport: Viewport,
  dynamic = true,
): Camera {
  const elapsed = Math.max(0, Math.min(dt, 0.1));
  const blend = (from: number, to: number, seconds: number): number =>
    from + (to - from) * (1 - Math.exp(-elapsed / seconds));
  const actualSpeed = Math.hypot(...velocity);
  const previous = camera.motion ?? {
    speed: actualSpeed,
    velocity,
    ahead: [0, 0],
  };
  const speed = blend(previous.speed, actualSpeed, 0.2);
  const direction: Point = [
    blend(previous.velocity[0], velocity[0], 0.2),
    blend(previous.velocity[1], velocity[1], 0.2),
  ];
  const targetZoom = dynamic
    ? speedZoom(baseZoom, speed)
    : baseZoom * (driving ? 0.82 : 1.12);
  const zoom = blend(
    camera.zoom,
    targetZoom,
    targetZoom < camera.zoom ? 0.35 : 0.75,
  );
  const distance = Math.min(
    dynamic ? (driving ? 25 : LOOK_AHEAD_MAX_M) : 2,
    (Math.min(viewport.width, viewport.height) / zoom) * 0.25,
    Math.hypot(...direction) * (driving ? 0.8 : LOOK_AHEAD_S),
  );
  const directionLength = Math.hypot(...direction);
  const ahead: Point = [
    blend(
      previous.ahead[0],
      directionLength > 0 ? (direction[0] / directionLength) * distance : 0,
      0.3,
    ),
    blend(
      previous.ahead[1],
      directionLength > 0 ? (direction[1] / directionLength) * distance : 0,
      0.3,
    ),
  ];
  return {
    x: blend(camera.x, target[0] + ahead[0], 0.18),
    y: blend(camera.y, target[1] + ahead[1], 0.18),
    zoom,
    rasterZoom: rasterZoomFor(zoom, camera.rasterZoom),
    motion: { speed, velocity: direction, ahead },
  };
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
