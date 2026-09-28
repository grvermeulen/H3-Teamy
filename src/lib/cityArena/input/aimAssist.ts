/**
 * Light aim assist for the touch look pad (aim round §6): while the crosshair is within about 2°
 * of a living target, the look slows to {@link ASSIST_FRICTION} of its speed so a drag settles on
 * the target instead of sliding past — no auto-rotate, no auto-fire. Pure: the camera and the
 * targets in, a look-speed factor out. The mouse is never assisted.
 */
import type { ArenaState } from "../sim/types";
import { angleDelta } from "./cameraYaw";

/** How far past a target's edge the crosshair still counts as on it, radians (2°). */
export const ASSIST_CONE_RAD = (2 * Math.PI) / 180;
/** The share of the look speed left while the crosshair is on a target. */
export const ASSIST_FRICTION = 0.45;
/** Targets farther away than this are never assisted, metres. */
export const ASSIST_RANGE_M = 60;
/**
 * The 3D view's eye height and a character's chest height, metres — `EYE_HEIGHT_M` and
 * `PERSON_CHEST_HEIGHT_M` in `render3d/coords.ts`, which `input/` may not import.
 */
export const ASSIST_EYE_HEIGHT_M = 1.65;
export const ASSIST_TARGET_HEIGHT_M = 1.3;
/** Half a character's width, metres: a close target covers more of the view. */
const TARGET_HALF_WIDTH_M = 0.4;
/** Half a character's height around the chest, metres. */
const TARGET_HALF_HEIGHT_M = 0.9;

/** Where the crosshair looks from and along: world metres, the camera's yaw and pitch. */
export type AssistCamera = {
  x: number;
  y: number;
  height: number;
  yaw: number;
  pitch: number;
};

/** A target's centre: world metres, and the height of its chest. */
export type AssistTarget = { x: number; y: number; height: number };

/**
 * True when the look runs within {@link ASSIST_CONE_RAD} of the target's body — its half width
 * across and half height up and down, as seen from the camera — and the target is in range.
 */
function onTarget(camera: AssistCamera, target: AssistTarget): boolean {
  const dx = target.x - camera.x;
  const dy = target.y - camera.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0 || distance > ASSIST_RANGE_M) return false;
  const across =
    Math.abs(angleDelta(camera.yaw, Math.atan2(dy, dx))) -
    Math.atan(TARGET_HALF_WIDTH_M / distance);
  if (across > ASSIST_CONE_RAD) return false;
  const elevation = Math.atan2(target.height - camera.height, distance);
  const upDown =
    Math.abs(camera.pitch - elevation) -
    Math.atan(TARGET_HALF_HEIGHT_M / distance);
  return upDown <= ASSIST_CONE_RAD;
}

/**
 * The factor for this frame's touch look: {@link ASSIST_FRICTION} while the crosshair is on any
 * of the targets, else 1.
 *
 * @param camera - Where the look starts and where it points.
 * @param targets - The living targets ({@link assistTargets}).
 * @returns The look-speed factor.
 */
export function assistScale(
  camera: AssistCamera,
  targets: readonly AssistTarget[],
): number {
  return targets.some((target) => onTarget(camera, target))
    ? ASSIST_FRICTION
    : 1;
}

/** Puts a character's centre at `index` of `out`, reusing the target already there. */
function placeChest(
  out: AssistTarget[],
  index: number,
  character: { x: number; y: number },
): number {
  const target = out[index] ?? { x: 0, y: 0, height: ASSIST_TARGET_HEIGHT_M };
  target.x = character.x;
  target.y = character.y;
  out[index] = target;
  return index + 1;
}

/**
 * What the assist may settle on: the living other players (in a car or not), officers and
 * pedestrians — never yourself, and no car (so never your own).
 *
 * @param state - The simulation state.
 * @param selfId - The local player's id.
 * @param out - The list to refill, its targets reused, so a frame allocates nothing.
 * @returns `out`, holding the targets' centres.
 */
export function assistTargets(
  state: Pick<ArenaState, "players" | "cops" | "peds">,
  selfId: number,
  out: AssistTarget[] = [],
): AssistTarget[] {
  let count = 0;
  for (const player of state.players)
    if (player.id !== selfId && player.health > 0 && player.diedAtTick === null)
      count = placeChest(out, count, player);
  for (const cop of state.cops)
    if (cop.health > 0 && cop.diedAtTick === null)
      count = placeChest(out, count, cop);
  for (const ped of state.peds)
    if (ped.health > 0 && ped.mode !== "dead")
      count = placeChest(out, count, ped);
  out.length = count;
  return out;
}
