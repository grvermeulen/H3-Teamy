import { clamp, ease, smoothstep, type Vec } from "../math";
import type { BannerStyle, FightScript } from "../script";
import { maxCombo, posedState, type FighterState } from "../timeline";
import { drawStaal, drawStaalHead } from "./staal";
import { drawTrump } from "./trump";
import { INK, outlinedText, roundRect, type FightFonts } from "./shapes";
import { VIEW_H, VIEW_W } from "./stage";

/** Speed lines radiating from a point, for drama. */
function speedLines(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  time: number,
  color: string,
  count = 36,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.sin(i * 12.9) * 0.1;
    const phase = (time * 2.5 + i * 0.37) % 1;
    const r0 = 180 + phase * 420;
    ctx.lineWidth = 2 + (i % 3);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * (r0 + 140), cy + Math.sin(a) * (r0 + 140));
    ctx.stroke();
  }
  ctx.restore();
}

/** Draws a posed figure at a screen point and scale. */
function figureAt(
  ctx: CanvasRenderingContext2D,
  s: FighterState,
  x: number,
  y: number,
  scale: number,
  time: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale * s.facing, scale);
  ctx.rotate(s.rot);
  if (s.id === "staal") drawStaal(ctx, s);
  else drawTrump(ctx, s, time);
  ctx.restore();
}

/**
 * The versus screen: split background, both fighters sliding in, VS slamming down.
 *
 * @param ctx - Canvas with only the base transform.
 * @param t - Story seconds (0 → `vsEnd`).
 * @param vsEnd - When the stage takes over.
 * @param time - Real seconds.
 * @param fonts - Fonts.
 */
