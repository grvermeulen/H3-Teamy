import type { VehicleState } from "../sim/types";
import { lengthOf, smokeHealthOf, widthOf } from "../sim/vehicle";
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
  POLICE_LIGHT_BLUE,
  POLICE_LIGHT_RED,
  PLAYER_RING,
} from "./palette";
import { hasOwnVehicleArt, vehicleSpriteFor, type VehicleArt } from "./sprites";

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
/** Tick offset between the three smoke puffs so they drift out of phase. */
const SMOKE_PUFF_STAGGER_TICKS = 7;
/** Cars within this margin outside the view are still drawn, metres. */
const CULL_MARGIN_M = 5;
/** Police light bar size along the body, metres. */
const LIGHT_BAR_LENGTH_M = 0.7;
/** Police light bar size across the body, metres. */
const LIGHT_BAR_WIDTH_M = 0.25;
/** Offset of each light bar from the centre line, metres. */
const LIGHT_BAR_SIDE_M = 0.25;
/** Distance from the nose back to the light bar's centre, metres. */
const LIGHT_BAR_INSET_M = 0.35;
/** Ticks each colour of the light bar stays lit before the pair swaps. */
export const LIGHT_BAR_FLASH_TICKS = 6;
/** Radius of the glow each light throws while the lights are on, metres. */
const LIGHT_GLOW_RADIUS_M = 0.45;
/** Opacity of that glow, so the bar underneath still shows through it. */
const LIGHT_GLOW_ALPHA = 0.85;
/**
 * Quarter turn that maps the sprite art, drawn nose-up, onto the car frame's forward +X axis.
 * `drawVehicle` has already rotated the context by the car's heading when this is applied.
 */
const SPRITE_NOSE_UP_TURN_RAD = Math.PI / 2;

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

/** Body, window and headlights of an intact car, drawn as flat rectangles. */
function drawVectorBody(
  context: RasterContext,
  vehicle: VehicleState,
  zoom: number,
): void {
  const length = lengthOf(vehicle.kind);
  const width = widthOf(vehicle.kind);
  fillLocalRect(
    context,
    zoom,
    0,
    0,
    length,
    width,
    CAR_BODY_COLOURS[vehicle.colour % CAR_BODY_COLOURS.length],
  );
  fillLocalRect(
    context,
    zoom,
    WINDOW_OFFSET_M,
    0,
    vehicle.kind === "sport" ? 1 : WINDOW_LENGTH_M,
    WINDOW_WIDTH_M,
    CAR_WINDOW,
  );
  if (vehicle.kind === "sport")
    fillLocalRect(context, zoom, -1.5, 0, 0.22, 1.9, "#202833");
  if (vehicle.kind === "police")
    fillLocalRect(context, zoom, 0, 0, 0.9, 1.7, "#e8e4d8");
  const front = length / 2 - HEADLIGHT_SIZE_M / 2;
  const side = width / 2 - HEADLIGHT_SIZE_M / 2;
  for (const offset of [-side, side])
    fillLocalRect(
      context,
      zoom,
      front,
      offset,
      HEADLIGHT_SIZE_M,
      HEADLIGHT_SIZE_M,
      CAR_HEADLIGHT,
    );
}

/** The car sprite stretched over the kind's metre box, so art and collision hull agree. */
function drawSpriteBody(
  context: RasterContext,
  vehicle: VehicleState,
  sprite: CanvasImageSource,
  zoom: number,
): void {
  const length = lengthOf(vehicle.kind);
  const width = widthOf(vehicle.kind);
  context.save();
  context.rotate(SPRITE_NOSE_UP_TURN_RAD);
  context.drawImage(
    sprite,
    (-width / 2) * zoom,
    (-length / 2) * zoom,
    width * zoom,
    length * zoom,
  );
  context.restore();
}

/** Whether the left light shows blue this tick; the pair swaps every few ticks while lit. */
function leftIsBlue(tick: number, lit: boolean): boolean {
  return !lit || Math.floor(tick / LIGHT_BAR_FLASH_TICKS) % 2 === 0;
}

/**
 * The pair of light bars on a police car's roof, for a body without a painted bar. The colours
 * swap every few ticks while the lights are on and hold still while they are off.
 */
function drawLightBar(
  context: RasterContext,
  vehicle: VehicleState,
  zoom: number,
  tick: number,
  lit: boolean,
): void {
  const blue = leftIsBlue(tick, lit);
  const forward = lengthOf(vehicle.kind) / 2 - LIGHT_BAR_INSET_M;
  fillLocalRect(
    context,
    zoom,
    forward,
    -LIGHT_BAR_SIDE_M,
    LIGHT_BAR_LENGTH_M,
    LIGHT_BAR_WIDTH_M,
    blue ? POLICE_LIGHT_BLUE : POLICE_LIGHT_RED,
  );
  fillLocalRect(
    context,
    zoom,
    forward,
    LIGHT_BAR_SIDE_M,
    LIGHT_BAR_LENGTH_M,
    LIGHT_BAR_WIDTH_M,
    blue ? POLICE_LIGHT_RED : POLICE_LIGHT_BLUE,
  );
}

