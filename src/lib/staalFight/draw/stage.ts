import { seededRandom } from "../math";
import { FLOOR_Y } from "../timeline";
import { INK, inked, roundRect } from "./shapes";

/** Virtual canvas size: everything is authored at 960×540 and scaled to the screen. */
export const VIEW_W = 960;
export const VIEW_H = 540;

/** World extent the camera may show. */
export const WORLD_W = 1600;

/** Horizon line (screen y at zoom 1). */
const HORIZON = 330;
/** Back edge of the boardwalk. */
const DECK_TOP = 418;

/** Where the camera looks: world centre and zoom. */
export type Camera = { x: number; y: number; zoom: number };

/** An offscreen layer, rendered once. */
function layer(
  w: number,
  h: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  paint(ctx);
  return canvas;
}

/** Sunset sky with a striped retro sun and pink cloud bands. */
function paintSky(ctx: CanvasRenderingContext2D): void {
  const g = ctx.createLinearGradient(0, 0, 0, HORIZON);
  g.addColorStop(0, "#1a0b3b");
  g.addColorStop(0.32, "#551a6f");
  g.addColorStop(0.6, "#c2306b");
  g.addColorStop(0.82, "#ff7a50");
  g.addColorStop(1, "#ffc56b");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const rnd = seededRandom(7);
  ctx.fillStyle = "rgba(255, 240, 255, 0.8)";
  for (let i = 0; i < 60; i++) {
    const x = rnd() * VIEW_W;
    const y = rnd() * 120;
    ctx.globalAlpha = 0.2 + rnd() * 0.6;
    ctx.fillRect(x, y, 1.5, 1.5);
  }
  ctx.globalAlpha = 1;

  // Retro sun, cut by horizontal stripes.
  const sx = 610;
  const sy = HORIZON - 70;
  const sr = 96;
  const sg = ctx.createLinearGradient(0, sy - sr, 0, sy + sr);
  sg.addColorStop(0, "#fff3a3");
  sg.addColorStop(0.55, "#ff9f5a");
  sg.addColorStop(1, "#ff4f7b");
  ctx.save();
  ctx.beginPath();
  ctx.arc(sx, sy, sr, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = sg;
  ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
  ctx.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 7; i++) {
    const y = sy - 10 + i * 13;
    ctx.fillRect(sx - sr, y, sr * 2, 2 + i * 1.2);
  }
  ctx.restore();
  const glow = ctx.createRadialGradient(sx, sy, sr * 0.6, sx, sy, sr * 2.6);
  glow.addColorStop(0, "rgba(255, 170, 110, 0.35)");
  glow.addColorStop(1, "rgba(255, 120, 120, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, VIEW_W, HORIZON);

  // Cloud bands.
  for (let i = 0; i < 9; i++) {
    const y = 60 + rnd() * 200;
    const x = rnd() * VIEW_W;
    const w = 120 + rnd() * 260;
    const h = 5 + rnd() * 9;
    ctx.fillStyle =
      y < 150 ? "rgba(190, 90, 170, 0.45)" : "rgba(255, 150, 160, 0.4)";
    roundRect(ctx, x - w / 2, y, w, h, h / 2);
    ctx.fill();
  }
}

/** Skyline, ferris wheel and far palms along the horizon: a wide strip for parallax. */
function paintCity(ctx: CanvasRenderingContext2D, w: number): void {
  const rnd = seededRandom(21);
  // Back row.
  for (let x = 0; x < w;) {
    const bw = 30 + rnd() * 50;
    const bh = 40 + rnd() * 110;
    ctx.fillStyle = "#6a2a78";
    ctx.fillRect(x, HORIZON - bh, bw, bh);
    x += bw + rnd() * 10;
  }
  // Front row with lit windows.
  for (let x = 0; x < w;) {
    const bw = 34 + rnd() * 56;
    const bh = 30 + rnd() * 150;
    ctx.fillStyle = "#3f1553";
    ctx.fillRect(x, HORIZON - bh, bw, bh);
    if (rnd() < 0.4) {
      ctx.fillStyle = "#3f1553";
      ctx.fillRect(x + bw / 2 - 2, HORIZON - bh - 18, 4, 18);
    }
    for (let wy = HORIZON - bh + 8; wy < HORIZON - 8; wy += 9) {
      for (let wx = x + 5; wx < x + bw - 5; wx += 8) {
        if (rnd() < 0.32) {
          ctx.fillStyle = rnd() < 0.7 ? "#ffcf7a" : "#ff8fc2";
          ctx.fillRect(wx, wy, 3, 4);
        }
      }
    }
    x += bw + 4 + rnd() * 14;
  }
  // Ferris wheel on the left, as on the splash art.
  const fx = 260;
  const fy = HORIZON - 70;
  ctx.strokeStyle = "rgba(255, 170, 220, 0.85)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(fx, fy, 58, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(fx + Math.cos(a) * 58, fy + Math.sin(a) * 58);
    ctx.stroke();
    ctx.fillStyle = "#ffd6ef";
    ctx.beginPath();
    ctx.arc(fx + Math.cos(a) * 58, fy + Math.sin(a) * 58, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(fx - 30, HORIZON);
  ctx.lineTo(fx, fy);
  ctx.lineTo(fx + 30, HORIZON);
  ctx.stroke();
  // Far palms.
  for (const px of [90, 520, 880, 1180, 1420])
    palm(ctx, px, HORIZON + 4, 0.55, "#2b0f3d");
}

/**
 * A palm tree silhouette.
 *
 * @param ctx - Canvas.
 * @param x - Foot of the trunk.
 * @param y - Ground line.
 * @param s - Scale.
 * @param color - Fill.
 */
function palm(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 14;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(30, -150, 10, -300);
  ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI / 2 + (i - 3.5) * 0.42;
    const len = 130 + (i % 3) * 20;
    ctx.beginPath();
    ctx.moveTo(10, -300);
    const ex = 10 + Math.cos(a) * len;
    const ey = -300 + Math.sin(a) * len * 0.55 + 50;
    ctx.quadraticCurveTo(10 + Math.cos(a) * len * 0.5, -330, ex, ey);
    ctx.quadraticCurveTo(10 + Math.cos(a) * len * 0.45, -306, 10, -296);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * The stage: sky and skyline pre-rendered once, sea, boardwalk, crowd and beach bar drawn live.
 */
export class Stage {
  private sky: HTMLCanvasElement | null = null;
  private city: HTMLCanvasElement | null = null;
  private readonly cityW = 1500;

  private ensure(): void {
    if (!this.sky) this.sky = layer(VIEW_W, VIEW_H, paintSky);
    if (!this.city)
      this.city = layer(this.cityW, VIEW_H, (c) => paintCity(c, this.cityW));
  }

  /**
   * Draws a parallax layer: `depth` 0 is fixed to the screen, 1 moves with the world.
   *
   * @param ctx - Canvas with only the base (virtual → device) transform.
   * @param cam - Camera.
   * @param depth - Parallax factor.
   * @param paint - Draws the layer in its own coordinates.
   */
  private parallax(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    depth: number,
    paint: () => void,
  ): void {
    const zoom = 1 + (cam.zoom - 1) * depth;
    ctx.save();
    ctx.translate(VIEW_W / 2, VIEW_H / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(
      -VIEW_W / 2 - (cam.x - VIEW_W / 2) * depth,
      -VIEW_H / 2 - (cam.y - VIEW_H / 2) * depth,
    );
    paint();
    ctx.restore();
  }

  /**
   * Draws everything behind the fighters that does not move with the world.
   *
   * @param ctx - Canvas with only the base transform.
   * @param cam - Camera.
   * @param time - Real seconds (shimmer).
   */
  drawBackdrop(ctx: CanvasRenderingContext2D, cam: Camera, time: number): void {
    this.ensure();
    this.parallax(ctx, cam, 0.05, () => {
      if (this.sky)
        ctx.drawImage(this.sky, -60, -40, VIEW_W + 120, VIEW_H + 40);
    });
    this.parallax(ctx, cam, 0.3, () => {
      if (this.city) ctx.drawImage(this.city, -270, 0);
      // Sea with the sun's reflection.
      const g = ctx.createLinearGradient(0, HORIZON, 0, DECK_TOP + 40);
      g.addColorStop(0, "#8a3a86");
      g.addColorStop(0.5, "#4e2170");
      g.addColorStop(1, "#27124a");
      ctx.fillStyle = g;
      ctx.fillRect(-400, HORIZON, 2400, DECK_TOP + 200 - HORIZON);
      for (let i = 0; i < 14; i++) {
        const y = HORIZON + 5 + i * 7;
        const w = 120 - i * 5 + Math.sin(time * 2 + i) * 12;
        ctx.fillStyle = `rgba(255, 190, 140, ${0.5 - i * 0.03})`;
        ctx.fillRect(610 - w / 2 + Math.sin(time * 1.3 + i * 2) * 6, y, w, 2);
      }
      ctx.fillStyle = "rgba(255, 200, 240, 0.25)";
      for (let i = 0; i < 40; i++) {
        const x = ((i * 97 + time * 12) % 1900) - 300;
        const y = HORIZON + 8 + ((i * 37) % 80);
        ctx.fillRect(x, y, 14, 1.5);
      }
    });
  }

  /**
   * Draws the world-space set behind the fighters: palms, crowd, railing, bar and boardwalk.
   *
   * @param ctx - Canvas with the camera transform applied.
   * @param time - Real seconds.
   * @param hype - 0..1, how hard the crowd is going.
   * @param barHit - Seconds since Trump crashed into the bar, or null.
   */
  drawSet(
    ctx: CanvasRenderingContext2D,
    time: number,
    hype: number,
    barHit: number | null,
  ): void {
    for (const x of [140, 760, 1300])
      palm(ctx, x, DECK_TOP - 6, 1.05, "#1d0a2c");
    this.drawCrowd(ctx, time, hype);
    // Boardwalk.
    const deck = ctx.createLinearGradient(0, DECK_TOP, 0, 640);
    deck.addColorStop(0, "#7d4a2c");
    deck.addColorStop(0.3, "#9a5e38");
    deck.addColorStop(1, "#5b331f");
    ctx.fillStyle = deck;
    ctx.fillRect(-200, DECK_TOP, WORLD_W + 400, 640 - DECK_TOP);
    ctx.strokeStyle = "rgba(40, 18, 10, 0.55)";
    ctx.lineWidth = 2;
    for (let i = 0, y = DECK_TOP; y < 640; i++) {
      ctx.beginPath();
      ctx.moveTo(-200, y);
      ctx.lineTo(WORLD_W + 200, y);
      ctx.stroke();
      const step = 9 + i * 3;
      for (
        let x = -200 + ((i * 53) % 120);
        x < WORLD_W + 200;
        x += 170 + i * 20
      ) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + step);
        ctx.stroke();
      }
      y += step;
    }
    ctx.fillStyle = "rgba(255, 170, 120, 0.12)";
    ctx.fillRect(-200, DECK_TOP, WORLD_W + 400, 5);
    // Railing along the back edge.
    ctx.strokeStyle = "#4a2616";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-200, DECK_TOP - 34);
    ctx.lineTo(WORLD_W + 200, DECK_TOP - 34);
    ctx.stroke();
    for (let x = -180; x < WORLD_W + 200; x += 80) {
      ctx.fillStyle = "#5a2f1c";
      ctx.fillRect(x, DECK_TOP - 36, 7, 38);
    }
    this.drawBar(ctx, time, barHit);
    this.drawLights(ctx, time);
  }

  /** The crowd behind the railing: silhouettes that jump when it gets good. */
  private drawCrowd(
    ctx: CanvasRenderingContext2D,
    time: number,
    hype: number,
  ): void {
    const rnd = seededRandom(99);
    for (let i = 0; i < 46; i++) {
      const x = -120 + i * 30 + rnd() * 14;
      if (x > 1380) break;
      const tall = 0.8 + rnd() * 0.4;
      const phase = rnd() * Math.PI * 2;
      const jump = hype * Math.max(0, Math.sin(time * 9 + phase)) * 14;
      const bob = Math.sin(time * 2 + phase) * 1.5;
      const y = DECK_TOP - 30 - jump + bob;
      const shirt =
        rnd() < 0.35 ? "#a3122a" : rnd() < 0.5 ? "#2c1238" : "#3c1a4a";
      ctx.fillStyle = shirt;
      roundRect(ctx, x - 11 * tall, y - 34 * tall, 22 * tall, 40 * tall, 8);
      ctx.fill();
      ctx.fillStyle = "#2a1030";
      ctx.beginPath();
      ctx.arc(x, y - 44 * tall, 9 * tall, 0, Math.PI * 2);
      ctx.fill();
      if (hype > 0.2 && rnd() < 0.6) {
        ctx.strokeStyle = shirt;
        ctx.lineWidth = 5;
        ctx.lineCap = "round";
        const wave = Math.sin(time * 10 + phase) * 0.4;
        ctx.beginPath();
        ctx.moveTo(x - 8, y - 28 * tall);
        ctx.lineTo(x - 16 + wave * 8, y - 56 * tall);
        ctx.moveTo(x + 8, y - 28 * tall);
        ctx.lineTo(x + 16 - wave * 8, y - 56 * tall);
        ctx.stroke();
        ctx.lineCap = "butt";
      }
    }
  }

  /** The beach bar at the far right, with the H3 neon sign. Shakes when hit. */
  private drawBar(
    ctx: CanvasRenderingContext2D,
    time: number,
    barHit: number | null,
  ): void {
    const jolt =
      barHit !== null && barHit < 0.8
        ? Math.sin(barHit * 60) * 6 * (1 - barHit / 0.8)
        : 0;
    ctx.save();
    ctx.translate(jolt, 0);
    const x0 = 1440;
    // Posts.
    ctx.fillStyle = "#4a2616";
    for (const x of [x0 + 10, x0 + 150])
      ctx.fillRect(x, 200, 14, FLOOR_Y - 190);
    // Thatched roof.
    ctx.beginPath();
    ctx.moveTo(x0 - 50, 215);
    ctx.lineTo(x0 + 90, 150);
    ctx.lineTo(x0 + 240, 215);
    ctx.closePath();
    inked(ctx, "#b7803e");
    ctx.strokeStyle = "rgba(90, 50, 20, 0.6)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 14; i++) {
      ctx.beginPath();
      ctx.moveTo(x0 - 40 + i * 20, 215);
      ctx.lineTo(x0 + 90, 156);
      ctx.stroke();
    }
    // Shelf with bottles.
    ctx.fillStyle = "#5a2f1c";
    ctx.fillRect(x0 + 20, 300, 140, 8);
    const colors = ["#2f7a4a", "#8a4a1c", "#c9a24a", "#3a5f8f", "#7a1f2b"];
    for (let i = 0; i < 7; i++) {
      const bx = x0 + 28 + i * 18;
      ctx.fillStyle = colors[i % colors.length];
      roundRect(ctx, bx, 268, 10, 32, 3);
      ctx.fill();
      ctx.fillRect(bx + 3, 258, 4, 12);
    }
    // Neon H3 sign.
    const flicker =
      0.85 +
      Math.sin(time * 23) * 0.05 +
      (Math.sin(time * 3.1) > 0.97 ? -0.4 : 0);
    ctx.save();
    ctx.shadowColor = "#ff2a4a";
    ctx.shadowBlur = 18 * flicker;
    ctx.font = "bold 44px Impact, 'Arial Black', sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = `rgba(255, 60, 80, ${flicker})`;
    ctx.fillText("H", x0 + 70, 250);
    ctx.shadowColor = "#ffffff";
    ctx.fillStyle = `rgba(255, 255, 255, ${flicker})`;
    ctx.fillText("3", x0 + 100, 250);
    ctx.restore();
    // Counter.
    const cg = ctx.createLinearGradient(0, 360, 0, FLOOR_Y);
    cg.addColorStop(0, "#8a5431");
    cg.addColorStop(1, "#5a331d");
    roundRect(ctx, x0 - 10, 360, 200, FLOOR_Y - 360 + 4, 4);
    inked(ctx, cg);
    ctx.fillStyle = "#b07644";
    ctx.fillRect(x0 - 16, 354, 212, 10);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.strokeRect(x0 - 16, 354, 212, 10);
    ctx.restore();
  }

  /** String lights from the bar roof to a palm, gently twinkling. */
  private drawLights(ctx: CanvasRenderingContext2D, time: number): void {
    const a = { x: 1440, y: 214 };
    const b = { x: 800, y: 150 };
    ctx.strokeStyle = "rgba(30, 10, 20, 0.8)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo((a.x + b.x) / 2, 250, b.x, b.y);
    ctx.stroke();
    for (let i = 1; i < 16; i++) {
      const u = i / 16;
      const x =
        (1 - u) * (1 - u) * a.x +
        2 * (1 - u) * u * ((a.x + b.x) / 2) +
        u * u * b.x;
      const y = (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * 250 + u * u * b.y;
      const on = 0.7 + Math.sin(time * 3 + i * 1.3) * 0.3;
      const g = ctx.createRadialGradient(x, y + 5, 0, x, y + 5, 14);
      g.addColorStop(0, `rgba(255, 230, 160, ${on})`);
      g.addColorStop(1, "rgba(255, 200, 120, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y + 5, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255, 245, 210, ${on})`;
      ctx.beginPath();
      ctx.arc(x, y + 5, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
