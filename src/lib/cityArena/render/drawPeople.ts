import { COP_MAX_HEALTH } from "../sim/cops";
import type { CopState, PedState } from "../sim/types";
import {
  COP_ACCENT,
  COP_DEAD_FILL,
  COP_FILL,
  PED_DEAD_FILL,
  PED_FILL,
  PED_RING,
  PERSON_HEALTH,
} from "./palette";
import {
  visibleRect,
  worldToScreen,
  type Camera,
  type Viewport,
} from "./camera";
import type { RasterContext } from "./canvasTypes";

/** Minimum person radius in screen pixels. */
const MIN_PERSON_RADIUS_PX = 3;
/** Living person radius in metres. */
const PERSON_RADIUS_M = 0.35;
/** Facing tick length in screen pixels. */
const FACING_TICK_PX = 3;
/** Culling margin shared with cars. */
const CULL_MARGIN_M = 5;

type Person = PedState | CopState;

function isDeadPerson(person: Person): boolean {
  return "diedAtTick" in person
    ? person.diedAtTick !== null
    : person.mode === "dead";
}

function drawHealthCue(
  context: RasterContext,
  x: number,
  y: number,
  health: number,
  maxHealth: number,
): void {
  if (health >= maxHealth) return;
  const width = 8;
  const height = 1.5;
  context.fillStyle = "rgba(0,0,0,0.6)";
  context.fillRect(x - width / 2, y - 7, width, height);
  context.fillStyle = PERSON_HEALTH;
  context.fillRect(
    x - width / 2,
    y - 7,
    width * Math.max(0, health / maxHealth),
    height,
  );
}

function drawPerson(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  person: Person,
  fill: string,
  ring: string,
  accent: string | null,
): void {
  const [x, y] = worldToScreen(camera, viewport, [person.x, person.y]);
  const radius = Math.max(MIN_PERSON_RADIUS_PX, PERSON_RADIUS_M * camera.zoom);
  const dead = isDeadPerson(person);
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2, false);
  context.fillStyle = fill;
  context.fill();
  context.strokeStyle = ring;
  context.lineWidth = dead ? 1 : 1.5;
  context.setLineDash([]);
  context.stroke();
  if (!dead) {
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(
      x + Math.cos(person.facing) * (radius + FACING_TICK_PX),
      y + Math.sin(person.facing) * (radius + FACING_TICK_PX),
    );
    context.strokeStyle = accent ?? ring;
    context.stroke();
  }
  if (accent && !dead) {
    context.fillStyle = accent;
    context.fillRect(x - 1, y - 1, 2, 2);
  }
  const maxHealth = "diedAtTick" in person ? COP_MAX_HEALTH : 40;
  drawHealthCue(context, x, y, person.health, maxHealth);
}

/** Draws a pedestrian. */
export function drawPedestrian(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  ped: PedState,
): void {
  drawPerson(
    context,
    camera,
    viewport,
    ped,
    ped.mode === "dead" ? PED_DEAD_FILL : PED_FILL,
    PED_RING,
    null,
  );
}

/** Draws a police officer with a blue badge accent. */
export function drawCop(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  cop: CopState,
): void {
  drawPerson(
    context,
    camera,
    viewport,
    cop,
    cop.diedAtTick === null ? COP_FILL : COP_DEAD_FILL,
    COP_ACCENT,
    COP_ACCENT,
  );
}

/** Draws pedestrians and cops after vehicles, culling outside the camera margin. */
export function drawPeople(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  peds: PedState[],
  cops: CopState[],
): void {
  const view = visibleRect(camera, viewport);
  const visible = (person: Person): boolean =>
    person.x >= view.minX - CULL_MARGIN_M &&
    person.x <= view.maxX + CULL_MARGIN_M &&
    person.y >= view.minY - CULL_MARGIN_M &&
    person.y <= view.maxY + CULL_MARGIN_M;
  for (const ped of peds)
    if (visible(ped)) drawPedestrian(context, camera, viewport, ped);
  for (const cop of cops)
    if (visible(cop)) drawCop(context, camera, viewport, cop);
}
