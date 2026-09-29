import { Effects } from "./effects";
import { clamp, lerp, smoothstep, type Vec } from "./math";
import { RIGS, limbPoint } from "./rig";
import type { Cue, FightScript } from "./script";
import {
  anchorAt,
  fighterAt,
  projectileAt,
  toWorld,
  type FighterState,
} from "./timeline";
import {
  drawAura,
  drawFigure,
  drawGhosts,
  drawShadow,
  drawStars,
} from "./draw/fighter";
import { drawCombo, drawHud } from "./draw/hud";
import {
  drawBanner,
  drawBubble,
  drawCutIn,
  drawEndCard,
  drawLetterbox,
  drawPopup,
  drawSlowmoGrade,
  drawSuperDark,
  drawVersus,
} from "./draw/overlays";
import { inked, roundRect, type FightFonts } from "./draw/shapes";
import { drawCan } from "./draw/staal";
import { Stage, VIEW_H, VIEW_W, WORLD_W, type Camera } from "./draw/stage";

/** What a frame needs beyond the story time. */
export type FrameInfo = {
  /** Story seconds. */
  story: number;
  /** Real seconds since the start (drives shimmer, flicker, shake). */
  real: number;
  /** 0..1 strength of the slow-motion grade. */
  slowmo: number;
  /** Device pixels per virtual pixel. */
  pixelScale: number;
};

/** Moves during which Trump is the one attacking, so he is drawn in front. */
const TRUMP_ATTACKS = new Set(["slap", "point", "windmill", "tieWhip"]);

/** Draws the fight: stage, fighters, effects and every overlay. */
export class FightScene {
  private readonly stage = new Stage();
  /** Particles, shake and flash; the player spawns into it. */
  readonly effects: Effects;
  private readonly splatAt: number | null;
  private readonly cues: {
    banner: Extract<Cue, { kind: "banner" }>[];
    bubble: Extract<Cue, { kind: "bubble" }>[];
    popup: Extract<Cue, { kind: "popup" }>[];
    cam: Extract<Cue, { kind: "cam" }>[];
    hype: Extract<Cue, { kind: "hype" }>[];
    superFreeze: Extract<Cue, { kind: "superFreeze" }>[];
    letterbox: Extract<Cue, { kind: "letterbox" }>[];
    endCard: Extract<Cue, { kind: "endCard" }>[];
  };

  /**
   * @param script - The fight.
   * @param fonts - Fonts to draw text with.
   * @param calm - Reduced motion: no shake, soft flashes.
   */
  constructor(
    readonly script: FightScript,
    private fonts: FightFonts,
    calm = false,
  ) {
    this.effects = new Effects(calm);
    const splat = script.clips.find((c) => c.move === "wallSplat");
    this.splatAt = splat ? splat.t : null;
    const of = <K extends Cue["kind"]>(kind: K) =>
      script.cues.filter(
        (c): c is Extract<Cue, { kind: K }> => c.kind === kind,
      );
    this.cues = {
      banner: of("banner"),
      bubble: of("bubble"),
      popup: of("popup"),
      cam: of("cam"),
      hype: of("hype"),
      superFreeze: of("superFreeze"),
      letterbox: of("letterbox"),
      endCard: of("endCard"),
    };
  }

  /** Swaps in fonts once they have loaded. */
  setFonts(fonts: FightFonts): void {
    this.fonts = fonts;
  }

