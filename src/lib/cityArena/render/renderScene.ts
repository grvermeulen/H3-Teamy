import type { PlayerState } from "../sim/types";
import type { MapZone } from "../world/mapTypes";
import type { Camera } from "./camera";
import type { RasterContext } from "./canvasTypes";
import { drawPlayer, drawZoneRing } from "./drawEntities";
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

/** Everything drawn for one viewport: the world, the local player and the active zone ring, if any. */
export type Scene = {
  world: WorldDrawSource;
  player: PlayerState;
  zone: MapZone | null;
};

/**
 * Renders one viewport: clips to its rect, translates into its local space, draws the world
 * chunks, the zone ring (when present) and the player on top, then restores the context.
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
  const stats = drawVisibleChunks(context, camera, size, scene.world);
  if (scene.zone) drawZoneRing(context, camera, size, scene.zone);
  drawPlayer(context, camera, size, scene.player);
  context.restore();
  return stats;
}
