import { clamp } from "../math";
import type { FightScript } from "../script";
import { comboAt, healthAt, meterAt } from "../timeline";
import type { FighterId } from "../types";
import { INK, outlinedText, roundRect, type FightFonts } from "./shapes";
import { drawStaalHead } from "./staal";
import { drawTrumpHead } from "./trump";
import { VIEW_W } from "./stage";

const BAR_W = 350;
const BAR_H = 20;
const BAR_Y = 26;

/** A portrait disc next to a health bar. */
function portrait(
  ctx: CanvasRenderingContext2D,
  who: FighterId,
  x: number,
  y: number,
  mirror: boolean,
  hurt: boolean,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 27, 0, Math.PI * 2);
  ctx.fillStyle = who === "staal" ? "#2b6f8f" : "#8f1d2b";
  ctx.fill();
  ctx.clip();
  ctx.translate(x - (mirror ? -3 : 3), y + 6);
  ctx.scale(mirror ? -1.05 : 1.05, 1.05);
  if (who === "staal") drawStaalHead(ctx, hurt ? "hurt" : "smirk", "on");
  else drawTrumpHead(ctx, hurt ? "hurt" : "smug", 0);
  ctx.restore();
  ctx.lineWidth = 3;
  ctx.strokeStyle = INK;
  ctx.beginPath();
  ctx.arc(x, y, 27, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#ffd24a";
  ctx.beginPath();
  ctx.arc(x, y, 24.5, 0, Math.PI * 2);
  ctx.stroke();
}

/** One health bar; `fromRight` bars drain towards the right edge. */
function healthBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  hp: number,
  chip: number,
  fromRight: boolean,
  time: number,
): void {
  roundRect(ctx, x - 3, BAR_Y - 3, BAR_W + 6, BAR_H + 6, 5);
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.fillStyle = "#3b0a12";
  ctx.fillRect(x, BAR_Y, BAR_W, BAR_H);
  const w = (BAR_W * hp) / 100;
  const cw = (BAR_W * chip) / 100;
  ctx.fillStyle = "#fff1f1";
  ctx.fillRect(fromRight ? x + BAR_W - cw : x, BAR_Y, cw, BAR_H);
  const low = hp < 30 && Math.sin(time * 14) > 0;
  const g = ctx.createLinearGradient(0, BAR_Y, 0, BAR_Y + BAR_H);
  g.addColorStop(0, low ? "#ff8a8a" : "#fff27a");
  g.addColorStop(0.5, low ? "#e0162b" : "#ffc233");
  g.addColorStop(1, low ? "#8f0a1c" : "#e0791a");
  ctx.fillStyle = g;
  ctx.fillRect(fromRight ? x + BAR_W - w : x, BAR_Y, w, BAR_H);
  ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
  ctx.fillRect(fromRight ? x + BAR_W - w : x, BAR_Y + 2, w, 4);
}

/**
 * Draws the arcade HUD: portraits, health bars, names, timer and Staal's super meter.
 *
 * @param ctx - Canvas with only the base transform.
 * @param script - The fight.
 * @param t - Story seconds.
 * @param time - Real seconds (blinking).
 * @param fonts - Fonts.
 * @param alpha - Fade.
 */
