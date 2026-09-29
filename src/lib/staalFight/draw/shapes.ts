import type { Vec } from "../math";
import type { HandShape } from "../types";

/** Ink colour for every outline: a warm near-black that sits well on the sunset. */
export const INK = "#1b0f14";

/** Outline width in world pixels. */
export const LINE = 3;

/** A light / mid / shadow triple for cel-shaded fills. */
export type Tone = { light: string; base: string; dark: string };

/** Fonts the canvas draws text with; the component passes in what it loaded. */
export type FightFonts = { display: string; hud: string };

/** Fallback stacks when no web font is available (tests, first frame). */
export const FALLBACK_FONTS: FightFonts = {
  display: '"Arial Black", Impact, system-ui, sans-serif',
  hud: '"Courier New", ui-monospace, monospace',
};

/**
 * Traces a capsule (two circles joined by tangents) between two points.
 *
 * @param ctx - Canvas.
 * @param a - Start centre.
 * @param b - End centre.
 * @param ra - Radius at `a`.
 * @param rb - Radius at `b`.
 */
export function capsulePath(
  ctx: CanvasRenderingContext2D,
  a: Vec,
  b: Vec,
  ra: number,
  rb: number,
): void {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  ctx.beginPath();
  ctx.arc(a.x, a.y, ra, ang + Math.PI / 2, ang + Math.PI * 1.5);
  ctx.arc(b.x, b.y, rb, ang - Math.PI / 2, ang + Math.PI / 2);
  ctx.closePath();
}

/**
 * A gradient across a limb: lit on one side, shaded on the other.
 *
 * @param ctx - Canvas.
 * @param a - Limb start.
 * @param b - Limb end.
 * @param r - Half width.
 * @param tone - Colours.
 * @returns The gradient.
 */
export function acrossGradient(
  ctx: CanvasRenderingContext2D,
  a: Vec,
  b: Vec,
  r: number,
  tone: Tone,
): CanvasGradient {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  // Light comes from above: make sure the lit edge is the upper one.
  const flip = ny > 0 ? -1 : 1;
  const g = ctx.createLinearGradient(
    mx + nx * r * flip,
    my + ny * r * flip,
    mx - nx * r * flip,
    my - ny * r * flip,
  );
  g.addColorStop(0, tone.light);
  g.addColorStop(0.45, tone.base);
  g.addColorStop(1, tone.dark);
  return g;
}

/**
 * Draws a shaded, outlined limb segment.
 *
 * @param ctx - Canvas.
 * @param a - Start.
 * @param b - End.
 * @param ra - Radius at start.
 * @param rb - Radius at end.
 * @param tone - Colours.
 */
export function limb(
  ctx: CanvasRenderingContext2D,
  a: Vec,
  b: Vec,
  ra: number,
  rb: number,
  tone: Tone,
): void {
  capsulePath(ctx, a, b, ra, rb);
  ctx.fillStyle = acrossGradient(ctx, a, b, Math.max(ra, rb), tone);
  ctx.fill();
  ctx.lineWidth = LINE;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

/**
 * Fills and outlines the current path.
 *
 * @param ctx - Canvas.
 * @param fill - Fill style.
 * @param width - Outline width.
 */
export function inked(
  ctx: CanvasRenderingContext2D,
  fill: string | CanvasGradient,
  width = LINE,
): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = width;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

/**
 * Canvas angle (atan2 on screen) of a direction measured from straight down, + forward.
 *
 * @param downAngle - Angle in radians.
 * @returns The canvas rotation that points +x along it.
 */
export function canvasAngle(downAngle: number): number {
  return Math.atan2(Math.cos(downAngle), Math.sin(downAngle));
}

/**
 * Draws a hand at the end of a forearm.
 *
 * @param ctx - Canvas, in the figure's frame.
 * @param at - Wrist position.
 * @param foreArm - Forearm angle from straight down, radians.
 * @param shape - What the hand is doing.
 * @param tone - Skin colours.
 * @param size - Scale (1 is a big brawler's fist).
 */
export function hand(
  ctx: CanvasRenderingContext2D,
  at: Vec,
  foreArm: number,
  shape: HandShape,
  tone: Tone,
  size = 1,
): void {
  const theta = canvasAngle(foreArm);
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(theta);
  ctx.scale(size, size);
  const fill = (): void => inked(ctx, tone.base, LINE / size);

  if (shape === "open") {
    ctx.beginPath();
    ctx.ellipse(6, 0, 10, 6.5, 0, 0, Math.PI * 2);
    fill();
    ctx.lineWidth = 1.6 / size;
    ctx.strokeStyle = INK;
    for (const y of [-3, 0, 3]) {
      ctx.beginPath();
      ctx.moveTo(10, y);
      ctx.lineTo(17, y * 1.2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.ellipse(3, -6, 5, 3, -0.6, 0, Math.PI * 2);
    fill();
  } else {
    ctx.beginPath();
    ctx.ellipse(5, 0, 9.5, 8.5, 0, 0, Math.PI * 2);
    fill();
    ctx.fillStyle = tone.light;
    ctx.beginPath();
    ctx.ellipse(6, -3.5, 5, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.5 / size;
    ctx.strokeStyle = INK;
    ctx.beginPath();
    ctx.moveTo(9, -5);
    ctx.quadraticCurveTo(13, 0, 9, 5);
    ctx.stroke();
    if (shape === "point") {
      capsulePath(ctx, { x: 10, y: -3 }, { x: 22, y: -3 }, 3, 2.6);
      fill();
    }
    if (shape === "thumb") {
      // Thumb straight up in the figure's frame, whatever the forearm does.
      ctx.rotate(-theta);
      capsulePath(ctx, { x: 0, y: -4 }, { x: 0, y: -17 }, 3.6, 3.2);
      fill();
    }
  }
  ctx.restore();
}

/**
 * Traces a rounded rectangle.
 *
 * @param ctx - Canvas.
 * @param x - Left.
 * @param y - Top.
 * @param w - Width.
 * @param h - Height.
 * @param r - Corner radius.
 */
export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * Draws a five-pointed star.
 *
 * @param ctx - Canvas.
 * @param x - Centre x.
 * @param y - Centre y.
 * @param r - Outer radius.
 * @param rot - Rotation in radians.
 */
export function starPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  rot: number,
  points = 5,
  inner = 0.45,
): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i * Math.PI) / points - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * inner;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/**
 * Draws outlined display text (the arcade look): thick ink, then the fill.
 *
 * @param ctx - Canvas.
 * @param text - Text.
 * @param x - Anchor x.
 * @param y - Baseline y.
 * @param fill - Fill style.
 * @param outline - Outline width.
 */
export function outlinedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fill: string | CanvasGradient,
  outline: number,
): void {
  ctx.lineJoin = "round";
  ctx.lineWidth = outline;
  ctx.strokeStyle = INK;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}
