import { seededRandom, type Vec } from "./math";
import type { BurstKind, HitKind } from "./script";
import { FLOOR_Y } from "./timeline";
import type { FighterId } from "./types";

type ParticleKind =
  | "streak"
  | "flare"
  | "ring"
  | "puff"
  | "drop"
  | "chunk"
  | "confetti"
  | "ember"
  | "text";

/** One particle. Everything is in world pixels and seconds. */
type Particle = {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  rot: number;
  vr: number;
  gravity: number;
  drag: number;
  color: string;
  additive: boolean;
  text?: string;
};

/** Spark colours: Staal's blows throw steel sparks, Trump's are hot orange. */
const PALETTE: Record<
  FighterId,
  { core: string; streak: string; ring: string }
> = {
  staal: { core: "#ffffff", streak: "#9fe8ff", ring: "#c9f5ff" },
  trump: { core: "#fff4d6", streak: "#ffb347", ring: "#ffd08a" },
};

const MAX_PARTICLES = 700;

/**
 * Particles, screen shake and flashes. Spawned from blows and bursts as the story reaches them,
 * advanced every frame. Seeded, so a replay looks the same.
 */
export class Effects {
  private particles: Particle[] = [];
  /** Current shake amplitude in pixels. */
  shake = 0;
  /** Current white-flash strength, 0..1. */
  flash = 0;

  /** @param calm - Reduced motion: no shake, softer flashes. */
  constructor(private readonly calm = false) {}

  /** Drops everything (replay). */
  reset(): void {
    this.particles = [];
    this.shake = 0;
    this.flash = 0;
  }

  private add(p: Partial<Particle> & Pick<Particle, "kind" | "x" | "y">): void {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push({
      vx: 0,
      vy: 0,
      life: 0.4,
      max: p.life ?? 0.4,
      size: 4,
      grow: 0,
      rot: 0,
      vr: 0,
      gravity: 0,
      drag: 0,
      color: "#fff",
      additive: false,
      ...p,
    });
  }

  /**
   * Adds screen shake.
   *
   * @param amount - Pixels.
   */
  kick(amount: number): void {
    if (!this.calm) this.shake = Math.max(this.shake, amount);
  }

  /**
   * Flashes the screen white.
   *
   * @param strength - 0..1.
   */
  flashScreen(strength: number): void {
    this.flash = Math.max(this.flash, this.calm ? strength * 0.25 : strength);
  }

  /**
   * The spark for a landed (or blocked) blow.
   *
   * @param kind - What kind of blow.
   * @param at - Where.
   * @param by - Who threw it (sets the colours).
   * @param dir - +1 if it travels right, -1 left.
   * @param seed - For repeatable randomness.
   */
  hit(kind: HitKind, at: Vec, by: FighterId, dir: number, seed: number): void {
    const rnd = seededRandom(seed * 7919);
    const pal =
      kind === "block" || kind === "parry" ? PALETTE.staal : PALETTE[by];
    const heavy =
      kind === "heavy" ||
      kind === "kick" ||
      kind === "super" ||
      kind === "projectile" ||
      kind === "whip";
    const size =
      kind === "super" ? 1.6 : heavy ? 1.2 : kind === "block" ? 0.6 : 0.85;

    this.add({
      kind: "flare",
      x: at.x,
      y: at.y,
      life: 0.16 + size * 0.05,
      size: 26 * size,
      grow: 60,
      rot: rnd() * Math.PI,
      color: pal.core,
      additive: true,
    });
    this.add({
      kind: "ring",
      x: at.x,
      y: at.y,
      life: 0.28,
      size: 8,
      grow: 240 * size,
      color: pal.ring,
      additive: true,
    });
    if (kind === "super" || kind === "parry") {
      this.add({
        kind: "ring",
        x: at.x,
        y: at.y,
        life: 0.45,
        size: 12,
        grow: 420,
        color: kind === "parry" ? "#8fe3ff" : "#ffe27a",
        additive: true,
      });
    }
    const n = Math.round(10 * size) + 4;
    for (let i = 0; i < n; i++) {
      const spread = (rnd() - 0.5) * Math.PI * 1.3;
      const a = (dir > 0 ? 0 : Math.PI) + spread + (rnd() < 0.25 ? Math.PI : 0);
      const sp = 380 + rnd() * 620 * size;
      this.add({
        kind: "streak",
        x: at.x,
        y: at.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 60,
        life: 0.14 + rnd() * 0.16,
        size: 1.5 + rnd() * 2.5 * size,
        drag: 5,
        gravity: 600,
        color: rnd() < 0.3 ? pal.core : pal.streak,
        additive: true,
      });
    }
    if (heavy && by === "staal") {
      for (let i = 0; i < 5; i++) {
        this.add({
          kind: "drop",
          x: at.x,
          y: at.y - 8,
          vx: dir * (80 + rnd() * 160),
          vy: -160 - rnd() * 180,
          life: 0.6,
          size: 2.5 + rnd() * 2,
          gravity: 900,
          color: "rgba(210, 240, 255, 0.9)",
        });
      }
    }
    if (kind !== "block") this.kick(heavy ? 7 * size : 3);
  }