export function drawVersus(
  ctx: CanvasRenderingContext2D,
  t: number,
  vsEnd: number,
  time: number,
  fonts: FightFonts,
): void {
  const lg = ctx.createLinearGradient(0, 0, VIEW_W / 2, VIEW_H);
  lg.addColorStop(0, "#1c3f8f");
  lg.addColorStop(1, "#5a1a7a");
  const rg = ctx.createLinearGradient(VIEW_W / 2, 0, VIEW_W, VIEW_H);
  rg.addColorStop(0, "#8f0f24");
  rg.addColorStop(1, "#3a0610");
  ctx.fillStyle = lg;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.fillStyle = rg;
  ctx.beginPath();
  ctx.moveTo(VIEW_W / 2 + 70, 0);
  ctx.lineTo(VIEW_W, 0);
  ctx.lineTo(VIEW_W, VIEW_H);
  ctx.lineTo(VIEW_W / 2 - 70, VIEW_H);
  ctx.closePath();
  ctx.fill();
  speedLines(
    ctx,
    VIEW_W / 2,
    VIEW_H / 2,
    time,
    "rgba(255, 255, 255, 0.12)",
    48,
  );
  ctx.strokeStyle = "#ffd24a";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(VIEW_W / 2 + 70, 0);
  ctx.lineTo(VIEW_W / 2 - 70, VIEW_H);
  ctx.stroke();

  const slide = ease("back", clamp(t / 0.55, 0, 1));
  const staal = posedState("staal", "crack", 0.45, 1);
  const trump = posedState("trump", "gloat", 0.5, -1);
  figureAt(ctx, staal, -200 + slide * 440, 400, 1.55, time);
  figureAt(ctx, trump, VIEW_W + 200 - slide * 440, 400, 1.55, time);

  ctx.textBaseline = "alphabetic";
  ctx.font = `64px ${fonts.display}`;
  ctx.textAlign = "left";
  outlinedText(ctx, "STAAL", 40 - (1 - slide) * 300, VIEW_H - 38, "#ffffff", 8);
  ctx.textAlign = "right";
  outlinedText(
    ctx,
    "TRUMP",
    VIEW_W - 40 + (1 - slide) * 300,
    VIEW_H - 38,
    "#ffffff",
    8,
  );
  ctx.font = `20px ${fonts.display}`;
  ctx.textAlign = "left";
  outlinedText(
    ctx,
    "DE STAALHARDE",
    44 - (1 - slide) * 300,
    VIEW_H - 102,
    "#8fe3ff",
    5,
  );
  ctx.textAlign = "right";
  outlinedText(
    ctx,
    "DE ONTSLAGGEVER",
    VIEW_W - 44 + (1 - slide) * 300,
    VIEW_H - 102,
    "#ffb0b8",
    5,
  );

  if (t > 0.7) {
    const k = ease("out", clamp((t - 0.7) / 0.2, 0, 1));
    const s = 3 - k * 2;
    ctx.save();
    ctx.translate(VIEW_W / 2, VIEW_H / 2 - 10);
    ctx.scale(s, s);
    ctx.globalAlpha = k;
    ctx.font = `130px ${fonts.display}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const g = ctx.createLinearGradient(0, -60, 0, 60);
    g.addColorStop(0, "#fff6b0");
    g.addColorStop(0.5, "#ffb21f");
    g.addColorStop(1, "#e0162b");
    outlinedText(ctx, "VS", 0, 0, g, 12);
    ctx.restore();
  }
  ctx.font = `14px ${fonts.hud}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  outlinedText(ctx, "GTA H3 · STRAATGEVECHT", VIEW_W / 2, 34, "#ffd24a", 4);

  const out = smoothstep(vsEnd - 0.3, vsEnd, t);
  if (out > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${out})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
}

/** Visual style per banner. */
const BANNER: Record<
  BannerStyle,
  { size: number; top: string; bottom: string }
> = {
  round: { size: 92, top: "#ffffff", bottom: "#ffd24a" },
  fight: { size: 124, top: "#fff2a8", bottom: "#ff3b1f" },
  ko: { size: 170, top: "#ff9aa6", bottom: "#d0021b" },
  win: { size: 100, top: "#fff6b0", bottom: "#ff9a1f" },
  proost: { size: 110, top: "#fffbe6", bottom: "#f2b632" },
};

/**
 * A big centre-screen callout with its own entrance.
 *
 * @param ctx - Canvas with only the base transform.
 * @param text - What it says.
 * @param style - Which look.
 * @param u - Seconds since it appeared.
 * @param dur - How long it stays.
 * @param fonts - Fonts.
 */
export function drawBanner(
  ctx: CanvasRenderingContext2D,
  text: string,
  style: BannerStyle,
  u: number,
  dur: number,
  fonts: FightFonts,
): void {
  const look = BANNER[style];
  const out = smoothstep(dur - 0.25, dur, u);
  let x = VIEW_W / 2;
  let y = VIEW_H / 2 - 20;
  let scale = 1;
  let rot = 0;
  if (style === "round") {
    x += (1 - ease("out", clamp(u / 0.25, 0, 1))) * -700 + out * 700;
  } else if (style === "win") {
    y -= (1 - ease("back", clamp(u / 0.4, 0, 1))) * 400;
    y -= 140;
  } else if (style === "proost") {
    scale = ease("back", clamp(u / 0.3, 0, 1));
    rot = Math.sin(u * 8) * 0.06;
    y -= 70;
  } else {
    scale = 1 + (1 - ease("out", clamp(u / 0.18, 0, 1))) * 2.5;
  }
  const alpha = (style === "round" ? 1 : clamp(u / 0.08, 0, 1)) * (1 - out);
  if (alpha <= 0) return;

  ctx.save();
  if (style === "ko") {
    const flash = Math.max(0, 1 - u / 0.4);
    ctx.fillStyle = `rgba(200, 0, 30, ${0.35 * flash})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(scale, scale);
  ctx.font = `${look.size}px ${fonts.display}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const g = ctx.createLinearGradient(0, -look.size / 2, 0, look.size / 2);
  g.addColorStop(0, look.top);
  g.addColorStop(1, look.bottom);
  if (style === "ko") {
    ctx.lineWidth = 22;
    ctx.strokeStyle = "#ffd24a";
    ctx.lineJoin = "round";
    ctx.strokeText(text, 0, 0);
  }
  outlinedText(ctx, text, 0, 0, g, style === "ko" ? 12 : 10);
  ctx.restore();
}

/**
 * A speech bubble above a fighter's head.
 *
 * @param ctx - Canvas with only the base transform.
 * @param text - What they say.
 * @param head - The head, in screen space.
 * @param u - Seconds since it appeared.
 * @param dur - How long it stays.
 * @param fonts - Fonts. A line in capitals is a shout and gets a yellow bubble.
 */
export function drawBubble(
  ctx: CanvasRenderingContext2D,
  text: string,
  head: Vec,
  u: number,
  dur: number,
  fonts: FightFonts,
): void {
  const pop =
    ease("back", clamp(u / 0.18, 0, 1)) * (1 - smoothstep(dur - 0.15, dur, u));
  if (pop <= 0) return;
  ctx.save();
  ctx.font = `21px ${fonts.display}`;
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > 230 && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  lines.push(line);
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 28;
  const h = lines.length * 24 + 16;
  const bx = clamp(head.x - w / 2, 10, VIEW_W - w - 10);
  const by = clamp(head.y - 70 - h, 70, VIEW_H - h - 10);
  const shout = text === text.toUpperCase();
  ctx.translate(head.x, by + h);
  ctx.scale(pop, pop);
  ctx.translate(-head.x, -(by + h));
  roundRect(ctx, bx, by, w, h, 14);
  ctx.moveTo(clamp(head.x - 10, bx + 12, bx + w - 30), by + h);
  ctx.lineTo(head.x, Math.min(head.y - 34, by + h + 26));
  ctx.lineTo(clamp(head.x + 12, bx + 30, bx + w - 12), by + h);
  ctx.fillStyle = shout ? "#fff2a8" : "#ffffff";
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  lines.forEach((l, i) => ctx.fillText(l, bx + w / 2, by + 9 + i * 24));
  ctx.restore();
}

/**
 * A small callout rising from the action ("PARRY!", "COUNTER!").
 *
 * @param ctx - Canvas with only the base transform.
 * @param text - Text.
 * @param at - Screen position.
 * @param u - Seconds since it appeared.
 * @param dur - Lifetime.
 * @param color - Fill colour.
 * @param fonts - Fonts.
 */
export function drawPopup(
  ctx: CanvasRenderingContext2D,
  text: string,
  at: Vec,
  u: number,
  dur: number,
  color: string,
  fonts: FightFonts,
): void {
  const k = u / dur;
  ctx.save();
  ctx.globalAlpha = 1 - smoothstep(0.7, 1, k);
  const s = 0.6 + ease("back", clamp(u / 0.15, 0, 1)) * 0.5;
  ctx.translate(at.x, at.y - 50 - k * 40);
  ctx.scale(s, s);
  ctx.rotate(-0.08);
  ctx.font = `34px ${fonts.display}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  outlinedText(ctx, text, 0, 0, color, 7);
  ctx.restore();
}

/**
 * The super: the stage goes dark behind the fighters (call before drawing them).
 *
 * @param ctx - Canvas with only the base transform.
 * @param k - 0..1 strength.
 * @param time - Real seconds.
 */
export function drawSuperDark(
  ctx: CanvasRenderingContext2D,
  k: number,
  time: number,
): void {
  ctx.fillStyle = `rgba(4, 8, 24, ${0.72 * k})`;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.save();
  ctx.globalAlpha = k;
  speedLines(
    ctx,
    VIEW_W / 2,
    VIEW_H / 2,
    time,
    "rgba(120, 200, 255, 0.25)",
    40,
  );
  ctx.restore();
}

/**
 * The super cut-in: a slanted band sweeping across with Staal's face and the move's name.
 *
 * @param ctx - Canvas with only the base transform.
 * @param text - The move's name.
 * @param u - Seconds since the super started.
 * @param dur - How long the freeze lasts.
 * @param fonts - Fonts.
 */
export function drawCutIn(
  ctx: CanvasRenderingContext2D,
  text: string,
  u: number,
  dur: number,
  fonts: FightFonts,
): void {
  const inK = ease("out", clamp(u / 0.25, 0, 1));
  const outK = smoothstep(dur - 0.3, dur, u);
  if (outK >= 1) return;
  const x = (1 - inK) * -VIEW_W + outK * VIEW_W;
  ctx.save();
  ctx.translate(x, 0);
  ctx.beginPath();
  ctx.moveTo(0, 170);
  ctx.lineTo(VIEW_W, 130);
  ctx.lineTo(VIEW_W, 300);
  ctx.lineTo(0, 340);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, 130, 0, 340);
  g.addColorStop(0, "#0e2a52");
  g.addColorStop(0.5, "#1f5fa8");
  g.addColorStop(1, "#0e2a52");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = "#8fe3ff";
  ctx.stroke();
  ctx.clip();
  ctx.save();
  ctx.translate(240 + u * 30, 250);
  ctx.scale(4.2, 4.2);
  drawStaalHead(ctx, "shout", "on");
  ctx.restore();
  ctx.font = `74px ${fonts.display}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const tg = ctx.createLinearGradient(0, 200, 0, 280);
  tg.addColorStop(0, "#ffffff");
  tg.addColorStop(1, "#8fe3ff");
  outlinedText(ctx, text, 400 - u * 20, 236, tg, 9);
  ctx.font = `18px ${fonts.hud}`;
  outlinedText(ctx, "SUPER", 408 - u * 20, 186, "#ffd24a", 4);
  ctx.restore();
}

/**
 * Cinematic bars for the slow-motion finisher.
 *
 * @param ctx - Canvas with only the base transform.
 * @param k - 0..1 how far in.
 */
export function drawLetterbox(ctx: CanvasRenderingContext2D, k: number): void {
  if (k <= 0) return;
  const h = 62 * ease("out", k);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, VIEW_W, h);
  ctx.fillRect(0, VIEW_H - h, VIEW_W, h);
}

/**
 * The slow-motion grade: colour drained, cooled and vignetted.
 *
 * @param ctx - Canvas with only the base transform.
 * @param k - 0..1 strength.
 */
export function drawSlowmoGrade(
  ctx: CanvasRenderingContext2D,
  k: number,
): void {
  if (k <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = "saturation";
  ctx.fillStyle = `rgba(128, 128, 128, ${0.65 * k})`;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = `rgba(30, 50, 110, ${0.18 * k})`;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const v = ctx.createRadialGradient(
    VIEW_W / 2,
    VIEW_H / 2,
    VIEW_H * 0.35,
    VIEW_W / 2,
    VIEW_H / 2,
    VIEW_W * 0.7,
  );
  v.addColorStop(0, "rgba(0, 0, 0, 0)");
  v.addColorStop(1, `rgba(0, 0, 10, ${0.6 * k})`);
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.restore();
}

/**
 * The closing card: the result and the stats.
 *
 * @param ctx - Canvas with only the base transform.
 * @param script - The fight.
 * @param u - Seconds since it appeared.
 * @param fonts - Fonts.
 */
export function drawEndCard(
  ctx: CanvasRenderingContext2D,
  script: FightScript,
  u: number,
  fonts: FightFonts,
): void {
  const k = ease("out", clamp(u / 0.5, 0, 1));
  ctx.save();
  ctx.fillStyle = `rgba(8, 4, 16, ${0.72 * k})`;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.globalAlpha = k;
  ctx.translate(0, (1 - k) * 30);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `78px ${fonts.display}`;
  const g = ctx.createLinearGradient(0, 70, 0, 150);
  g.addColorStop(0, "#fff6b0");
  g.addColorStop(1, "#ff9a1f");
  outlinedText(ctx, "STAAL WINT!", VIEW_W / 2, 140, g, 9);
  const rows: [string, string][] = [
    ["Langste combo", `${maxCombo(script, "staal")} hits`],
    ["Super", "Staalkracht"],
    ["Finisher", "Slow-motion uppercut"],
    ["Beloning", "1 koud biertje"],
  ];
  ctx.font = `26px ${fonts.display}`;
  rows.forEach(([label, value], i) => {
    const y = 210 + i * 40;
    ctx.textAlign = "right";
    outlinedText(ctx, label, VIEW_W / 2 - 16, y, "#8fe3ff", 5);
    ctx.textAlign = "left";
    outlinedText(ctx, value, VIEW_W / 2 + 16, y, "#ffffff", 5);
  });
  ctx.restore();
}
