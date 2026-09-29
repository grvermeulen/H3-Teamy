"use client";
/**
 * The touch look pad in the 3D frame (spec §6): its turn since the last frame goes onto the
 * camera — the yaw onto mouse-look's, the pitch as a tilt on top of it — slowed by aim assist
 * while the crosshair is on a target, and the frame's pitch includes that tilt.
 */
import {
  ASSIST_EYE_HEIGHT_M,
  assistScale,
  assistTargets,
} from "@/lib/cityArena/input/aimAssist";
import { tiltedPitch, turnTouchCamera } from "@/lib/cityArena/input/touchLook";
import type { Runtime3d } from "./frame3d";

/** The assist's targets, refilled every frame the pad turns: one list for the page's life. */
const assistScratch: ReturnType<typeof assistTargets> = [];

/**
 * Aim assist's factor for the look pad this frame. The look is measured from the player's (or
 * their car's) eye along the camera's yaw and pitch: the over-the-shoulder camera sits half a
 * metre to the side, a few degrees at close range, which the target's own width absorbs.
 */
function assistFactor(
  runtime: Runtime3d,
  from: { x: number; y: number },
): number {
  const camera = {
    x: from.x,
    y: from.y,
    height: ASSIST_EYE_HEIGHT_M,
    yaw: runtime.look.yaw(),
    pitch: lookPitch(runtime),
  };
  return assistScale(
    camera,
    assistTargets(runtime.state, runtime.netplay.playerId, assistScratch),
  );
}

/**
 * Throws away what the look pad added up, for the frames a menu, the map or a mission offer holds
 * the input: a drag kept going over the overlay must not snap the camera once it closes.
 *
 * @param runtime - The 3D runtime; nothing happens without a look pad.
 */
export function dropTouchLook(runtime: Runtime3d): void {
  runtime.touchCamera?.pad.take();
}

/**
 * Turns the 3D camera by what the look pad added up since the last frame, slowed by the sights'
 * zoom (as mouse-look is) and to aim assist's friction while the crosshair is on a living target.
 * The mouse is never assisted: only the pad's turn goes through here.
 *
 * @param runtime - The 3D runtime; mouse-look's yaw and the pad's tilt are updated.
 * @param from - Where the player (or their car) stands, or `null` when they are not in the state.
 * @returns The yaw the pad turned, radians (0 without a pad), so the car camera counts it as a
 * look like a mouse turn.
 */
export function applyTouchLook(
  runtime: Runtime3d,
  from: { x: number; y: number } | null,
): number {
  const camera = runtime.touchCamera;
  if (!camera) return 0;
  const zoom = runtime.view3d.lookZoom();
  return turnTouchCamera(
    camera,
    runtime.look,
    () => zoom * (from ? assistFactor(runtime, from) : 1),
  );
}

/**
 * The camera pitch for a 3D frame: mouse-look's, tilted by the look pad within the mode's range.
 *
 * @param runtime - The 3D runtime.
 * @returns Radians above the horizon.
 */
export function lookPitch(runtime: Runtime3d): number {
  const base = runtime.look.pitch();
  return runtime.touchCamera ? tiltedPitch(runtime.touchCamera, base) : base;
}

/**
 * True once the look pad has turned the camera since the view started: from then on the camera
 * is the player's to turn, and a lone movement stick no longer swings it toward the walk.
 *
 * @param runtime - The 3D runtime.
 * @returns Whether the pad has taken over looking.
 */
export function lookPadEngaged(runtime: Runtime3d): boolean {
  return runtime.touchCamera?.engaged ?? false;
}
