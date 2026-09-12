import { COP_MAX_HEALTH, COP_RUN_SPEED_MPS } from "../sim/cops";
import {
  PED_FLEE_SPEED_MPS,
  PED_MAX_HEALTH,
  PED_RADIUS_M,
  PED_WALK_SPEED_MPS,
  pedLookName,
} from "../sim/peds";
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
import { drawHeldItem, drawPersonStrip, walkFrameAt } from "./drawPersonSprite";
import {
  itemSpriteFor,
  personSpriteFor,
  type ItemSprites,
  type PersonSprite,
  type PersonSprites,
  type PropSprite,
} from "./sprites";

/** Minimum person radius in screen pixels. */
const MIN_PERSON_RADIUS_PX = 3;
/** Facing tick length in screen pixels. */
const FACING_TICK_PX = 3;
/** Culling margin shared with cars. */
const CULL_MARGIN_M = 5;
/** The sprite manifest key of the officers' strip. */
export const COP_LOOK = "cop";

type Person = PedState | CopState;

function isDeadPerson(person: Person): boolean {
  return "diedAtTick" in person
    ? person.diedAtTick !== null
    : person.mode === "dead";
}

/** How fast a person is moving, for the walk cycle: the simulation keeps no speed for them. */
function personSpeed(person: Person): number {
  if (isDeadPerson(person)) return 0;
  if ("diedAtTick" in person) return COP_RUN_SPEED_MPS;
  return person.mode === "flee" ? PED_FLEE_SPEED_MPS : PED_WALK_SPEED_MPS;
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

/** What one person is drawn with: the flat fills, the strip once its art has loaded, and what they hold. */
type PersonStyle = {
  fill: string;
  ring: string;
  accent: string | null;
  sprite?: PersonSprite;
  held?: PropSprite;
};

/**
 * One person: the colour circle with its ring (kept under the art so they stay findable when
 * zoomed out), then either the strip turned to their facing or, without art, a facing tick. A
 * body keeps the flat dead marker — the art is of someone standing up.
 */
function drawPerson(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  person: Person,
  style: PersonStyle,
  tick: number,
): void {
  const [x, y] = worldToScreen(camera, viewport, [person.x, person.y]);
  const radius = Math.max(MIN_PERSON_RADIUS_PX, PED_RADIUS_M * camera.zoom);
  const dead = isDeadPerson(person);
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2, false);
  context.fillStyle = style.fill;
  context.fill();
  context.strokeStyle = style.ring;
  context.lineWidth = dead ? 1 : 1.5;
  context.setLineDash([]);
  context.stroke();
  if (!dead && style.sprite) {
    const frame = walkFrameAt(personSpeed(person), tick, style.sprite.frames);
    drawPersonStrip(context, style.sprite, x, y, radius, person.facing, frame);
    if (style.held)
      drawHeldItem(context, style.held, x, y, radius, person.facing);
  } else if (!dead) {
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(
      x + Math.cos(person.facing) * (radius + FACING_TICK_PX),
      y + Math.sin(person.facing) * (radius + FACING_TICK_PX),
    );
    context.strokeStyle = style.accent ?? style.ring;
    context.stroke();
    if (style.accent) {
      context.fillStyle = style.accent;
      context.fillRect(x - 1, y - 1, 2, 2);
    }
  }
  const maxHealth = "diedAtTick" in person ? COP_MAX_HEALTH : PED_MAX_HEALTH;
  drawHealthCue(context, x, y, person.health, maxHealth);
}

/** Draws a pedestrian in the look its id gives it. */
export function drawPedestrian(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  ped: PedState,
  people?: PersonSprites,
  tick = 0,
): void {
  drawPerson(
    context,
    camera,
    viewport,
    ped,
    {
      fill: ped.mode === "dead" ? PED_DEAD_FILL : PED_FILL,
      ring: PED_RING,
      accent: null,
      sprite: personSpriteFor(people, pedLookName(ped.id)),
    },
    tick,
  );
}

/** Draws a police officer: in uniform with their weapon once the art has loaded, a blue badge accent before. */
export function drawCop(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  cop: CopState,
  people?: PersonSprites,
  tick = 0,
  items?: ItemSprites,
): void {
  drawPerson(
    context,
    camera,
    viewport,
    cop,
    {
      fill: cop.diedAtTick === null ? COP_FILL : COP_DEAD_FILL,
      ring: COP_ACCENT,
      accent: COP_ACCENT,
      sprite: personSpriteFor(people, COP_LOOK),
      held: itemSpriteFor(items, cop.weapon),
    },
    tick,
  );
}

/** Draws pedestrians and cops after vehicles, culling outside the camera margin. */
export function drawPeople(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  peds: PedState[],
  cops: CopState[],
  people?: PersonSprites,
  tick = 0,
  items?: ItemSprites,
): void {
  const view = visibleRect(camera, viewport);
  const visible = (person: Person): boolean =>
    person.x >= view.minX - CULL_MARGIN_M &&
    person.x <= view.maxX + CULL_MARGIN_M &&
    person.y >= view.minY - CULL_MARGIN_M &&
    person.y <= view.maxY + CULL_MARGIN_M;
  for (const ped of peds)
    if (visible(ped))
      drawPedestrian(context, camera, viewport, ped, people, tick);
  for (const cop of cops)
    if (visible(cop))
      drawCop(context, camera, viewport, cop, people, tick, items);
}
