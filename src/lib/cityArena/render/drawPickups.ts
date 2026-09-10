import type { PickupState } from "../sim/types";
import {
  PICKUP_BAT,
  PICKUP_HEALTH,
  PICKUP_HEALTH_CROSS,
  PICKUP_RIFLE,
  PICKUP_SHOTGUN,
  PICKUP_UZI,
} from "./palette";
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

/** Draws one rotating pickup diamond, with a cross for health. */
export function drawPickup(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  pickup: PickupState,
  tick: number,
): void {
  const [x, y] = worldToScreen(camera, viewport, [
    pickup.x,
    pickup.y + pickupBob(pickup, tick),
  ]);
  const radius = PICKUP_RADIUS_M * camera.zoom;
  context.save();
  context.translate(x, y);
  context.rotate((tick + pickup.id) * 0.08);
  context.beginPath();
  context.moveTo(0, -radius);
  context.lineTo(radius, 0);
  context.lineTo(0, radius);
  context.lineTo(-radius, 0);
  context.closePath();
  context.fillStyle = pickupColour(pickup.kind);
  context.fill();
  if (pickup.kind === "health") {
    const cross = radius * 0.55;
    context.fillStyle = PICKUP_HEALTH_CROSS;
    context.fillRect(-cross / 3, -cross, (cross * 2) / 3, cross * 2);
    context.fillRect(-cross, -cross / 3, cross * 2, (cross * 2) / 3);
  }
  context.restore();
}

/** Draws untaken pickups near the camera. */
export function drawPickups(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  pickups: PickupState[],
  tick: number,
): void {
  const view = visibleRect(camera, viewport);
  for (const pickup of pickups) {
    if (pickup.takenAtTick !== null) continue;
    const outside =
      pickup.x < view.minX - CULL_MARGIN_M ||
      pickup.x > view.maxX + CULL_MARGIN_M ||
      pickup.y < view.minY - CULL_MARGIN_M ||
      pickup.y > view.maxY + CULL_MARGIN_M;
    if (!outside) drawPickup(context, camera, viewport, pickup, tick);
  }
}
