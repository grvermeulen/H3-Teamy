import { RIGS, limbPoint } from "../rig";
import type { FightScript } from "../script";
import {
  FLOOR_Y,
  fighterAt,
  hipWorld,
  toWorld,
  type FighterState,
} from "../timeline";
import { starPath, inked } from "./shapes";
import { drawStaal } from "./staal";
import { drawTrump } from "./trump";

/**
 * Draws a fighter's body in world space.
 *
 * @param ctx - Canvas with the camera transform applied.
 * @param s - The fighter's state.
 * @param time - Seconds, for small animated details.
 */
export function drawFigure(
  ctx: CanvasRenderingContext2D,
  s: FighterState,
  time: number,
): void {
  const h = hipWorld(s);
  ctx.save();
  ctx.translate(h.x, h.y);
  ctx.scale(s.facing, 1);
  ctx.rotate(s.rot);
  if (s.id === "staal") drawStaal(ctx, s);
  else drawTrump(ctx, s, time);
  ctx.restore();
}

/**
 * The soft shadow on the boardwalk, shrinking as the fighter leaves the ground.
 *
 * @param ctx - Canvas with the camera transform applied.
 * @param s - The fighter's state.
 */
export function drawShadow(
  ctx: CanvasRenderingContext2D,
  s: FighterState,
): void {
  const h = hipWorld(s);
  const lying = Math.abs(Math.sin(s.rot));
  const k = Math.max(0.25, 1 - s.y / 320);
  ctx.fillStyle = `rgba(20, 6, 20, ${0.38 * k})`;
  ctx.beginPath();
  ctx.ellipse(
    h.x - s.facing * lying * 40,
    FLOOR_Y + 3,
    (52 + lying * 50) * k,
    9 * k,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
}

/**
 * The super aura: a steel-blue glow with flickering flame tongues, drawn additively.
 *
 * @param ctx - Canvas with the camera transform applied.
 * @param s - The fighter's state.
 * @param time - Seconds.
 */
export function drawAura(
  ctx: CanvasRenderingContext2D,
  s: FighterState,
  time: number,
): void {
  const c = toWorld(s, limbPoint(s.joints, RIGS[s.id], "chest"));
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const g = ctx.createRadialGradient(c.x, c.y, 10, c.x, c.y, 150);
  g.addColorStop(0, "rgba(160, 230, 255, 0.55)");
  g.addColorStop(0.5, "rgba(60, 140, 255, 0.22)");
  g.addColorStop(1, "rgba(40, 80, 255, 0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(c.x, c.y, 110, 150, 0, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + time * 0.8;
    const r = 58 + Math.sin(time * 9 + i * 1.7) * 10;
    const x = c.x + Math.cos(a) * r * 0.75;
    const y = c.y + Math.sin(a) * r;
    const len = 30 + Math.sin(time * 13 + i) * 12;
    const fg = ctx.createLinearGradient(x, y, x, y - len);
    fg.addColorStop(0, "rgba(140, 220, 255, 0.5)");
    fg.addColorStop(1, "rgba(140, 220, 255, 0)");
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(x - 9, y);
    ctx.quadraticCurveTo(x, y - len * 1.3, x + 9, y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Re-used canvas for tinted afterimages. */
type GhostCanvas = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D };

let ghostCanvas: GhostCanvas | null = null;

/** Half the size of the afterimage canvas, in world pixels. */
const GHOST_HALF = 240;

function ghostSurface(scale: number): GhostCanvas | null {
  if (typeof document === "undefined") return null;
  const size = Math.ceil(GHOST_HALF * 2 * scale);
  if (!ghostCanvas) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ghostCanvas = { canvas, ctx };
  }
  if (ghostCanvas.canvas.width !== size) {
    ghostCanvas.canvas.width = size;
    ghostCanvas.canvas.height = size;
  }
  return ghostCanvas;
}

/**
 * Tinted afterimages trailing a fast-moving fighter: the body a few frames ago, in steel blue.
 *
 * @param ctx - Canvas with the camera transform applied.
 * @param script - The fight.
 * @param s - The fighter now.
 * @param t - Story seconds.
 * @param time - Seconds, for animated details.
 * @param scale - Device pixels per world pixel, for a crisp afterimage.
 */
export function drawGhosts(
  ctx: CanvasRenderingContext2D,
  script: FightScript,
  s: FighterState,
  t: number,
  time: number,
  scale: number,
): void {
  const surface = ghostSurface(Math.min(2, scale));
  if (!surface) return;
  const k = surface.canvas.width / (GHOST_HALF * 2);
  const tints = [
    "rgba(120, 220, 255, 0.95)",
    "rgba(90, 160, 255, 0.95)",
    "rgba(120, 90, 255, 0.95)",
  ];
  for (let i = 3; i >= 1; i--) {
    const past = fighterAt(script, s.id, t - i * 0.04);
    const h = hipWorld(past);
    const g = surface.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.clearRect(0, 0, surface.canvas.width, surface.canvas.height);
    g.setTransform(k, 0, 0, k, GHOST_HALF * k, GHOST_HALF * k);
    g.scale(past.facing, 1);
    g.rotate(past.rot);
    if (past.id === "staal") drawStaal(g, past);
    else drawTrump(g, past, time);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-atop";
    g.fillStyle = tints[i - 1];
    g.fillRect(0, 0, surface.canvas.width, surface.canvas.height);
    g.globalCompositeOperation = "source-over";
    ctx.save();
    ctx.globalAlpha = 0.5 - i * 0.12;
    ctx.drawImage(
      surface.canvas,
      h.x - GHOST_HALF,
      h.y - GHOST_HALF,
      GHOST_HALF * 2,
      GHOST_HALF * 2,
    );
    ctx.restore();
  }
}

/**
 * Cartoon stars circling a dazed head.
 *
 * @param ctx - Canvas with the camera transform applied.
 * @param s - The fighter's state.
 * @param time - Seconds.
 */
export function drawStars(
  ctx: CanvasRenderingContext2D,
  s: FighterState,
  time: number,
): void {
  const head = toWorld(s, s.joints.head);
  for (let i = 0; i < 3; i++) {
    const a = time * 3.2 + (i * Math.PI * 2) / 3;
    const x = head.x + Math.cos(a) * 30;
    const y = head.y - 30 + Math.sin(a) * 9;
    starPath(ctx, x, y, 8 + Math.sin(a) * 1.5, a);
    inked(ctx, "#ffe14d", 2);
  }
}