  /**
   * Where the camera looks: the fighters' midpoint by default, zoomed in when they are close,
   * raised for aerial combos, and steered by camera cues.
   *
   * @param t - Story seconds.
   * @param staal - Staal's state.
   * @param trump - Trump's state.
   * @returns The camera.
   */
  camera(t: number, staal: FighterState, trump: FighterState): Camera {
    const dist = Math.abs(staal.x - trump.x);
    let zoom = clamp(1.14 - Math.max(0, dist - 140) / 1000, 1, 1.14);
    let x = (staal.x + trump.x) / 2;
    let y = 270 - Math.max(0, Math.max(staal.y, trump.y) - 80) * 0.45;
    for (const c of this.cues.cam) {
      if (t < c.t || t > c.t + c.dur) continue;
      const w =
        smoothstep(c.t, c.t + c.ramp, t) *
        (1 - smoothstep(c.t + c.dur - c.ramp, c.t + c.dur, t));
      let focus: Vec;
      if (c.focus === "mid") focus = { x, y };
      else if (typeof c.focus === "string") {
        const s = c.focus === "staal" ? staal : trump;
        const chest = toWorld(s, limbPoint(s.joints, RIGS[s.id], "chest"));
        focus = { x: chest.x, y: chest.y - 20 };
      } else focus = c.focus;
      x = lerp(x, focus.x, w);
      y = lerp(y, focus.y, w);
      zoom = lerp(zoom, c.zoom, w);
    }
    const hw = VIEW_W / 2 / zoom;
    const hh = VIEW_H / 2 / zoom;
    return {
      x: clamp(x, hw, WORLD_W - hw),
      y: clamp(y, hh - 60, 640 - hh),
      zoom,
    };
  }

  /** How loud the crowd is, 0..1. */
  private hype(t: number): number {
    let h = 0.12;
    for (const c of this.cues.hype) {
      if (t < c.t) continue;
      const end = c.t + c.dur;
      h = Math.max(h, t < end ? 1 : 1 - (t - end) / 0.6);
    }
    return clamp(h, 0, 1);
  }

  /** 0..1 strength of the super's darkening, and its cue. */
  private superAt(t: number): {
    k: number;
    cue: Extract<Cue, { kind: "superFreeze" }> | null;
  } {
    for (const c of this.cues.superFreeze) {
      if (t >= c.t && t <= c.t + c.dur)
        return {
          k:
            smoothstep(c.t, c.t + 0.15, t) *
            (1 - smoothstep(c.t + c.dur - 0.25, c.t + c.dur, t)),
          cue: c,
        };
    }
    return { k: 0, cue: null };
  }

