/**
 * Friends off screen, on the 3D view's HUD (the 2D canvas over the WebGL one): a small arrow at
 * the screen's edge, in the friend's vest colour, pointing the way to each other living player
 * within {@link MARKER_RANGE_M} whose marker is out of view. Pure projection maths plus a few
 * canvas calls; a frame allocates nothing.
 */
import { Vector3, type PerspectiveCamera } from "three";
import type { RasterContext } from "../render/canvasTypes";
import type { ArenaPlayerState } from "../sim/types";
import { MARKER_HEIGHT_M, MARKER_RANGE_M, markerCss } from "./playerMarkers3d";

/** An arrow keeps this far inside every edge of the screen, CSS pixels. */
export const ARROW_EDGE_MARGIN_PX = 28;
/** The arrow's length along its point, and its width at the back, CSS pixels. */
const ARROW_LENGTH_PX = 18;
const ARROW_WIDTH_PX = 14;
/** The dark rim that keeps an arrow readable over a bright sky or a lit window. */
const ARROW_OUTLINE = "rgba(0,0,0,0.75)";
const ARROW_OUTLINE_PX = 2;
/** Degrees to radians, halved: a field of view's half angle. */
const HALF_ANGLE_PER_DEGREE = Math.PI / 360;

/** Where an arrow sits on screen (CSS pixels) and where it points (radians, screen y down). */
export type EdgeArrow = { x: number; y: number; angle: number };

/** What {@link drawPlayerArrows} needs besides the camera. */
export type PlayerArrowsInput = {
  /** The camera focus, world metres: arrows are drawn for players within range of it. */
  origin: { x: number; y: number };
  /** The canvas's CSS size. */
  size: { width: number; height: number };
  players: readonly ArenaPlayerState[];
  localPlayerId: number;
};

/**
 * The arrow at the screen's edge toward a point out of view.
 *
 * @param view - The point in camera space: x right, y up, in front at negative z.
 * @param lens - The camera's vertical field of view (degrees) and aspect.
 * @param size - The canvas's CSS size.
 * @param out - Written and returned, so a frame allocates nothing.
 * @returns `out`, on the inner edge {@link ARROW_EDGE_MARGIN_PX} in, pointing from the screen's
 *   centre toward the point (a point behind the camera toward its side, straight behind down);
 *   `null` when the point is on screen.
 */
export function edgeArrow(
  view: { x: number; y: number; z: number },
  lens: Pick<PerspectiveCamera, "fov" | "aspect">,
  size: { width: number; height: number },
  out: EdgeArrow,
): EdgeArrow | null {
  if (view.z < 0) {
    const halfHeight = -view.z * Math.tan(lens.fov * HALF_ANGLE_PER_DEGREE);
    const onScreen =
      Math.abs(view.x) <= halfHeight * lens.aspect &&
      Math.abs(view.y) <= halfHeight;
    if (onScreen) return null;
  }
  // On screen the direction from the centre runs along (x, −y) for any point in front, and it
  // is the side a point behind the camera lies on.
  let dx = view.x;
  let dy = -view.y;
  if (dx === 0 && dy === 0) dy = 1;
  const halfWidth = size.width / 2 - ARROW_EDGE_MARGIN_PX;
  const halfHeight = size.height / 2 - ARROW_EDGE_MARGIN_PX;
  const reach = Math.min(
    dx === 0 ? Infinity : halfWidth / Math.abs(dx),
    dy === 0 ? Infinity : halfHeight / Math.abs(dy),
  );
  out.x = size.width / 2 + dx * reach;
  out.y = size.height / 2 + dy * reach;
  out.angle = Math.atan2(dy, dx);
  return out;
}

/** Paints one arrow, pointing along its angle. */
function paintArrow(
  context: RasterContext,
  arrow: EdgeArrow,
  colour: string,
): void {
  context.save();
  context.translate(arrow.x, arrow.y);
  context.rotate(arrow.angle);
  context.beginPath();
  context.moveTo(ARROW_LENGTH_PX / 2, 0);
  context.lineTo(-ARROW_LENGTH_PX / 2, ARROW_WIDTH_PX / 2);
  context.lineTo(-ARROW_LENGTH_PX / 2, -ARROW_WIDTH_PX / 2);
  context.closePath();
  context.lineWidth = ARROW_OUTLINE_PX;
  context.strokeStyle = ARROW_OUTLINE;
  context.stroke();
  context.fillStyle = colour;
  context.fill();
  context.restore();
}

/** Reused for every player, so the arrows allocate nothing. */
const inView = new Vector3();
const scratchArrow: EdgeArrow = { x: 0, y: 0, angle: 0 };

/** True when a player gets an arrow: someone else, alive, within range of the focus. */
function marked(player: ArenaPlayerState, input: PlayerArrowsInput): boolean {
  if (player.id === input.localPlayerId || player.diedAtTick !== null)
    return false;
  const dx = player.x - input.origin.x;
  const dy = player.y - input.origin.y;
  return dx * dx + dy * dy <= MARKER_RANGE_M * MARKER_RANGE_M;
}

/**
 * Draws an arrow at the screen's edge toward each other living player within
 * {@link MARKER_RANGE_M} whose marker (at {@link MARKER_HEIGHT_M}) is out of view.
 *
 * @param context - The 3D view's HUD context, in CSS pixels.
 * @param camera - The camera the frame was rendered with, its matrices up to date.
 * @param input - The focus, canvas size and players.
 */
export function drawPlayerArrows(
  context: RasterContext,
  camera: PerspectiveCamera,
  input: PlayerArrowsInput,
): void {
  for (const player of input.players) {
    if (!marked(player, input)) continue;
    inView
      .set(player.x, MARKER_HEIGHT_M, player.y)
      .applyMatrix4(camera.matrixWorldInverse);
    const arrow = edgeArrow(inView, camera, input.size, scratchArrow);
    if (arrow) paintArrow(context, arrow, markerCss(player.id));
  }
}
