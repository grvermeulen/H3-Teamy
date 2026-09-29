import { FIGHT_CLIP_NAMES, fightClipUrl, type FightClip } from "./clips";

/** Music actions the script can cue. */
export type MusicAction = "start" | "duck" | "unduck" | "tapeStop";

/** Levels, 0..1. */
const SFX_LEVEL = 0.85;
const MUSIC_LEVEL = 0.42;
const DUCKED_LEVEL = 0.14;

/** In slow motion every new sound plays slower and deeper by this much. */
export const SLOWMO_RATE = 0.62;

/**
 * The playback rate for a cue: its own rate, pitched down in slow motion.
 *
 * @param rate - The cue's rate (1 when unset).
 * @param slowmo - Whether slow motion is on.
 * @returns The rate to play at.
 */
export function cueRate(rate: number | undefined, slowmo: boolean): number {
  return (rate ?? 1) * (slowmo ? SLOWMO_RATE : 1);
}

/**
 * Plays the fight's sound: one-shot effects through a low-pass (closed down in slow motion) and
 * the music on its own gain. Built on a user gesture so the browser lets it start. Missing or
 * undecodable clips are skipped: the fight plays on, just quieter.
 */
export class FightAudio {
  private readonly buffers = new Map<FightClip, AudioBuffer>();
  private readonly master: GainNode;
  private readonly filter: BiquadFilterNode;
  private readonly musicGain: GainNode;
  private music: AudioBufferSourceNode | null = null;
  private readonly live = new Set<AudioBufferSourceNode>();
  private slowmo = false;
  private loading: Promise<void> | null = null;

  private constructor(private readonly ctx: AudioContext) {
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 20000;
    this.filter.connect(this.master);
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = MUSIC_LEVEL;
    this.musicGain.connect(this.filter);
  }

  /**
   * Creates the audio graph. Call from a click or tap.
   *
   * @returns The player, or null where Web Audio is unavailable.
   */
  static create(): FightAudio | null {
    if (typeof window === "undefined") return null;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    try {
      const audio = new FightAudio(new Ctor());
      void audio.ctx.resume();
      return audio;
    } catch {
      return null;
    }
  }

  /**
   * Fetches and decodes every clip, once.
   *
   * @returns Resolves when every clip has loaded or failed.
   */
  load(): Promise<void> {
    this.loading ??= Promise.all(
      FIGHT_CLIP_NAMES.map(async (name) => {
        try {
          const res = await fetch(fightClipUrl(name));
          if (!res.ok) return;
          const data = await res.arrayBuffer();
          this.buffers.set(name, await this.ctx.decodeAudioData(data));
        } catch {
          // A clip that will not load or decode stays silent.
        }
      }),
    ).then(() => undefined);
    return this.loading;
  }

  /**
   * Plays a one-shot.
   *
   * @param name - The clip.
   * @param rate - Playback rate (pitch).
   * @param gain - Level, 0..1.
   */
  play(name: FightClip, rate = 1, gain = 1): void {
    const buffer = this.buffers.get(name);
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain * SFX_LEVEL;
    src.connect(g);
    g.connect(this.filter);
    src.onended = () => this.live.delete(src);
    this.live.add(src);
    src.start();
  }

  /**
   * Starts, ducks or tape-stops the music.
   *
   * @param action - What to do.
   */
  musicCue(action: MusicAction): void {
    const now = this.ctx.currentTime;
    const gain = this.musicGain.gain;
    if (action === "start") {
      this.music?.stop();
      const buffer = this.buffers.get("music");
      if (!buffer) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.musicGain);
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(MUSIC_LEVEL, now);
      src.start();
      this.music = src;
    } else if (action === "duck" || action === "unduck") {
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(
        action === "duck" ? DUCKED_LEVEL : MUSIC_LEVEL,
        now + 0.2,
      );
    } else if (this.music) {
      // Tape stop: the music slows and sinks to nothing.
      const src = this.music;
      src.playbackRate.cancelScheduledValues(now);
      src.playbackRate.setValueAtTime(src.playbackRate.value, now);
      src.playbackRate.exponentialRampToValueAtTime(0.2, now + 1.1);
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(0, now + 1.2);
      src.stop(now + 1.3);
      this.music = null;
    }
  }

  /**
   * Slow motion closes the low-pass; leaving it opens it again.
   *
   * @param on - Whether slow motion is on.
   */
  setSlowmo(on: boolean): void {
    if (on === this.slowmo) return;
    this.slowmo = on;
    const now = this.ctx.currentTime;
    const f = this.filter.frequency;
    f.cancelScheduledValues(now);
    f.setValueAtTime(f.value, now);
    f.exponentialRampToValueAtTime(on ? 900 : 20000, now + (on ? 0.15 : 0.3));
  }

  /**
   * Mutes or unmutes everything.
   *
   * @param muted - Whether to mute.
   */
  setMuted(muted: boolean): void {
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(muted ? 0 : 1, now + 0.08);
  }

  /** Stops every sound (replay, close). */
  stopAll(): void {
    this.music?.stop();
    this.music = null;
    for (const src of this.live) {
      try {
        src.stop();
      } catch {
        // Already stopped.
      }
    }
    this.live.clear();
    this.setSlowmo(false);
    this.musicGain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.musicGain.gain.value = MUSIC_LEVEL;
  }

  /** Releases the audio device. */
  close(): void {
    this.stopAll();
    void this.ctx.close();
  }
}