  /** Draws the projectiles in flight, with a short glowing trail. */
  private drawProjectiles(ctx: CanvasRenderingContext2D, t: number): void {
    for (const p of this.script.projectiles) {
      const now = projectileAt(this.script, p.id, t);
      if (!now) continue;
      if (p.kind === "ontslagen") {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        for (let i = 4; i >= 1; i--) {
          const past = projectileAt(
            this.script,
            p.id,
            Math.max(p.t0, t - i * 0.025),
          );
          if (!past) continue;
          const g = ctx.createRadialGradient(
            past.pos.x,
            past.pos.y,
            0,
            past.pos.x,
            past.pos.y,
            34,
          );
          g.addColorStop(0, `rgba(255, 210, 90, ${0.35 - i * 0.06})`);
          g.addColorStop(1, "rgba(255, 150, 60, 0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(past.pos.x, past.pos.y, 34, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        ctx.save();
        ctx.translate(now.pos.x, now.pos.y);
        ctx.rotate(now.angle + Math.sin(t * 20) * 0.1);
        const g = ctx.createLinearGradient(0, -16, 0, 16);
        g.addColorStop(0, "#fff3b0");
        g.addColorStop(1, "#e3a520");
        roundRect(ctx, -44, -16, 88, 32, 6);
        inked(ctx, g, 3);
        ctx.font = `17px ${this.fonts.display}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#a3122a";
        ctx.fillText("ONTSLAGEN!", 0, 1);
        ctx.restore();
      } else {
        drawCan(
          ctx,
          now.pos,
          now.angle,
          p.kind === "canToss" ? "crushed" : "closed",
          1.4,
        );
      }
    }
  }

  /**
   * Draws one frame.
   *
   * @param ctx - The canvas context (any transform; it is reset).
   * @param f - Frame timing and scale.
   */
  render(ctx: CanvasRenderingContext2D, f: FrameInfo): void {
    const { story: t, real } = f;
    const script = this.script;
    ctx.setTransform(f.pixelScale, 0, 0, f.pixelScale, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    if (t < script.vsEnd) {
      drawVersus(ctx, t, script.vsEnd, real, this.fonts);
      return;
    }

    const staal = fighterAt(script, "staal", t);
    const trump = fighterAt(script, "trump", t);
    const cam = this.camera(t, staal, trump);
    const shake = this.effects.shakeOffset(real);
    const world = (): void => {
      ctx.translate(VIEW_W / 2 + shake.x, VIEW_H / 2 + shake.y);
      ctx.scale(cam.zoom, cam.zoom);
      ctx.translate(-cam.x, -cam.y);
    };
    const toScreen = (p: Vec): Vec => ({
      x: (p.x - cam.x) * cam.zoom + VIEW_W / 2 + shake.x,
      y: (p.y - cam.y) * cam.zoom + VIEW_H / 2 + shake.y,
    });

    this.stage.drawBackdrop(ctx, cam, real);
    ctx.save();
    world();
    this.stage.drawSet(
      ctx,
      real,
      this.hype(t),
      this.splatAt !== null && t >= this.splatAt ? t - this.splatAt : null,
    );
    ctx.restore();

    const sup = this.superAt(t);
    if (sup.k > 0) drawSuperDark(ctx, sup.k, real);

    ctx.save();
    world();
    drawShadow(ctx, staal);
    drawShadow(ctx, trump);
    const trumpFront = Boolean(
      trump.clip &&
      TRUMP_ATTACKS.has(trump.clip.move) &&
      t <= trump.clip.t + trump.clip.dur,
    );
    const order = trumpFront ? [staal, trump] : [trump, staal];
    for (const s of order) {
      if (s.aura) drawAura(ctx, s, real);
      if (s.ghost) drawGhosts(ctx, script, s, t, real, f.pixelScale * cam.zoom);
      drawFigure(ctx, s, real);
      if (s.props.stars) drawStars(ctx, s, real);
    }
    this.drawProjectiles(ctx, t);
    this.effects.draw(ctx, this.fonts.display);
    ctx.restore();

    drawSlowmoGrade(ctx, f.slowmo);
    for (const c of this.cues.letterbox) {
      if (t >= c.t && t <= c.t + c.dur + 0.3)
        drawLetterbox(
          ctx,
          clamp((t - c.t) / 0.2, 0, 1) *
            (1 - clamp((t - c.t - c.dur) / 0.3, 0, 1)),
        );
    }

    for (const c of this.cues.bubble) {
      if (t < c.t || t > c.t + c.dur) continue;
      const s = c.who === "staal" ? staal : trump;
      drawBubble(
        ctx,
        c.text,
        toScreen(toWorld(s, s.joints.head)),
        t - c.t,
        c.dur,
        this.fonts,
      );
    }
    for (const c of this.cues.popup) {
      if (t < c.t || t > c.t + c.dur) continue;
      drawPopup(
        ctx,
        c.text,
        toScreen(anchorAt(script, c.at, c.t)),
        t - c.t,
        c.dur,
        c.color,
        this.fonts,
      );
    }

    const end = this.cues.endCard[0];
    const hudAlpha =
      smoothstep(script.vsEnd, script.vsEnd + 0.6, t) *
      (end ? 1 - smoothstep(end.t, end.t + 0.4, t) : 1);
    drawHud(ctx, script, t, real, this.fonts, hudAlpha);
    drawCombo(ctx, script, t, this.fonts);
    for (const c of this.cues.banner) {
      if (t >= c.t && t <= c.t + c.dur)
        drawBanner(ctx, c.text, c.style, t - c.t, c.dur, this.fonts);
    }
    if (sup.cue)
      drawCutIn(ctx, sup.cue.text, t - sup.cue.t, sup.cue.dur, this.fonts);

    const intro = 1 - smoothstep(script.vsEnd, script.vsEnd + 0.35, t);
    const flash = Math.max(this.effects.flash, intro);
    if (flash > 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${flash})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    if (end && t >= end.t) drawEndCard(ctx, script, t - end.t, this.fonts);
  }
}
