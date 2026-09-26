/**
 * The 3D view's HUD layer: what gets drawn on the transparent 2D canvas stacked over the WebGL
 * one (spec §6.2) — the crosshair, placed honestly on the flat simulation's shot line, and arrows
 * at the screen's edge toward friends out of view.
 */
import { Vector3, type PerspectiveCamera } from "three";
import type { RasterContext } from "../render/canvasTypes";
import { drawCrosshair } from "../render/drawProjectiles";
import type { Scene } from "../render/renderScene";
import { AIM_PROJECT_DISTANCE_M, PERSON_CHEST_HEIGHT_M } from "./coords";
import { drawPlayerArrows } from "./playerArrows";

export { AIM_PROJECT_DISTANCE_M } from "./coords";

/** Normalised device depth beyond which a projected point lies behind the camera or the far plane. */
const NDC_DEPTH_LIMIT = 1;
/** The crosshair stays at least this far inside the screen's edges, CSS pixels. */
export const CROSSHAIR_EDGE_MARGIN_PX = 24;

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

/**
 * Keeps a screen point at least {@link CROSSHAIR_EDGE_MARGIN_PX} inside the screen, so the reticle
 * stays in view when the shot line leaves it (looking far down or up).
 *
 * @param point - A CSS-pixel point.
 * @param size - The canvas's CSS size.
 * @returns The point, clamped.
 */
export function clampToScreen(
  point: [number, number],
  size: { width: number; height: number },
): [number, number] {
  const clampAxis = (value: number, extent: number): number =>
    Math.min(
      Math.max(value, CROSSHAIR_EDGE_MARGIN_PX),
      Math.max(CROSSHAIR_EDGE_MARGIN_PX, extent - CROSSHAIR_EDGE_MARGIN_PX),
    );
  return [clampAxis(point[0], size.width), clampAxis(point[1], size.height)];
}

/** What {@link drawOverlay3d} needs besides the camera. */
export type Overlay3dInput = {
  /** The local player, world metres. */
  origin: { x: number; y: number };
  /** The heading the simulation shoots along this frame, radians. */
  aim: number;
  /** The canvas's CSS size. */
  size: { width: number; height: number };
  /** No crosshair (and no arrows) over a body. */
  dead: boolean;
  /** The players, for arrows toward friends out of view; none are drawn without them. */
  friends?: Pick<Scene, "players" | "localPlayerId">;
};

/**
 * Draws the 3D view's HUD on the 2D canvas, in CSS pixels: the 2D game's crosshair, placed by
 * {@link crosshairScreen} and kept on screen by {@link clampToScreen}, and an arrow at the edge
 * toward each friend out of view.
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
  const point = crosshairScreen(camera, input.origin, input.aim, input.size);
  if (point) drawCrosshair(context, clampToScreen(point, input.size));
  drawPlayerArrows(context, camera, input);
}
