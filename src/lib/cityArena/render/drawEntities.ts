import { isDead, isInvulnerable } from "../sim/damage";
import { PLAYER_RADIUS_M } from "../sim/player";
import type { ArenaPlayerState, PlayerState } from "../sim/types";
import type { MapZone } from "../world/mapTypes";
import { zoneCentreMetres, zoneRadiusMetres } from "../world/zone";
import { worldToScreen, type Camera, type Viewport } from "./camera";
import type { RasterContext } from "./canvasTypes";
import type { PersonSprite } from "./sprites";
import {
  PLAYER_DEAD_FILL,
  PLAYER_DEAD_RING,
  PLAYER_FILL,
  PLAYER_OTHER_FILL,
  PLAYER_OTHER_RING,
  PLAYER_RING,
  ZONE_RING,
} from "./palette";

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

/** Colours of the player sprite. */
export type PlayerStyle = { fill: string; ring: string };
/** The living player. */
export const DEFAULT_PLAYER_STYLE: PlayerStyle = {
  fill: PLAYER_FILL,
  ring: PLAYER_RING,
};
/** Somebody else in the same match. */
export const OTHER_PLAYER_STYLE: PlayerStyle = {
  fill: PLAYER_OTHER_FILL,
  ring: PLAYER_OTHER_RING,
};
/** A body waiting to respawn. */
export const DEAD_PLAYER_STYLE: PlayerStyle = {
  fill: PLAYER_DEAD_FILL,
  ring: PLAYER_DEAD_RING,
};
/** How the player is drawn this frame. */
export type PlayerLook = "normal" | "dead" | "hidden" | "blink";
/** Ticks per half-period of the invulnerability blink. */
const BLINK_HALF_PERIOD_TICKS = 4;

/** Hidden inside a car, a body while dead, invisible every other 4 ticks while shielded, else normal. */
export function playerLook(player: ArenaPlayerState, tick: number): PlayerLook {
  if (player.vehicleId !== null) return "hidden";
  if (isDead(player)) return "dead";
  const blinkPhase = Math.floor(tick / BLINK_HALF_PERIOD_TICKS) % 2;
  if (isInvulnerable(player, tick) && blinkPhase === 1) return "blink";
  return "normal";
}

/**
 * The character art faces *down* its own image: the generator drew him head at the top and feet
 * at the bottom, so his toes point at the bottom edge — the opposite of the nose-up car sprite.
 * With `facing` 0 pointing along +x, that makes the turn a negative quarter, not a positive one;
 * the positive version had him looking exactly half a turn away from the crosshair.
 */
const PLAYER_SPRITE_TURN_RAD = -Math.PI / 2;
/**
 * How far the character art overhangs the collision circle. A standing man's arms and shoulders
 * reach past his 0.4 m hull anyway, and the hull alone lands on the 6 px floor at every zoom the
 * arena offers — 12 px is too small to recognise anyone in.
 */
const PLAYER_SPRITE_SCALE = 1.6;

/** Ticks each walk frame is held. At 30 Hz that is 7.5 frames a second, a stride you can read. */
const WALK_FRAME_TICKS = 4;
/** Below this speed (m/s) the player is standing, so the strip rests on its first frame. */
const WALK_ANIMATION_MIN_SPEED_MPS = 0.2;

/**
 * The strip cell to draw this tick. The cycle runs off the tick rather than off distance
 * walked, which the simulation does not track: at one walk speed the two agree closely enough,
 * and a standing player always rests on frame 0 so he never moon-walks on the spot.
 */
export function walkFrame(
  player: PlayerState,
  tick: number,
  frames: number,
): number {
  if (frames <= 1 || player.speed < WALK_ANIMATION_MIN_SPEED_MPS) return 0;
  return Math.floor(tick / WALK_FRAME_TICKS) % frames;
}

/** Draws the character art over the player's collision circle, turned to face where they face. */
function drawPlayerSprite(
  context: RasterContext,
  sprite: PersonSprite,
  x: number,
  y: number,
  radius: number,
  player: PlayerState,
  tick: number,
): void {
  const half = radius * PLAYER_SPRITE_SCALE;
  const frame = walkFrame(player, tick, sprite.frames);
  context.save();
  context.translate(x, y);
  context.rotate(player.facing + PLAYER_SPRITE_TURN_RAD);
  context.drawImage(
    sprite.image,
    frame * sprite.pixelSize,
    0,
    sprite.pixelSize,
    sprite.pixelSize,
    -half,
    -half,
    half * 2,
    half * 2,
  );
  context.restore();
}

/**
 * Draws the local player: a filled circle and a coloured outline ring in the given style, with
 * the character sprite over it once the art has loaded. Without the sprite the circle carries a
 * facing tick instead, which is what the player read before the art existed.
 */
export function drawPlayer(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  player: PlayerState,
  style: PlayerStyle = DEFAULT_PLAYER_STYLE,
  sprite?: PersonSprite,
  tick = 0,
): void {
  const [x, y] = worldToScreen(camera, viewport, [player.x, player.y]);
  const radius = Math.max(MIN_PLAYER_RADIUS_PX, PLAYER_RADIUS_M * camera.zoom);
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2, false);
  context.fillStyle = style.fill;
  context.fill();
  context.strokeStyle = style.ring;
  context.lineWidth = PLAYER_RING_WIDTH_PX;
  context.setLineDash([]);
  context.stroke();
  if (sprite) {
    drawPlayerSprite(context, sprite, x, y, radius, player, tick);
    return;
  }
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