  /**
   * A one-off burst: dust, beer foam, splinters, a burp, confetti, embers or a sparkle.
   *
   * @param fx - Which burst.
   * @param at - Where.
   * @param seed - For repeatable randomness.
   */
  burst(fx: BurstKind, at: Vec, seed: number): void {
    const rnd = seededRandom(seed * 104729);
    switch (fx) {
      case "dust":
        for (let i = 0; i < 12; i++) {
          this.add({
            kind: "puff",
            x: at.x + (rnd() - 0.5) * 40,
            y: Math.min(at.y, FLOOR_Y) + (rnd() - 0.5) * 8,
            vx: (rnd() - 0.5) * 220,
            vy: -30 - rnd() * 60,
            life: 0.6 + rnd() * 0.4,
            size: 8 + rnd() * 10,
            grow: 30,
            drag: 3,
            color: "rgba(214, 170, 140, 0.55)",
          });
        }
        break;
      case "foam":
        for (let i = 0; i < 26; i++) {
          this.add({
            kind: "drop",
            x: at.x,
            y: at.y - 14,
            vx: (rnd() - 0.4) * 180,
            vy: -150 - rnd() * 260,
            life: 0.9 + rnd() * 0.4,
            size: 2 + rnd() * 3.5,
            gravity: 700,
            color:
              rnd() < 0.7
                ? "rgba(255, 252, 240, 0.95)"
                : "rgba(255, 214, 110, 0.9)",
          });
        }
        break;
      case "debris":
        for (let i = 0; i < 18; i++) {
          const glass = rnd() < 0.35;
          this.add({
            kind: "chunk",
            x: at.x + (rnd() - 0.5) * 30,
            y: at.y + (rnd() - 0.5) * 30,
            vx: (rnd() - 0.6) * 520,
            vy: -200 - rnd() * 360,
            life: 1.4,
            size: glass ? 4 + rnd() * 3 : 6 + rnd() * 9,
            rot: rnd() * Math.PI,
            vr: (rnd() - 0.5) * 20,
            gravity: 1100,
            color: glass
              ? "rgba(170, 240, 220, 0.9)"
              : rnd() < 0.5
                ? "#8a5431"
                : "#b07644",
          });
        }
        break;
      case "burp":
        this.add({
          kind: "text",
          x: at.x + 18,
          y: at.y - 10,
          vx: 30,
          vy: -50,
          life: 1.1,
          size: 20,
          color: "#fff4c2",
          text: "BOERP!",
        });
        for (let i = 0; i < 6; i++) {
          this.add({
            kind: "puff",
            x: at.x + 10,
            y: at.y,
            vx: 30 + rnd() * 40,
            vy: -20 - rnd() * 30,
            life: 0.8,
            size: 5 + rnd() * 5,
            grow: 18,
            drag: 2,
            color: "rgba(230, 245, 210, 0.45)",
          });
        }
        break;
      case "confetti":
        for (let i = 0; i < 90; i++) {
          const colors = [
            "#e0162b",
            "#ffffff",
            "#ffd24a",
            "#8fe3ff",
            "#f35ea8",
          ];
          this.add({
            kind: "confetti",
            x: at.x + (rnd() - 0.5) * 900,
            y: at.y - rnd() * 120,
            vx: (rnd() - 0.5) * 80,
            vy: 60 + rnd() * 90,
            life: 3.2 + rnd(),
            size: 4 + rnd() * 4,
            rot: rnd() * Math.PI,
            vr: (rnd() - 0.5) * 12,
            color: colors[Math.floor(rnd() * colors.length)],
          });
        }
        break;
      case "embers":
        for (let i = 0; i < 30; i++) {
          this.add({
            kind: "ember",
            x: at.x + (rnd() - 0.5) * 90,
            y: at.y + 40 + (rnd() - 0.5) * 60,
            vx: (rnd() - 0.5) * 40,
            vy: -120 - rnd() * 160,
            life: 0.8 + rnd() * 0.6,
            size: 2 + rnd() * 2.5,
            color: rnd() < 0.5 ? "#9fe8ff" : "#ffffff",
            additive: true,
          });
        }
        break;
      case "sparkle":
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          this.add({
            kind: "streak",
            x: at.x,
            y: at.y,
            vx: Math.cos(a) * 260,
            vy: Math.sin(a) * 260,
            life: 0.25,
            size: 2,
            drag: 6,
            color: "#fff6c9",
            additive: true,
          });
        }
        this.add({
          kind: "flare",
          x: at.x,
          y: at.y,
          life: 0.2,
          size: 18,
          grow: 40,
          color: "#fff6c9",
          additive: true,
        });
        break;
    }
  }

  /**
   * Advances everything.
   *
   * @param dt - Effect seconds (slowed in slow motion).
   * @param realDt - Real seconds (shake and flash decay in real time).
   */
  update(dt: number, realDt: number): void {
    for (const p of this.particles) {
      p.life -= dt;
      p.vx *= Math.exp(-p.drag * dt);
      p.vy *= Math.exp(-p.drag * dt);
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.size += p.grow * dt;
      p.rot += p.vr * dt;
      if (p.kind === "confetti") p.x += Math.sin(p.rot * 2) * 30 * dt;
      if ((p.kind === "chunk" || p.kind === "drop") && p.y > FLOOR_Y + 6) {
        p.y = FLOOR_Y + 6;
        p.vy *= -0.35;
        p.vx *= 0.6;
      }
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    this.shake *= Math.exp(-realDt * 11);
    this.flash *= Math.exp(-realDt * 9);
    if (this.shake < 0.05) this.shake = 0;
    if (this.flash < 0.01) this.flash = 0;
  }

  /**
   * The current shake offset.
   *
   * @param time - Real seconds (drives the jitter).
   * @returns Offset in screen pixels.
   */
  shakeOffset(time: number): Vec {
    if (this.shake === 0) return { x: 0, y: 0 };
    return {
      x: Math.sin(time * 91) * this.shake,
      y: Math.cos(time * 77) * this.shake * 0.7,
    };
  }

  /**
   * Draws every particle.
   *
   * @param ctx - Canvas with the camera transform applied.
   * @param display - Font for text particles.
   */
  draw(ctx: CanvasRenderingContext2D, display: string): void {
    for (const p of this.particles) {
      const k = Math.max(0, p.life / p.max);
      ctx.save();
      ctx.globalCompositeOperation = p.additive ? "lighter" : "source-over";
      ctx.globalAlpha =
        p.kind === "confetti" || p.kind === "chunk" ? Math.min(1, k * 3) : k;
      switch (p.kind) {
        case "streak": {
          const len = 0.035;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.size;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * len, p.y - p.vy * len);
          ctx.stroke();
          break;
        }
        case "flare": {
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
          g.addColorStop(0, p.color);
          g.addColorStop(0.3, p.color);
          g.addColorStop(1, "rgba(255,255,255,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          for (let i = 0; i < 16; i++) {
            const a = p.rot + (i * Math.PI) / 8;
            const r = i % 2 === 0 ? p.size : p.size * 0.35;
            const x = p.x + Math.cos(a) * r;
            const y = p.y + Math.sin(a) * r;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.fill();
          break;
        }
        case "ring":
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 2 + 6 * k;
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, p.size, p.size * 0.8, 0, 0, Math.PI * 2);
          ctx.stroke();
          break;
        case "puff":
        case "drop":
        case "ember":
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(0.5, p.size), 0, Math.PI * 2);
          ctx.fill();
          break;
        case "chunk":
        case "confetti":
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          break;
        case "text":
          ctx.font = `${p.size}px ${display}`;
          ctx.textAlign = "center";
          ctx.lineWidth = 4;
          ctx.strokeStyle = "#1b0f14";
          ctx.strokeText(p.text ?? "", p.x, p.y);
          ctx.fillStyle = p.color;
          ctx.fillText(p.text ?? "", p.x, p.y);
          break;
      }
      ctx.restore();
    }
  }
}
