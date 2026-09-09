/**
 * Universal feedback (spec §7): the red vignette on damage, screen shake, the hit marker when a
 * shot lands, and the low-health heartbeat.
 *
 * {@link stepFeedback} is a pure fold over ticks, so every effect is a unit test on numbers
 * rather than a screenshot, and the shake is derived from the tick rather than from a random
 * source, so two frames drawn for the same tick shake the same way.
 */

import { tookDamage } from "../input/haptics";
import type { ArenaEvent, ArenaPlayerState } from "../sim/types";
import type { Viewport } from "./camera";
import type { RasterContext } from "./canvasTypes";

/** What the frame draws over the scene. */
export type FeedbackState = {
  /** This player's health at the last tick, or null before the first; damage is read from it. */
  health: number | null;
  /** Red vignette strength, 1 right after damage, decaying to 0. */
  vignette: number;
  /** Shake amplitude in pixels, decaying to 0. */
  shake: number;
  /** Ticks the hit marker still shows for. */
  hitMarkerTicks: number;
  /** Heartbeat throb, 0 to 1, oscillating while health is low; 0 otherwise. */
  throb: number;
};

/** What one tick contributes. */
export type FeedbackFrame = {
  tick: number;
  events: ArenaEvent[];
  /** This client's player after the tick. */
  me: ArenaPlayerState;
  /** Under `prefers-reduced-motion` the vignette plays alone; nothing shakes. */
  reducedMotion: boolean;
};

/** Ticks the vignette takes to fade. */
export const VIGNETTE_TICKS = 12;
/** Shake for a bullet hit and for an explosion (spec §7). */
export const SHAKE_HIT_PX = 4;
export const SHAKE_EXPLOSION_PX = 10;
/** Ticks the hit marker shows for. */
export const HIT_MARKER_TICKS = 6;
/** Health below which the heartbeat throbs (spec §7). */
export const LOW_HEALTH = 25;
/** How close an explosion must be to shake this screen. */
export const SHAKE_RADIUS_M = 30;
/** Share of the shake left after each tick. */
const SHAKE_DECAY = 0.75;
/** Ticks per heartbeat. */
const THROB_PERIOD_TICKS = 24;
/** Below this the shake is over. */
const SHAKE_FLOOR_PX = 0.2;

/** The state before anything has happened. */
export const INITIAL_FEEDBACK: FeedbackState = {
  health: null,
  vignette: 0,
  shake: 0,
  hitMarkerTicks: 0,
  throb: 0,
};

/** The strongest shake this tick's events call for, or 0. */
function shakeFrom(frame: FeedbackFrame, hit: boolean): number {
  let shake = hit ? SHAKE_HIT_PX : 0;
  for (const event of frame.events) {
    if (event.kind !== "explosion") continue;
    const near =
      Math.hypot(event.x - frame.me.x, event.y - frame.me.y) <= SHAKE_RADIUS_M;
    if (near) shake = Math.max(shake, SHAKE_EXPLOSION_PX);
  }
  return shake;
}

/** True when one of this player's shots landed this tick. */
function landedShot(frame: FeedbackFrame): boolean {
  return frame.events.some(
    (event) =>
      event.kind === "hit" &&
      event.ownerId === frame.me.id &&
      event.target !== "vehicle",
  );
}

/** The heartbeat for a tick: a full 0–1–0 cycle every {@link THROB_PERIOD_TICKS}. */
function throbAt(tick: number): number {
  return (1 - Math.cos((tick / THROB_PERIOD_TICKS) * 2 * Math.PI)) / 2;
}

/**
 * Folds one tick into the feedback state.
 *
 * @param previous - The state after the last tick.
 * @param frame - This tick.
 * @returns The state to draw this frame.
 */
export function stepFeedback(
  previous: FeedbackState,
  frame: FeedbackFrame,
): FeedbackState {
  const hit = tookDamage(previous.health, frame.me.health);
  const decayed = previous.shake * SHAKE_DECAY;
  const shake = Math.max(shakeFrom(frame, hit), decayed);
  return {
    health: frame.me.health,
    vignette: hit ? 1 : Math.max(0, previous.vignette - 1 / VIGNETTE_TICKS),
    shake: frame.reducedMotion || shake < SHAKE_FLOOR_PX ? 0 : shake,
    hitMarkerTicks: landedShot(frame)
      ? HIT_MARKER_TICKS
      : Math.max(0, previous.hitMarkerTicks - 1),
    throb: frame.me.health < LOW_HEALTH ? throbAt(frame.tick) : 0,
  };
}