export function drawHud(
  ctx: CanvasRenderingContext2D,
  script: FightScript,
  t: number,
  time: number,
  fonts: FightFonts,
  alpha: number,
): void {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  const sHp = healthAt(script, "staal", t);
  const tHp = healthAt(script, "trump", t);
  const sChip = healthAt(script, "staal", t - 0.7);
  const tChip = healthAt(script, "trump", t - 0.7);
  const left = 76;
  const right = VIEW_W - 76 - BAR_W;
  healthBar(ctx, left, sHp, sChip, false, time);
  healthBar(ctx, right, tHp, tChip, true, time);
  portrait(ctx, "staal", 40, 38, false, sHp < sChip);
  portrait(ctx, "trump", VIEW_W - 40, 38, true, tHp < tChip);

  ctx.font = `26px ${fonts.display}`;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  outlinedText(ctx, "STAAL", left, BAR_Y + BAR_H + 26, "#ffffff", 5);
  ctx.textAlign = "right";
  outlinedText(ctx, "TRUMP", right + BAR_W, BAR_Y + BAR_H + 26, "#ffffff", 5);

  // Timer.
  const fightStart = 7.4;
  const ko = script.hits.reduce(
    (at, h) =>
      h.on === "trump" && healthAt(script, "trump", h.t) === 0
        ? Math.min(at, h.t)
        : at,
    Infinity,
  );
  const clock = clamp(
    99 - Math.floor((Math.min(t, ko) - fightStart) / 1.1),
    0,
    99,
  );
  roundRect(ctx, VIEW_W / 2 - 34, 12, 68, 50, 8);
  ctx.fillStyle = "rgba(20, 8, 20, 0.85)";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#ffd24a";
  ctx.stroke();
  ctx.font = `28px ${fonts.hud}`;
  ctx.textAlign = "center";
  outlinedText(
    ctx,
    String(t < fightStart ? 99 : clock).padStart(2, "0"),
    VIEW_W / 2,
    52,
    "#ffffff",
    4,
  );

  // Super meter.
  const meter = meterAt(script, t);
  const mx = 30;
  const my = 504;
  const mw = 240;
  ctx.textAlign = "left";
  ctx.font = `18px ${fonts.display}`;
  outlinedText(ctx, "STAALKRACHT", mx, my - 8, "#8fe3ff", 4);
  roundRect(ctx, mx - 3, my - 3, mw + 6, 20, 4);
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.fillStyle = "#10233a";
  ctx.fillRect(mx, my, mw, 14);
  const full = meter >= 100;
  const mg = ctx.createLinearGradient(mx, 0, mx + mw, 0);
  mg.addColorStop(0, "#2b7bff");
  mg.addColorStop(1, full ? "#ffffff" : "#8fe3ff");
  ctx.fillStyle = mg;
  ctx.fillRect(mx, my, (mw * meter) / 100, 14);
  ctx.fillStyle = INK;
  for (let i = 1; i < 3; i++) ctx.fillRect(mx + (mw * i) / 3 - 1, my, 2, 14);
  if (full && Math.sin(time * 12) > -0.2) {
    ctx.font = `20px ${fonts.display}`;
    outlinedText(ctx, "MAX", mx + mw + 12, my + 14, "#ffffff", 4);
  }
  ctx.restore();
}

/** Labels for long combos. */
function comboLabel(n: number): string | null {
  if (n >= 18) return "STAALHARDE COMBO!";
  if (n >= 10) return "SUPER COMBO!";
  if (n >= 5) return "COMBO!";
  return null;
}

/**
 * Staal's combo counter on the left, popping with every hit.
 *
 * @param ctx - Canvas with only the base transform.
 * @param script - The fight.
 * @param t - Story seconds.
 * @param fonts - Fonts.
 */
export function drawCombo(
  ctx: CanvasRenderingContext2D,
  script: FightScript,
  t: number,
  fonts: FightFonts,
): void {
  const { count, lastT } = comboAt(script, "staal", t);
  const since = t - lastT;
  if (count < 2 || since > 1.4) return;
  const pop = 1 + 0.4 * Math.exp(-since * 14);
  const fade = since > 1.1 ? 1 - (since - 1.1) / 0.3 : 1;
  ctx.save();
  ctx.globalAlpha = Math.max(0, fade);
  ctx.translate(40, 200);
  ctx.save();
  ctx.scale(pop, pop);
  ctx.textAlign = "left";
  ctx.font = `64px ${fonts.display}`;
  const g = ctx.createLinearGradient(0, -56, 0, 0);
  g.addColorStop(0, "#fff7b0");
  g.addColorStop(1, "#ff9a1f");
  outlinedText(ctx, String(count), 0, 0, g, 7);
  ctx.restore();
  ctx.font = `28px ${fonts.display}`;
  ctx.textAlign = "left";
  outlinedText(ctx, "HITS", count >= 10 ? 76 : 44, -4, "#ffffff", 5);
  const label = comboLabel(count);
  if (label) {
    ctx.font = `24px ${fonts.display}`;
    outlinedText(ctx, label, 0, 32, "#8fe3ff", 5);
  }
  ctx.restore();
}
