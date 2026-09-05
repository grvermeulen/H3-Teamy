import { EXPLOSION_RADIUS_M } from "../sim/damage";
import { effectProgress } from "../sim/effects";
import type { BulletState, EffectState } from "../sim/types";
import type { Point } from "../world/projection";
import { worldToScreen, type Camera, type Viewport } from "./camera";
import type { RasterContext } from "./canvasTypes";
import {
  BULLET_STROKE,
  CROSSHAIR_STROKE,
  EXPLOSION_FILL,
  EXPLOSION_RING,
  IMPACT_FILL,
  MUZZLE_FILL,
} from "./palette";

/** Tracer length behind a bullet, metres. */
const TRACER_LENGTH_M = 0.8;
/** Tracer line width, screen pixels. */
const TRACER_WIDTH_PX = 2;
/** Muzzle flash offset from the shooter along the aim, metres. */
const MUZZLE_OFFSET_M = 0.6;
/** Muzzle flash radius, metres. */
const MUZZLE_RADIUS_M = 0.35;
/** Impact dot radius at birth, metres. */
const IMPACT_RADIUS_M = 0.25;
/** Explosion ring width, screen pixels. */
const EXPLOSION_RING_WIDTH_PX = 3;
/** Crosshair circle radius, screen pixels. */
const CROSSHAIR_RADIUS_PX = 8;
/** Gap between the crosshair circle and its ticks, screen pixels. */
const CROSSHAIR_GAP_PX = 3;
/** Crosshair line width, screen pixels. */
const CROSSHAIR_WIDTH_PX = 1.5;

/** Short tracer lines trailing each bullet. */
export function drawBullets(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  bullets: BulletState[],
): void {
  if (bullets.length === 0) return;
  context.strokeStyle = BULLET_STROKE;
  context.lineWidth = TRACER_WIDTH_PX;
  context.setLineDash([]);
  context.beginPath();
  for (const bullet of bullets) {
    const [x, y] = worldToScreen(camera, viewport, [bullet.x, bullet.y]);
    const [tailX, tailY] = worldToScreen(camera, viewport, [
      bullet.x - bullet.directionX * TRACER_LENGTH_M,
      bullet.y - bullet.directionY * TRACER_LENGTH_M,
    ]);
    context.moveTo(tailX, tailY);
    context.lineTo(x, y);
  }
  context.stroke();
}

/** A filled circle at a world point with a radius in metres. */
function fillCircle(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  point: Point,
  radiusM: number,
  fill: string,
): void {
  const [x, y] = worldToScreen(camera, viewport, point);
  context.beginPath();
  context.arc(x, y, radiusM * camera.zoom, 0, Math.PI * 2, false);
  context.fillStyle = fill;
  context.fill();
}

/** Muzzle flash ahead of the shooter, offset along the effect's stored aim angle. */
function drawMuzzleFlash(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  effect: EffectState,
): void {
  const flash: Point = [
    effect.x + Math.cos(effect.angle) * MUZZLE_OFFSET_M,
    effect.y + Math.sin(effect.angle) * MUZZLE_OFFSET_M,
  ];
  fillCircle(context, camera, viewport, flash, MUZZLE_RADIUS_M, MUZZLE_FILL);
}

/** Impact dot that shrinks to half its birth radius over its lifetime. */
function drawImpactDot(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  effect: EffectState,
  progress: number,
): void {
  const radius = IMPACT_RADIUS_M * (1 - progress / 2);
  fillCircle(
    context,
    camera,
    viewport,
    [effect.x, effect.y],
    radius,
    IMPACT_FILL,
  );
}

/** Explosion disc that grows to the blast radius while fading out, ringed in orange. */
function drawExplosion(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  effect: EffectState,
  progress: number,
): void {
  context.save();
  context.globalAlpha = 1 - progress;
  const radius = EXPLOSION_RADIUS_M * progress;
  fillCircle(
    context,
    camera,
    viewport,
    [effect.x, effect.y],
    radius,
    EXPLOSION_FILL,
  );
  context.strokeStyle = EXPLOSION_RING;
  context.lineWidth = EXPLOSION_RING_WIDTH_PX;
  context.setLineDash([]);
  context.stroke();
  context.restore();
}

/** Muzzle flash ahead of the shooter, a shrinking impact dot, or an expanding, fading explosion. */
function drawEffect(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  effect: EffectState,
  tick: number,
): void {
  const progress = effectProgress(effect, tick);
  if (effect.kind === "muzzle") {
    drawMuzzleFlash(context, camera, viewport, effect);
    return;
  }
  if (effect.kind === "impact") {
    drawImpactDot(context, camera, viewport, effect, progress);
    return;
  }
  drawExplosion(context, camera, viewport, effect, progress);
}

/** Draws every live effect. */
export function drawEffects(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  effects: EffectState[],
  tick: number,
): void {
  for (const effect of effects)
    drawEffect(context, camera, viewport, effect, tick);
}

/** Mouse crosshair at a screen point: a circle with four ticks. */
export function drawCrosshair(
  context: RasterContext,
  point: [number, number],
): void {
  const [x, y] = point;
  const outer = CROSSHAIR_RADIUS_PX + CROSSHAIR_GAP_PX;
  context.strokeStyle = CROSSHAIR_STROKE;
  context.lineWidth = CROSSHAIR_WIDTH_PX;
  context.setLineDash([]);
  context.beginPath();
  context.arc(x, y, CROSSHAIR_RADIUS_PX, 0, Math.PI * 2, false);
  context.moveTo(x - outer, y);
  context.lineTo(x - CROSSHAIR_GAP_PX, y);
  context.moveTo(x + CROSSHAIR_GAP_PX, y);
  context.lineTo(x + outer, y);
  context.moveTo(x, y - outer);
  context.lineTo(x, y - CROSSHAIR_GAP_PX);
  context.moveTo(x, y + CROSSHAIR_GAP_PX);
  context.lineTo(x, y + outer);
  context.stroke();
}