/** The classic sine-hash factors: they only have to scatter, not to mean anything. */
const NOISE_TICK_FACTOR = 12.9898;
const NOISE_AXIS_FACTOR = 78.233;
const NOISE_SCALE = 43758.5453;

/** A deterministic value in -1 to 1 for a tick and an axis. */
function noise(tick: number, axis: number): number {
  const x =
    Math.sin(tick * NOISE_TICK_FACTOR + axis * NOISE_AXIS_FACTOR) * NOISE_SCALE;
  return (x - Math.floor(x)) * 2 - 1;
}

/**
 * Where the scene is drawn this frame: offset by the shake, the same way for the same tick.
 *
 * @param state - The feedback state.
 * @param tick - The tick being drawn.
 * @returns The offset in pixels.
 */
export function shakeOffset(
  state: FeedbackState,
  tick: number,
): { x: number; y: number } {
  if (state.shake === 0) return { x: 0, y: 0 };
  return { x: noise(tick, 0) * state.shake, y: noise(tick, 1) * state.shake };
}

/** Alpha of the vignette at full strength, and of the heartbeat at its peak. */
const VIGNETTE_ALPHA = 0.45;
const THROB_ALPHA = 0.28;
/** How far the red reaches in from the edges, as a share of the shorter side. */
const VIGNETTE_DEPTH = 0.22;
/** Number of bands the vignette is drawn in; each is a little more transparent inward. */
const VIGNETTE_BANDS = 4;
/** Hit marker size and stroke. */
const HIT_MARKER_HALF_PX = 7;
const HIT_MARKER_GAP_PX = 3;

/** Paints a red frame fading inward, at `alpha`. */
function drawVignette(
  context: RasterContext,
  size: Viewport,
  alpha: number,
): void {
  const depth = Math.min(size.width, size.height) * VIGNETTE_DEPTH;
  const band = depth / VIGNETTE_BANDS;
  for (let index = 0; index < VIGNETTE_BANDS; index += 1) {
    const inset = index * band;
    context.globalAlpha = alpha * (1 - index / VIGNETTE_BANDS);
    context.fillStyle = "#c81e1e";
    context.fillRect(inset, inset, size.width - inset * 2, band);
    context.fillRect(
      inset,
      size.height - inset - band,
      size.width - inset * 2,
      band,
    );
    context.fillRect(
      inset,
      inset + band,
      band,
      size.height - inset * 2 - band * 2,
    );
    context.fillRect(
      size.width - inset - band,
      inset + band,
      band,
      size.height - inset * 2 - band * 2,
    );
  }
}

/** Paints the hit marker: four short white ticks around the centre. */
function drawHitMarker(context: RasterContext, size: Viewport): void {
  const cx = size.width / 2;
  const cy = size.height / 2;
  context.strokeStyle = "#ffffff";
  context.lineWidth = 2;
  context.beginPath();
  for (const [dx, dy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    context.moveTo(cx + dx * HIT_MARKER_GAP_PX, cy + dy * HIT_MARKER_GAP_PX);
    context.lineTo(cx + dx * HIT_MARKER_HALF_PX, cy + dy * HIT_MARKER_HALF_PX);
  }
  context.stroke();
}

/**
 * Draws the feedback over a painted scene. Draws nothing at all for a quiet state, so a screen
 * with nothing to say costs nothing.
 *
 * @param context - The canvas, in viewport space with the shake already undone.
 * @param size - The viewport.
 * @param state - The feedback state for this frame.
 */
export function drawFeedback(
  context: RasterContext,
  size: Viewport,
  state: FeedbackState,
): void {
  const red = Math.max(
    state.vignette * VIGNETTE_ALPHA,
    state.throb * THROB_ALPHA,
  );
  if (red <= 0 && state.hitMarkerTicks <= 0) return;
  context.save();
  if (red > 0) drawVignette(context, size, red);
  context.globalAlpha = 1;
  if (state.hitMarkerTicks > 0) drawHitMarker(context, size);
  context.restore();
}
