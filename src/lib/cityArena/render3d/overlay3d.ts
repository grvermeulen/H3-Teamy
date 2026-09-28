/**
 * The 3D view's HUD layer: what gets drawn on the transparent 2D canvas stacked over the WebGL
 * one (spec §6.2) — the crosshair, always at the screen's centre where the aim probe looks (aim
 * spec §5), and arrows at the screen's edge toward friends out of view.
 */
import type { PerspectiveCamera } from "three";
import type { RasterContext } from "../render/canvasTypes";
import { drawCrosshair } from "../render/drawProjectiles";
import type { Scene } from "../render/renderScene";
import { drawPlayerArrows } from "./playerArrows";

/** The screen's centre, reused every frame, CSS pixels. */
const centre: [number, number] = [0, 0];

/** What {@link drawOverlay3d} needs besides the camera. */
export type Overlay3dInput = {
  /** The camera focus, world metres: arrows point at friends within range of it. */
  origin: { x: number; y: number };
  /** The canvas's CSS size. */
  size: { width: number; height: number };
  /** No crosshair (and no arrows) over a body. */
  dead: boolean;
  /** The players, for arrows toward friends out of view; none are drawn without them. */
  friends?: Pick<Scene, "players" | "localPlayerId">;
};

/**
 * Draws the 3D view's HUD on the 2D canvas, in CSS pixels: the 2D game's crosshair at the
 * screen's centre, and an arrow at the edge toward each friend out of view.
 *
 * @param context - The cleared 2D context, transformed to CSS pixels.
 * @param camera - The camera the frame was rendered with.
 * @param input - The focus, canvas size, whether the player is dead, and the players.
 */
export function drawOverlay3d(
  context: RasterContext,
  camera: PerspectiveCamera,
  input: Overlay3dInput,
): void {
  if (input.dead) return;
  centre[0] = input.size.width / 2;
  centre[1] = input.size.height / 2;
  drawCrosshair(context, centre);
  drawPlayerArrows(context, camera, input);
}
