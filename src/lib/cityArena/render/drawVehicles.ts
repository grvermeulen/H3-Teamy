import type { VehicleState } from "../sim/types";
import {
  SMOKE_HEALTH,
  VEHICLE_LENGTH_M,
  VEHICLE_WIDTH_M,
} from "../sim/vehicle";
import {
  visibleRect,
  worldToScreen,
  type Camera,
  type Viewport,
} from "./camera";
import type { RasterContext } from "./canvasTypes";
import {
  CAR_BODY_COLOURS,
  CAR_HEADLIGHT,
  CAR_SMOKE,
  CAR_WINDOW,
  CAR_WRECK,
  PLAYER_RING,
} from "./palette";

/** Window glass size along the body, metres. */
const WINDOW_LENGTH_M = 1.4;
/** Window glass size across the body, metres. */
const WINDOW_WIDTH_M = 1.4;
/** Window centre offset toward the front, metres. */
const WINDOW_OFFSET_M = 0.3;
/** Headlight square size, metres. */
const HEADLIGHT_SIZE_M = 0.3;
/** Outline width of the occupied car, screen pixels. */
const OCCUPIED_RING_WIDTH_PX = 2;
/** Smoke puffs drawn behind a damaged car. */
const SMOKE_PUFFS = 3;
/** Base radius of a smoke puff, metres. */
const SMOKE_RADIUS_M = 0.6;
/** Spacing between puffs along the trail, metres. */
const SMOKE_SPACING_M = 0.9;
/** Ticks per drift cycle of the smoke trail. */
const SMOKE_DRIFT_TICKS = 20;
/** Cars within this margin outside the view are still drawn, metres. */
const CULL_MARGIN_M = 5;

/** Fills a car-local rectangle centred at (forward, right); the context is already in the car frame. */
function fillLocalRect(
  context: RasterContext,
  zoom: number,
  forward: number,
  right: number,
  length: number,
  width: number,
  fill: string,
): void {
  context.fillStyle = fill;
  context.fillRect(
    (forward - length / 2) * zoom,
    (right - width / 2) * zoom,
    length * zoom,
    width * zoom,
  );
}

/** Body, window and headlights of an intact car, or one dark slab for a wreck. */
function drawBody(
  context: RasterContext,
  vehicle: VehicleState,
  zoom: number,
): void {
  const fill = vehicle.wrecked
    ? CAR_WRECK
    : CAR_BODY_COLOURS[vehicle.colour % CAR_BODY_COLOURS.length];
  fillLocalRect(context, zoom, 0, 0, VEHICLE_LENGTH_M, VEHICLE_WIDTH_M, fill);
  if (vehicle.wrecked) return;
  fillLocalRect(
    context,
    zoom,
    WINDOW_OFFSET_M,
    0,
    WINDOW_LENGTH_M,
    WINDOW_WIDTH_M,
    CAR_WINDOW,
  );
  const front = VEHICLE_LENGTH_M / 2 - HEADLIGHT_SIZE_M / 2;
  const side = VEHICLE_WIDTH_M / 2 - HEADLIGHT_SIZE_M / 2;
  fillLocalRect(
    context,
    zoom,
    front,
    -side,
    HEADLIGHT_SIZE_M,
    HEADLIGHT_SIZE_M,
    CAR_HEADLIGHT,
  );
  fillLocalRect(
    context,
    zoom,
    front,
    side,
    HEADLIGHT_SIZE_M,
    HEADLIGHT_SIZE_M,
    CAR_HEADLIGHT,
  );
}

/** Grey puffs trailing behind a damaged car, drifting with the tick. */
function drawSmoke(context: RasterContext, zoom: number, tick: number): void {
  context.fillStyle = CAR_SMOKE;
  for (let puff = 0; puff < SMOKE_PUFFS; puff++) {
    const drift = ((tick + puff * 7) % SMOKE_DRIFT_TICKS) / SMOKE_DRIFT_TICKS;
    const forward = -VEHICLE_LENGTH_M / 2 - (puff + drift) * SMOKE_SPACING_M;
    context.beginPath();
    context.arc(
      forward * zoom,
      0,
      SMOKE_RADIUS_M * (1 + drift) * zoom,
      0,
      Math.PI * 2,
      false,
    );
    context.fill();
  }
}

/** Outline around the car the player sits in. */
function drawOccupiedRing(context: RasterContext, zoom: number): void {
  context.strokeStyle = PLAYER_RING;
  context.lineWidth = OCCUPIED_RING_WIDTH_PX;
  context.setLineDash([]);
  context.beginPath();
  context.rect(
    (-VEHICLE_LENGTH_M / 2) * zoom,
    (-VEHICLE_WIDTH_M / 2) * zoom,
    VEHICLE_LENGTH_M * zoom,
    VEHICLE_WIDTH_M * zoom,
  );
  context.stroke();
}

/** Draws one car in its own frame: body, smoke when damaged, and the occupant ring. */
export function drawVehicle(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  vehicle: VehicleState,
  tick: number,
  occupied: boolean,
): void {
  const [x, y] = worldToScreen(camera, viewport, [vehicle.x, vehicle.y]);
  context.save();
  context.translate(x, y);
  context.rotate(vehicle.heading);
  drawBody(context, vehicle, camera.zoom);
  if (!vehicle.wrecked && vehicle.health < SMOKE_HEALTH)
    drawSmoke(context, camera.zoom, tick);
  if (occupied) drawOccupiedRing(context, camera.zoom);
  context.restore();
}

/** Draws every car near the view; `occupiedId` gets the ring. */
export function drawVehicles(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  vehicles: VehicleState[],
  tick: number,
  occupiedId: number | null,
): void {
  const view = visibleRect(camera, viewport);
  for (const vehicle of vehicles) {
    const outside =
      vehicle.x < view.minX - CULL_MARGIN_M ||
      vehicle.x > view.maxX + CULL_MARGIN_M ||
      vehicle.y < view.minY - CULL_MARGIN_M ||
      vehicle.y > view.maxY + CULL_MARGIN_M;
    if (outside) continue;
    drawVehicle(
      context,
      camera,
      viewport,
      vehicle,
      tick,
      vehicle.id === occupiedId,
    );
  }
}
