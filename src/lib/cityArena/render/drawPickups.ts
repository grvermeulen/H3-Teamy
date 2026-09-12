import type { PickupState } from "../sim/types";
import {
  PICKUP_BACKDROP,
  PICKUP_BAT,
  PICKUP_HEALTH,
  PICKUP_HEALTH_CROSS,
  PICKUP_RIFLE,
  PICKUP_SHOTGUN,
  PICKUP_UZI,
} from "./palette";
import type { ItemSprites, PropSprite } from "./sprites";
import {
  visibleRect,
  worldToScreen,
  type Camera,
  type Viewport,
} from "./camera";
import type { RasterContext } from "./canvasTypes";

/** Pickup bob amplitude in metres. */
export const PICKUP_BOB_M = 0.2;
/** Pickup diamond radius in metres. */
export const PICKUP_RADIUS_M = 0.45;
/** Length an item icon is drawn at on the ground, metres: an icon, not the item's real size. */
export const PICKUP_ICON_LENGTH_M = 1;
/** Radius of the disc behind an item icon, metres. */
const PICKUP_BACKDROP_RADIUS_M = 0.6;
/** How fast an item icon turns, radians per tick; a slow display turn, not the diamond's spin. */
const ICON_TURN_PER_TICK = 0.03;
const CULL_MARGIN_M = 5;

/** Deterministic vertical bob for a pickup at a simulation tick. */
export function pickupBob(pickup: PickupState, tick: number): number {
  return Math.sin((tick + pickup.id) * 0.15) * PICKUP_BOB_M;
}

/** Colour used by a pickup diamond. */
export function pickupColour(kind: PickupState["kind"]): string {
  if (kind === "health") return PICKUP_HEALTH;
  if (kind === "rifle") return PICKUP_RIFLE;
  if (kind === "bat") return PICKUP_BAT;
  return kind === "uzi" ? PICKUP_UZI : PICKUP_SHOTGUN;
}

/** The item's art, a metre long over a dark disc, turning slowly. */
function drawItemIcon(
  context: RasterContext,
  sprite: PropSprite,
  x: number,
  y: number,
  zoom: number,
  turn: number,
): void {
  const length = PICKUP_ICON_LENGTH_M * zoom;
  const width = (length * sprite.widthMetres) / sprite.lengthMetres;
  context.save();
  context.translate(x, y);
  context.beginPath();
  context.arc(0, 0, PICKUP_BACKDROP_RADIUS_M * zoom, 0, Math.PI * 2);
  context.fillStyle = PICKUP_BACKDROP;
  context.fill();
  context.rotate(turn);
  context.drawImage(sprite.image, -length / 2, -width / 2, length, width);
  context.restore();
}

/**
 * Draws one pickup: its item's art as an icon once that has loaded, else the rotating diamond
 * it was before, with a cross for health.
 */
export function drawPickup(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  pickup: PickupState,
  tick: number,
  items?: ItemSprites,
  reducedMotion = false,
): void {
  const [x, y] = worldToScreen(camera, viewport, [
    pickup.x,
    pickup.y + (reducedMotion ? 0 : pickupBob(pickup, tick)),
  ]);
  const sprite = items?.[pickup.kind];
  if (sprite) {
    drawItemIcon(
      context,
      sprite,
      x,
      y,
      camera.zoom,
      reducedMotion ? 0 : (tick + pickup.id) * ICON_TURN_PER_TICK,
    );
    return;
  }
  const radius = Math.max(5, PICKUP_RADIUS_M * camera.zoom);
  context.save();
  context.translate(x, y);
  context.beginPath();
  context.moveTo(0, -radius);
  context.lineTo(radius, 0);
  context.lineTo(0, radius);
  context.lineTo(-radius, 0);
  context.closePath();
  context.fillStyle = pickupColour(pickup.kind);
  context.fill();
  context.strokeStyle = "#151d23";
  context.lineWidth = 1.5;
  context.stroke();
  if (pickup.kind === "health") {
    const cross = radius * 0.55;
    context.fillStyle = PICKUP_HEALTH_CROSS;
    context.fillRect(-cross / 3, -cross, (cross * 2) / 3, cross * 2);
    context.fillRect(-cross, -cross / 3, cross * 2, (cross * 2) / 3);
  } else {
    context.strokeStyle = "#17212a";
    context.lineWidth = 1.5;
    context.beginPath();
    const bars = pickup.kind === "uzi" ? 3 : 2;
    for (let bar = 0; bar < bars; bar++) {
      const offset = (bar - (bars - 1) / 2) * 2;
      context.moveTo(offset, -radius * 0.5);
      context.lineTo(offset, radius * 0.5);
    }
    context.stroke();
  }
  context.restore();
}

/** Draws untaken pickups near the camera, as item icons once the art has loaded. */
export function drawPickups(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  pickups: PickupState[],
  tick: number,
  items?: ItemSprites,
  reducedMotion = false,
): void {
  const view = visibleRect(camera, viewport);
  for (const pickup of pickups) {
    if (pickup.takenAtTick !== null) continue;
    const outside =
      pickup.x < view.minX - CULL_MARGIN_M ||
      pickup.x > view.maxX + CULL_MARGIN_M ||
      pickup.y < view.minY - CULL_MARGIN_M ||
      pickup.y > view.maxY + CULL_MARGIN_M;
    if (!outside)
      drawPickup(context, camera, viewport, pickup, tick, items, reducedMotion);
  }
}
