import { PLAYER_RADIUS_M } from "../sim/player";
import type { PlayerState } from "../sim/types";
import type { MapZone } from "../world/mapTypes";
import { zoneCentreMetres, zoneRadiusMetres } from "../world/zone";
import { worldToScreen, type Camera, type Viewport } from "./camera";
import type { RasterContext } from "./canvasTypes";
import { PLAYER_FILL, PLAYER_RING, ZONE_RING } from "./palette";

/** Smallest on-screen player radius, in pixels — keeps the sprite visible when zoomed out. */
const MIN_PLAYER_RADIUS_PX = 6;
/** Player outline ring width, in screen pixels. */
const PLAYER_RING_WIDTH_PX = 2;
/** Length of the facing tick past the player's radius, in screen pixels. */
const FACING_TICK_PX = 4;
/** Zone boundary ring stroke width, in screen pixels. */
const ZONE_RING_WIDTH_PX = 2;
/** Zone boundary ring dash pattern (dash length, gap length), in screen pixels. */
const ZONE_RING_DASH_PX: number[] = [8, 6];

/** Draws the local player: a filled circle, a coloured outline ring and a facing tick. */
export function drawPlayer(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  player: PlayerState,
): void {
  const [x, y] = worldToScreen(camera, viewport, [player.x, player.y]);
  const radius = Math.max(MIN_PLAYER_RADIUS_PX, PLAYER_RADIUS_M * camera.zoom);
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2, false);
  context.fillStyle = PLAYER_FILL;
  context.fill();
  context.strokeStyle = PLAYER_RING;
  context.lineWidth = PLAYER_RING_WIDTH_PX;
  context.setLineDash([]);
  context.stroke();
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(
    x + Math.cos(player.facing) * (radius + FACING_TICK_PX),
    y + Math.sin(player.facing) * (radius + FACING_TICK_PX),
  );
  context.stroke();
}

/** Draws the dashed boundary ring of a match zone. */
export function drawZoneRing(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  zone: MapZone,
): void {
  const [x, y] = worldToScreen(camera, viewport, zoneCentreMetres(zone));
  const radiusPx = zoneRadiusMetres(zone) * camera.zoom;
  context.beginPath();
  context.arc(x, y, radiusPx, 0, Math.PI * 2, false);
  context.strokeStyle = ZONE_RING;
  context.lineWidth = ZONE_RING_WIDTH_PX;
  context.setLineDash(ZONE_RING_DASH_PX);
  context.stroke();
  context.setLineDash([]);
}
