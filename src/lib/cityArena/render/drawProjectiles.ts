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
  ROCKET_BODY_FILL,
  ROCKET_SMOKE_FILL,
  SHELL_OUTLINE_STROKE,
} from "./palette";

/** Tracer length behind a bullet, metres. */
const TRACER_LENGTH_M = 0.8;
/** Tracer line width, screen pixels. */
const TRACER_WIDTH_PX = 2;
/** Radius of a cannon shell, metres: a shell is a dot you can see coming, not a tracer line. */
const SHELL_RADIUS_M = 0.3;
/** Outline width around the cannon shell, screen pixels: a cheap way to read as heavier metal. */
const SHELL_OUTLINE_WIDTH_PX = 1;
/** Rocket body length, metres (spec §5). */
const ROCKET_BODY_LENGTH_M = 0.9;
/** Rocket body width, metres. */
const ROCKET_BODY_WIDTH_M = 0.22;
/** Smoke puffs trailing behind a flying rocket (spec §5). */
const ROCKET_SMOKE_PUFF_COUNT = 6;
/** Distance behind the rocket's tail to the nearest puff, and the gap between puffs, metres. */
const ROCKET_SMOKE_SPACING_M = 0.5;
/** Smoke puff radius, metres. */
const ROCKET_SMOKE_RADIUS_M = 0.3;
/** Alpha of the nearest smoke puff, fading to 0 by the last one. */
const ROCKET_SMOKE_MAX_ALPHA = 0.5;
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

/** Short tracer lines trailing each bullet, except rockets, which draw their own body and trail. */
export function drawBullets(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  bullets: BulletState[],
): void {
  if (bullets.length === 0) return;
  const tracered = bullets.filter((bullet) => bullet.weapon !== "rocket");
  if (tracered.length > 0) {
    context.strokeStyle = BULLET_STROKE;
    context.lineWidth = TRACER_WIDTH_PX;
    context.setLineDash([]);
    context.beginPath();
    for (const bullet of tracered) {
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
  for (const bullet of bullets) {
    if (bullet.weapon === "cannon")
      drawShell(context, camera, viewport, bullet);
    else if (bullet.weapon === "rocket")
      drawRocket(context, camera, viewport, bullet);
  }
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

/** The tank's shell: the existing dot, ringed in a darker outline for a heavier look. */
function drawShell(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  bullet: BulletState,
): void {
  const point: Point = [bullet.x, bullet.y];
  fillCircle(context, camera, viewport, point, SHELL_RADIUS_M, BULLET_STROKE);
  const [x, y] = worldToScreen(camera, viewport, point);
  context.beginPath();
  context.arc(x, y, SHELL_RADIUS_M * camera.zoom, 0, Math.PI * 2, false);
  context.strokeStyle = SHELL_OUTLINE_STROKE;
  context.lineWidth = SHELL_OUTLINE_WIDTH_PX;
  context.setLineDash([]);
  context.stroke();
}

/** The rocket's olive body: a rectangle from its nose back along the heading. */
function drawRocketBody(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  bullet: BulletState,
): void {
  const { directionX, directionY } = bullet;
  const perpX = -directionY * (ROCKET_BODY_WIDTH_M / 2);
  const perpY = directionX * (ROCKET_BODY_WIDTH_M / 2);
  const nose: Point = [bullet.x, bullet.y];
  const tail: Point = [
    bullet.x - directionX * ROCKET_BODY_LENGTH_M,
    bullet.y - directionY * ROCKET_BODY_LENGTH_M,
  ];
  const corners: Point[] = [
    [nose[0] + perpX, nose[1] + perpY],
    [tail[0] + perpX, tail[1] + perpY],
    [tail[0] - perpX, tail[1] - perpY],
    [nose[0] - perpX, nose[1] - perpY],
  ];
  context.beginPath();
  corners.forEach(([x, y], index) => {
    const [screenX, screenY] = worldToScreen(camera, viewport, [x, y]);
    if (index === 0) context.moveTo(screenX, screenY);
    else context.lineTo(screenX, screenY);
  });
  context.closePath();
  context.fillStyle = ROCKET_BODY_FILL;
  context.fill();
}

/** Fading smoke puffs behind a flying rocket, thinning out with distance from its tail. */
function drawRocketSmoke(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  bullet: BulletState,
): void {
  for (let index = 1; index <= ROCKET_SMOKE_PUFF_COUNT; index += 1) {
    const distance = ROCKET_BODY_LENGTH_M + index * ROCKET_SMOKE_SPACING_M;
    const point: Point = [
      bullet.x - bullet.directionX * distance,
      bullet.y - bullet.directionY * distance,
    ];
    context.save();
    context.globalAlpha =
      ROCKET_SMOKE_MAX_ALPHA * (1 - (index - 1) / ROCKET_SMOKE_PUFF_COUNT);
    fillCircle(
      context,
      camera,
      viewport,
      point,
      ROCKET_SMOKE_RADIUS_M,
      ROCKET_SMOKE_FILL,
    );
    context.restore();
  }
}

/** The rocket's visible body and its fading smoke trail (spec §5), drawn in front-to-back order. */
function drawRocket(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  bullet: BulletState,
): void {
  drawRocketSmoke(context, camera, viewport, bullet);
  drawRocketBody(context, camera, viewport, bullet);
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

/**
 * Explosion disc that grows to the blast's own reach (a car's 3 m when the effect names none — a
 * rocket or shell reaches 4 m) while fading out, ringed in orange.
 */
function drawExplosion(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  effect: EffectState,
  progress: number,
): void {
  context.save();
  context.globalAlpha = 1 - progress;
  const radius = (effect.radius ?? EXPLOSION_RADIUS_M) * progress;
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
