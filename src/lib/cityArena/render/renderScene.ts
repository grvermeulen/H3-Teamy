import type {
  ArenaPlayerState,
  BulletState,
  EffectState,
  VehicleState,
} from "../sim/types";
import type { MapZone } from "../world/mapTypes";
import type { Camera, Viewport } from "./camera";
import type { RasterContext } from "./canvasTypes";
import {
  DEAD_PLAYER_STYLE,
  DEFAULT_PLAYER_STYLE,
  drawPlayer,
  drawZoneRing,
  playerLook,
} from "./drawEntities";
import { drawBullets, drawCrosshair, drawEffects } from "./drawProjectiles";
import { drawVehicles } from "./drawVehicles";
import {
  drawVisibleChunks,
  type DrawStats,
  type WorldDrawSource,
} from "./drawWorld";

/** A rectangle of the canvas (CSS px) rendered through one camera — several of these make a split screen. */
export type SceneViewport = {
  rect: { x: number; y: number; width: number; height: number };
  camera: Camera;
};

/** Everything drawn for one viewport; `pushIn` (1 = none) zooms around the centre for the death screen. */
export type Scene = {
  world: WorldDrawSource;
  zone: MapZone | null;
  player: ArenaPlayerState;
  vehicles: VehicleState[];
  bullets: BulletState[];
  effects: EffectState[];
  tick: number;
  aimScreen: [number, number] | null;
  pushIn: number;
};

/** Scales the viewport around its centre by `pushIn`. */
function applyPushIn(
  context: RasterContext,
  size: Viewport,
  pushIn: number,
): void {
  if (pushIn === 1) return;
  context.translate(size.width / 2, size.height / 2);
  context.scale(pushIn, pushIn);
  context.translate(-size.width / 2, -size.height / 2);
}

/** Draws the player unless hidden in a car or in the off half of the shield blink. */
function drawPlayerLook(
  context: RasterContext,
  camera: Camera,
  size: Viewport,
  scene: Scene,
): void {
  const look = playerLook(scene.player, scene.tick);
  if (look === "hidden" || look === "blink") return;
  const style = look === "dead" ? DEAD_PLAYER_STYLE : DEFAULT_PLAYER_STYLE;
  drawPlayer(context, camera, size, scene.player, style);
}

/**
 * Renders one viewport: clips to its rect, translates into its local space, applies the push-in,
 * then draws world chunks → zone ring → cars → bullets → effects → player → crosshair and restores.
 */
export function renderScene(
  context: RasterContext,
  viewport: SceneViewport,
  scene: Scene,
): DrawStats {
  const { rect, camera } = viewport;
  context.save();
  context.beginPath();
  context.rect(rect.x, rect.y, rect.width, rect.height);
  context.clip();
  context.translate(rect.x, rect.y);
  const size = { width: rect.width, height: rect.height };
  applyPushIn(context, size, scene.pushIn);
  const stats = drawVisibleChunks(context, camera, size, scene.world);
  if (scene.zone) drawZoneRing(context, camera, size, scene.zone);
  drawVehicles(
    context,
    camera,
    size,
    scene.vehicles,
    scene.tick,
    scene.player.vehicleId,
  );
  drawBullets(context, camera, size, scene.bullets);
  drawEffects(context, camera, size, scene.effects, scene.tick);
  drawPlayerLook(context, camera, size, scene);
  if (scene.aimScreen) drawCrosshair(context, scene.aimScreen);
  context.restore();
  return stats;
}