/** The glow the lights throw while they are on: a disc over each light, swapping with the bar. */
function drawLightGlow(
  context: RasterContext,
  vehicle: VehicleState,
  zoom: number,
  tick: number,
): void {
  const blue = leftIsBlue(tick, true);
  const forward = lengthOf(vehicle.kind) / 2 - LIGHT_BAR_INSET_M;
  const lights: [number, string][] = [
    [-LIGHT_BAR_SIDE_M, blue ? POLICE_LIGHT_BLUE : POLICE_LIGHT_RED],
    [LIGHT_BAR_SIDE_M, blue ? POLICE_LIGHT_RED : POLICE_LIGHT_BLUE],
  ];
  context.save();
  context.globalAlpha = LIGHT_GLOW_ALPHA;
  for (const [side, colour] of lights) {
    context.beginPath();
    context.arc(
      forward * zoom,
      side * zoom,
      LIGHT_GLOW_RADIUS_M * zoom,
      0,
      Math.PI * 2,
    );
    context.fillStyle = colour;
    context.fill();
  }
  context.restore();
}

/**
 * One car's body: the sprite when its art has loaded, else the vector body it was drawn as
 * before. A wreck stays a dark slab either way — the sprites are intact cars. A police car gets
 * the vector light bar only while it borrows the sedan's art or has none (its own sprite carries
 * the bar), and either way its lights glow and flash only while the police are driving it.
 */
function drawBody(
  context: RasterContext,
  vehicle: VehicleState,
  zoom: number,
  tick: number,
  sprite: CanvasImageSource | undefined,
  ownArt: boolean,
  lit: boolean,
): void {
  if (vehicle.wrecked) {
    fillLocalRect(
      context,
      zoom,
      0,
      0,
      lengthOf(vehicle.kind),
      widthOf(vehicle.kind),
      CAR_WRECK,
    );
    return;
  }
  if (sprite) drawSpriteBody(context, vehicle, sprite, zoom);
  else drawVectorBody(context, vehicle, zoom);
  if (vehicle.kind !== "police") return;
  if (!ownArt) drawLightBar(context, vehicle, zoom, tick, lit);
  if (lit) drawLightGlow(context, vehicle, zoom, tick);
}

/** Grey puffs trailing behind a damaged car, drifting with the tick. */
function drawSmoke(
  context: RasterContext,
  vehicle: VehicleState,
  zoom: number,
  tick: number,
): void {
  context.fillStyle = CAR_SMOKE;
  const tail = -lengthOf(vehicle.kind) / 2;
  for (let puff = 0; puff < SMOKE_PUFFS; puff++) {
    const drift =
      ((tick + puff * SMOKE_PUFF_STAGGER_TICKS) % SMOKE_DRIFT_TICKS) /
      SMOKE_DRIFT_TICKS;
    const forward = tail - (puff + drift) * SMOKE_SPACING_M;
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
function drawOccupiedRing(
  context: RasterContext,
  vehicle: VehicleState,
  zoom: number,
): void {
  const length = lengthOf(vehicle.kind);
  const width = widthOf(vehicle.kind);
  context.strokeStyle = PLAYER_RING;
  context.lineWidth = OCCUPIED_RING_WIDTH_PX;
  context.setLineDash([]);
  context.beginPath();
  context.rect(
    (-length / 2) * zoom,
    (-width / 2) * zoom,
    length * zoom,
    width * zoom,
  );
  context.stroke();
}

/**
 * Draws one car in its own frame: body, smoke when damaged, and the occupant ring. `lit` turns a
 * police car's lights on.
 */
export function drawVehicle(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  vehicle: VehicleState,
  tick: number,
  occupied: boolean,
  art?: VehicleArt,
  lit = false,
): void {
  const [x, y] = worldToScreen(camera, viewport, [vehicle.x, vehicle.y]);
  context.save();
  context.translate(x, y);
  context.rotate(vehicle.heading);
  drawBody(
    context,
    vehicle,
    camera.zoom,
    tick,
    vehicleSpriteFor(art, vehicle.kind, vehicle.colour),
    hasOwnVehicleArt(art, vehicle.kind),
    lit,
  );
  if (!vehicle.wrecked && vehicle.health < smokeHealthOf(vehicle.kind))
    drawSmoke(context, vehicle, camera.zoom, tick);
  if (occupied) drawOccupiedRing(context, vehicle, camera.zoom);
  context.restore();
}

/** Draws every car near the view; `occupiedId` gets the ring, the `litIds` their lights. */
export function drawVehicles(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  vehicles: VehicleState[],
  tick: number,
  occupiedId: number | null,
  art?: VehicleArt,
  litIds?: ReadonlySet<number>,
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
      art,
      litIds?.has(vehicle.id) ?? false,
    );
  }
}
