import { PLAYER_RADIUS_M } from "../sim/player";
import type { RasterContext } from "./canvasTypes";
import type { PersonSprite, PropSprite } from "./sprites";

/**
 * The character art faces *down* its own image: the generator drew every figure head at the top
 * and feet at the bottom, so the toes point at the bottom edge — the opposite of the nose-up car
 * sprite. With `facing` 0 pointing along +x, that makes the turn a negative quarter.
 */
export const PERSON_SPRITE_TURN_RAD = -Math.PI / 2;
/**
 * How far the character art overhangs the collision circle. A standing person's arms and
 * shoulders reach past the hull anyway, and the hull alone lands on the 6 px floor at every zoom
 * the arena offers — 12 px is too small to recognise anyone in.
 */
export const PERSON_SPRITE_SCALE = 1.6;
/** Ticks each walk frame is held. At 30 Hz that is 7.5 frames a second, a stride you can read. */
export const WALK_FRAME_TICKS = 4;
/** Below this speed (m/s) a person is standing, so the strip rests on its first frame. */
export const WALK_ANIMATION_MIN_SPEED_MPS = 0.2;
/** Where a held item sits in the person's frame: this far forward of the centre, metres. */
export const HAND_FORWARD_M = 0.15;
/** And this far to the right, metres — the right hand. */
export const HAND_RIGHT_M = 0.22;
/** The share of an item's length that lies behind the hand: the grip or the handle. */
const GRIP_SHARE = 0.3;

/**
 * The strip cell to draw this tick for someone moving at `speedMps`. The cycle runs off the tick
 * rather than off distance walked, which the simulation does not track: at one walk speed the two
 * agree closely enough, and someone standing always rests on frame 0 so they never moon-walk on
 * the spot.
 *
 * @param speedMps - How fast the person moves.
 * @param tick - The simulation tick.
 * @param frames - Cells in the strip.
 * @returns The cell index.
 */
export function walkFrameAt(
  speedMps: number,
  tick: number,
  frames: number,
): number {
  if (frames <= 1 || speedMps < WALK_ANIMATION_MIN_SPEED_MPS) return 0;
  return Math.floor(tick / WALK_FRAME_TICKS) % frames;
}

/**
 * Draws one cell of a character strip over a person's collision circle, turned to face where
 * they face.
 *
 * @param context - The canvas, in screen space.
 * @param sprite - The strip.
 * @param x - Screen x of the person.
 * @param y - Screen y of the person.
 * @param radius - The collision circle's screen radius; the art overhangs it by the scale.
 * @param facing - The person's facing, radians.
 * @param frame - The cell to draw.
 */
export function drawPersonStrip(
  context: RasterContext,
  sprite: PersonSprite,
  x: number,
  y: number,
  radius: number,
  facing: number,
  frame: number,
): void {
  const half = radius * PERSON_SPRITE_SCALE;
  context.save();
  context.translate(x, y);
  context.rotate(facing + PERSON_SPRITE_TURN_RAD);
  context.drawImage(
    sprite.image,
    frame * sprite.pixelSize,
    0,
    sprite.pixelSize,
    sprite.pixelSize,
    -half,
    -half,
    half * 2,
    half * 2,
  );
  context.restore();
}

/**
 * Draws the item a person holds — pointing where they face, its grip at their right hand — at
 * its real size, scaled as the figure is: a pistol is a few pixels, a rifle a stick.
 *
 * @param context - The canvas, in screen space.
 * @param sprite - The item's art.
 * @param x - Screen x of the person.
 * @param y - Screen y of the person.
 * @param radius - The collision circle's screen radius, which sets the scale.
 * @param facing - The person's facing, radians.
 */
export function drawHeldItem(
  context: RasterContext,
  sprite: PropSprite,
  x: number,
  y: number,
  radius: number,
  facing: number,
): void {
  const scale = radius / PLAYER_RADIUS_M;
  const length = sprite.lengthMetres * scale;
  const width = sprite.widthMetres * scale;
  context.save();
  context.translate(x, y);
  context.rotate(facing);
  context.drawImage(
    sprite.image,
    HAND_FORWARD_M * scale - length * GRIP_SHARE,
    HAND_RIGHT_M * scale - width / 2,
    length,
    width,
  );
  context.restore();
}
