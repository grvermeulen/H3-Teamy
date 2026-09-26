/**
 * The 3D view's HUD layer: what gets drawn on the transparent 2D canvas stacked over the WebGL
 * one (spec §6.2) — for now the crosshair, placed honestly on the flat simulation's shot line.
 */
import { Vector3, type PerspectiveCamera } from "three";
import type { RasterContext } from "../render/canvasTypes";
import { drawCrosshair } from "../render/drawProjectiles";
import { PERSON_CHEST_HEIGHT_M } from "./coords";

/** The crosshair marks where the in-plane shot line is this many metres ahead (spec §6.3). */
export const AIM_PROJECT_DISTANCE_M = 25;

/** Normalised device depth beyond which a projected point lies behind the camera or the far plane. */
const NDC_DEPTH_LIMIT = 1;

/** Reused for every projection, so the per-frame overlay allocates no vectors. */
const scratch = new Vector3();

/**
 * Where the flat simulation's shot line crosses {@link AIM_PROJECT_DISTANCE_M} ahead, at chest
 * height, on screen. Bullets fly level (spec §2), so when the player looks up or down this point
 * moves off the centre — the reticle tells the truth instead of pretending the shot follows the
 * view.
 *
 * @param camera - The placed camera; its world matrix is refreshed here.
 * @param origin - The shooter, world metres.
 * @param yaw - The aim heading, radians.
 * @param size - The canvas's CSS size.
 * @returns The CSS-pixel point, or `null` when it lies behind the camera.
 */
export function crosshairScreen(
  camera: PerspectiveCamera,
  origin: { x: number; y: number },
  yaw: number,
  size: { width: number; height: number },
): [number, number] | null {
  camera.updateMatrixWorld();
  scratch
    .set(
      origin.x + Math.cos(yaw) * AIM_PROJECT_DISTANCE_M,
      PERSON_CHEST_HEIGHT_M,
      origin.y + Math.sin(yaw) * AIM_PROJECT_DISTANCE_M,
    )
    .project(camera);
  if (Math.abs(scratch.z) > NDC_DEPTH_LIMIT) return null;
  return [
    ((scratch.x + 1) / 2) * size.width,
    ((1 - scratch.y) / 2) * size.height,
  ];
}

/** What {@link drawOverlay3d} needs besides the camera. */
export type Overlay3dInput = {
  /** The local player, world metres. */
  origin: { x: number; y: number };
  /** The aim heading, radians. */
  yaw: number;
  /** The canvas's CSS size. */
  size: { width: number; height: number };
  /** No crosshair over a body. */
  dead: boolean;
};

/**
 * Draws the 3D view's HUD on the 2D canvas, in CSS pixels: the 2D game's crosshair, placed by
 * {@link crosshairScreen}.
 *
 * @param context - The cleared 2D context, transformed to CSS pixels.
 * @param camera - The camera the frame was rendered with.
 * @param input - The shooter, aim, canvas size and whether the player is dead.
 */
export function drawOverlay3d(
  context: RasterContext,
  camera: PerspectiveCamera,
  input: Overlay3dInput,
): void {
  if (input.dead) return;
  const point = crosshairScreen(camera, input.origin, input.yaw, input.size);
  if (point) drawCrosshair(context, point);
}
