/**
 * The 3D view's HUD layer: what gets drawn on the transparent 2D canvas stacked over the WebGL
 * one (spec §6.2) — the crosshair, always at the screen's centre where the aim probe looks (aim
 * spec §5), or the rifle's scope once its sights are up, and arrows at the screen's edge toward
 * friends out of view.
 */
import type { PerspectiveCamera } from "three";
import type { RasterContext } from "../render/canvasTypes";
import { drawCrosshair } from "../render/drawProjectiles";
import type { Scene } from "../render/renderScene";
import { drawPlayerArrows } from "./playerArrows";

/** The scope's clear circle: its radius as a share of the screen's shorter side. */
export const SCOPE_RADIUS_SHARE = 0.42;
/** The dark inside of the scope's tube, round the clear circle. */
export const SCOPE_SHADE = "rgba(4, 6, 8, 0.97)";
/** The tube's rim at the circle's edge: colour and width, CSS pixels. */
const SCOPE_RIM = "#000";
const SCOPE_RIM_PX = 6;
/** The reticle's hairlines and the heavier posts toward the rim, CSS pixels. */
const RETICLE_INK = "rgba(8, 10, 12, 0.92)";
const RETICLE_HAIR_PX = 1;
const RETICLE_POST_PX = 4;
/** The hairlines stop this far short of the centre, CSS pixels. */
const RETICLE_GAP_PX = 5;
/** The posts start this share of the radius out from the centre. */
const RETICLE_POST_FROM = 0.6;
/** The lit dot at the reticle's centre: colour and radius, CSS pixels. */
const RETICLE_DOT = "#ff4a3a";
const RETICLE_DOT_PX = 1.5;
/** A full turn, radians. */
const TURN = Math.PI * 2;

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
  /** How far the rifle's scope has faded in, 0 … 1; absent or 0, the crosshair shows. */
  scope?: number;
};

/** Four strokes out from the centre, from `from` to `to` pixels away along each axis. */
function cross(
  context: RasterContext,
  radius: { from: number; to: number },
  width: number,
): void {
  const [x, y] = centre;
  context.lineWidth = width;
  context.beginPath();
  context.moveTo(x - radius.to, y);
  context.lineTo(x - radius.from, y);
  context.moveTo(x + radius.from, y);
  context.lineTo(x + radius.to, y);
  context.moveTo(x, y - radius.to);
  context.lineTo(x, y - radius.from);
  context.moveTo(x, y + radius.from);
  context.lineTo(x, y + radius.to);
  context.stroke();
}

/** The fine reticle: hairlines to the centre, heavier posts toward the rim, and a lit dot. */
function drawReticle(context: RasterContext, radius: number): void {
  context.strokeStyle = RETICLE_INK;
  cross(context, { from: RETICLE_GAP_PX, to: radius }, RETICLE_HAIR_PX);
  cross(
    context,
    { from: radius * RETICLE_POST_FROM, to: radius },
    RETICLE_POST_PX,
  );
  context.fillStyle = RETICLE_DOT;
  context.beginPath();
  context.arc(centre[0], centre[1], RETICLE_DOT_PX, 0, TURN);
  context.fill();
}

/** The rifle's scope: the dark tube round a clear circle, its rim, and the reticle. */
function drawScope(
  context: RasterContext,
  size: Overlay3dInput["size"],
  share: number,
): void {
  const radius = Math.min(size.width, size.height) * SCOPE_RADIUS_SHARE;
  context.save();
  context.globalAlpha = share;
  context.fillStyle = SCOPE_SHADE;
  context.beginPath();
  context.rect(0, 0, size.width, size.height);
  context.arc(centre[0], centre[1], radius, 0, TURN);
  context.fill("evenodd");
  context.strokeStyle = SCOPE_RIM;
  context.lineWidth = SCOPE_RIM_PX;
  context.beginPath();
  context.arc(centre[0], centre[1], radius, 0, TURN);
  context.stroke();
  drawReticle(context, radius);
  context.restore();
}

/**
 * Draws the 3D view's HUD on the 2D canvas, in CSS pixels: the 2D game's crosshair at the
 * screen's centre — or, aimed down a rifle, its scope — and an arrow at the edge toward each
 * friend out of view.
 *
 * @param context - The cleared 2D context, transformed to CSS pixels.
 * @param camera - The camera the frame was rendered with.
 * @param input - The focus, canvas size, whether the player is dead, the players and the scope.
 */
export function drawOverlay3d(
  context: RasterContext,
  camera: PerspectiveCamera,
  input: Overlay3dInput,
): void {
  if (input.dead) return;
  centre[0] = input.size.width / 2;
  centre[1] = input.size.height / 2;
  const scope = input.scope ?? 0;
  if (scope > 0) drawScope(context, input.size, scope);
  else drawCrosshair(context, centre);
  drawPlayerArrows(context, camera, input);
}
