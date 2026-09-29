import type { FightAudio } from "./audio";
import { cueRate } from "./audio";
import { buildFightScript } from "./choreography";
import { clamp } from "./math";
import { FightScene } from "./scene";
import type { FightScript } from "./script";
import type { FightFonts } from "./draw/shapes";
import { VIEW_W } from "./draw/stage";
import { TimeWarp, anchorAt, fighterAt, projectileAt } from "./timeline";

/** Options for {@link FightPlayer}. */
export type FightPlayerOptions = {
  canvas: HTMLCanvasElement;
  fonts: FightFonts;
  /** Reduced motion: no shake, soft flashes. */
  calm?: boolean;
  /** Sound, or null to play silently. */
  audio?: FightAudio | null;
  /** Called once when the show has played out. */
  onEnd?: () => void;
  /** A different script (tests). */
  script?: FightScript;
};

/**
 * Plays the fight on a canvas: advances real time, maps it to story time through the hit-stops
 * and the slow motion, fires the blows and cues the story passes, and draws every frame.
 */
export class FightPlayer {
  /** The fight being played. */
  readonly script: FightScript;
  /** Real-to-story time mapping. */
  readonly warp: TimeWarp;
  /** Real seconds the whole show takes. */
  readonly totalReal: number;
  private readonly scene: FightScene;
  private readonly ctx: CanvasRenderingContext2D | null;
  private raf = 0;
  private real = 0;
  private last = 0;
  private prevStory = -1;
  private slowmo = false;
  private ended = false;
  private audio: FightAudio | null;

  /** @param o - Canvas, fonts, sound and callbacks. */
  constructor(private readonly o: FightPlayerOptions) {
    this.script = o.script ?? buildFightScript();
    this.warp = new TimeWarp(this.script);
    this.totalReal = this.warp.realAt(this.script.duration);
    this.scene = new FightScene(this.script, o.fonts, o.calm ?? false);
    this.ctx = o.canvas.getContext("2d");
    this.audio = o.audio ?? null;
  }

  /**
   * Attaches (or detaches) the sound. Created on the first tap, so it arrives after the player.
   *
   * @param audio - The sound, or null for silence.
   */
  setAudio(audio: FightAudio | null): void {
    this.audio = audio;
  }

  /** Swaps in fonts once they have loaded. */
  setFonts(fonts: FightFonts): void {
    this.scene.setFonts(fonts);
  }

  /** Plays from the top. */
  start(): void {
    this.stop();
    this.audio?.stopAll();
    this.scene.effects.reset();
    this.real = 0;
    this.prevStory = -1;
    this.slowmo = false;
    this.ended = false;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Stops the loop (the current frame stays on screen). */
  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /**
   * Draws a single frame at a real time without playing (the poster before the start).
   *
   * @param real - Real seconds.
   */
  renderAt(real: number): void {
    this.draw(real);
  }

  /** Seconds played so far. */
  get elapsed(): number {
    return this.real;
  }

  private readonly frame = (now: number): void => {
    const dt = clamp((now - this.last) / 1000, 0, 0.05);
    this.last = now;
    this.real += dt;
    const story = this.warp.storyAt(this.real);
    this.fire(this.prevStory, story);
    this.prevStory = story;
    const slow = this.warp.inSlowmo(this.real);
    if (slow !== this.slowmo) {
      this.slowmo = slow;
      this.audio?.setSlowmo(slow);
    }
    this.scene.effects.update(dt * this.warp.effectRateAt(this.real), dt);
    this.draw(this.real);
    if (this.real >= this.totalReal) {
      this.raf = 0;
      if (!this.ended) {
        this.ended = true;
        this.o.onEnd?.();
      }
      return;
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  private draw(real: number): void {
    if (!this.ctx) return;
    const story = this.warp.storyAt(real);
    const k = this.slowmoStrength(real);
    this.scene.render(this.ctx, {
      story,
      real,
      slowmo: k,
      pixelScale: this.o.canvas.width / VIEW_W,
    });
  }

  /** Eases the slow-motion grade in and out around the slow stretch. */
  private slowmoStrength(real: number): number {
    for (const s of this.script.slowmos) {
      const r0 = this.warp.realAt(s.t0);
      const r1 = this.warp.realAt(s.t1);
      if (real >= r0 - 0.1 && real <= r1 + 0.4)
        return (
          clamp((real - r0 + 0.1) / 0.25, 0, 1) *
          clamp((r1 + 0.4 - real) / 0.4, 0, 1)
        );
    }
    return 0;
  }

  /** Fires every blow and cue the story passed between two frames. */
  private fire(from: number, to: number): void {
    if (to <= from) return;
    const s = this.script;
    const audio = this.audio;
    for (const h of s.hits) {
      if (h.t <= from) continue;
      if (h.t > to) break;
      const pos =
        "projectile" in h.at
          ? projectileAt(s, h.at.projectile, h.t)?.pos
          : anchorAt(s, h.at, h.t);
      if (!pos) continue;
      const dir = fighterAt(s, h.by, h.t).facing;
      this.scene.effects.hit(h.kind, pos, h.by, dir, h.seed);
      this.scene.effects.kick(h.shake);
      if (h.kind === "super") this.scene.effects.flashScreen(0.18);
    }
    for (const c of s.cues) {
      if (c.t <= from) continue;
      if (c.t > to) break;
      switch (c.kind) {
        case "sfx":
          audio?.play(
            c.name,
            cueRate(c.rate, this.warp.inSlowmo(this.real)),
            c.gain,
          );
          break;
        case "music":
          audio?.musicCue(c.action);
          break;
        case "flash":
          this.scene.effects.flashScreen(c.strength);
          break;
        case "burst":
          this.scene.effects.burst(c.fx, anchorAt(s, c.at, c.t), c.seed);
          break;
        default:
          break;
      }
    }
  }
}
