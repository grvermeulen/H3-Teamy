import * as Sentry from "@sentry/nextjs";
import { MAX_EVENTS } from "../sim/limits";
import type { ArenaEvent, VehicleState, WeaponKind } from "../sim/types";
import type { ClipName } from "./clips";
import type { SamplePlayer, SamplePlayerFactory } from "./samples";

/** Minimal audio parameter surface used by the arena synth. */
export type AudioParamLike = {
  value: number;
  setValueAtTime(value: number, time: number): void;
  linearRampToValueAtTime?(value: number, time: number): void;
};

/** Minimal connectable audio node surface used by the arena synth. */
export type AudioNodeLike = {
  connect(destination: AudioNodeLike): void;
  disconnect(): void;
};

/** Minimal oscillator surface used by the arena synth. */
export type OscillatorLike = AudioNodeLike & {
  type: string;
  frequency: AudioParamLike;
  start(when?: number): void;
  stop(when?: number): void;
};

/** Minimal gain surface used by the arena synth. */
export type GainNodeLike = AudioNodeLike & { gain: AudioParamLike };

/** Narrow, injectable Web Audio context contract. */
export type AudioContextLike = {
  currentTime: number;
  destination: AudioNodeLike;
  createGain(): GainNodeLike;
  createOscillator(): OscillatorLike;
  resume(): Promise<void> | void;
  close?(): Promise<void> | void;
};

/** Factory used by production and replaced with a deterministic fake in tests. */
export type AudioContextFactory = () => AudioContextLike | null;

/** Arena sound controls consumed by the runtime. */
export type ArenaSound = {
  unlock(): void;
  setEnabled(enabled: boolean): void;
  handleEvents(events: ArenaEvent[]): void;
  updateEngine(speedMps: number, active: boolean): void;
  dispose(): void;
};

const MASTER_GAIN = 0.18;
const ENGINE_GAIN = 0.06;

function reportAudioError(error: unknown, kind: string): void {
  Sentry.captureException(error, { tags: { area: "arena", kind } });
}

/** Browser context factory; returns null during SSR and in browsers without Web Audio. */
export function createBrowserAudioContext(): AudioContextLike | null {
  if (typeof window === "undefined") return null;
  const browserWindow = window as Window & {
    webkitAudioContext?: new () => AudioContext;
  };
  const Constructor = window.AudioContext ?? browserWindow.webkitAudioContext;
  if (!Constructor) return null;
  try {
    return new Constructor() as unknown as AudioContextLike;
  } catch (error: unknown) {
    reportAudioError(error, "audio-context");
    return null;
  }
}

function setParam(param: AudioParamLike, value: number, time: number): void {
  param.setValueAtTime(value, time);
}

function rampParam(param: AudioParamLike, value: number, time: number): void {
  if (param.linearRampToValueAtTime) param.linearRampToValueAtTime(value, time);
  else setParam(param, value, time);
}

function shotTone(weapon: WeaponKind): {
  frequency: number;
  duration: number;
  type: string;
} {
  if (weapon === "shotgun")
    return { frequency: 120, duration: 0.16, type: "sawtooth" };
  if (weapon === "uzi")
    return { frequency: 210, duration: 0.06, type: "square" };
  if (weapon === "fist")
    return { frequency: 90, duration: 0.04, type: "triangle" };
  return { frequency: 180, duration: 0.08, type: "square" };
}

/** The recorded clip for an event, or null for one that only the synthesiser voices. */
function clipFor(event: ArenaEvent): ClipName | null {
  if (event.kind === "shot")
    return event.weapon === "fist" ? null : event.weapon;
  if (event.kind === "explosion") return "explosion";
  if (event.kind === "pickup") return "pickup";
  if (event.kind === "impact") return "impact";
  return null;
}

/**
 * Creates the arena's sound layer: recorded clips where they exist, the synthesiser everywhere
 * else.
 *
 * @param factory - Makes the audio context; a deterministic fake in tests.
 * @param initiallyEnabled - Whether sound starts on.
 * @param samples - Attaches a sample player to the context; omitted, everything is synthesised.
 * @returns The controls the runtime drives.
 */
export function createArenaSound(
  factory: AudioContextFactory = createBrowserAudioContext,
  initiallyEnabled = true,
  samples?: SamplePlayerFactory,
): ArenaSound {
  let enabled = initiallyEnabled;
  let context: AudioContextLike | null = null;
  let master: GainNodeLike | null = null;
  let player: SamplePlayer | null = null;
  let engine: OscillatorLike | null = null;
  let engineGain: GainNodeLike | null = null;
  let disposed = false;
  let unlocked = false;

  try {
    context = factory();
    if (context) {
      master = context.createGain();
      master.connect(context.destination);
      setParam(master.gain, enabled ? MASTER_GAIN : 0, context.currentTime);
      player = samples?.(context, master) ?? null;
    }
  } catch (error: unknown) {
    reportAudioError(error, "audio-init");
    context = null;
    master = null;
    player = null;
  }

  /** Fetches the clips once audio is allowed to play; a failure costs the clips, nothing else. */
  function preloadSamples(): void {
    void player?.preload().catch((error: unknown) => {
      reportAudioError(error, "audio-preload");
    });
  }

  function playTone(
    frequency: number,
    duration: number,
    type: string,
    gainAmount: number,
    endFrequency?: number,
  ): void {
    if (!enabled || !context || !master || disposed) return;
    try {
      const now = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type;
      setParam(oscillator.frequency, frequency, now);
      if (endFrequency !== undefined)
        rampParam(oscillator.frequency, endFrequency, now + duration);
      setParam(gain.gain, gainAmount, now);
      rampParam(gain.gain, 0, now + duration);
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(now);
      oscillator.stop(now + duration);
    } catch (error: unknown) {
      reportAudioError(error, "audio-voice");
    }
  }

  function handleEvent(event: ArenaEvent): void {
    // A clip that played is the whole sound; the oscillator branches below are the fallback for
    // a clip that has not landed, and stay for as long as that can be true.
    const clip = clipFor(event);
    if (clip !== null && player?.play(clip)) return;
    if (event.kind === "shot") {
      const tone = shotTone(event.weapon);
      playTone(tone.frequency, tone.duration, tone.type, 0.22);
    } else if (event.kind === "explosion") {
      playTone(95, 0.35, "sawtooth", 0.35, 35);
    } else if (event.kind === "pickup") {
      playTone(520, 0.08, "sine", 0.16);
      playTone(780, 0.12, "sine", 0.14);
    } else if (event.kind === "hit") {
      playTone(260, 0.035, "triangle", 0.12);
    }
  }

  return {
    unlock(): void {
      if (!enabled || !context || disposed) return;
      if (unlocked) return;
      unlocked = true;
      try {
        const result = context.resume();
        if (result instanceof Promise)
          result.catch((error: unknown) => {
            unlocked = false;
            reportAudioError(error, "audio-unlock");
          });
      } catch (error: unknown) {
        unlocked = false;
        reportAudioError(error, "audio-unlock");
      }
      // The first gesture is also the first moment fetching audio is worth the bandwidth.
      preloadSamples();
    },
    setEnabled(next: boolean): void {
      enabled = next;
      if (!master || !context || disposed) return;
      try {
        setParam(master.gain, enabled ? MASTER_GAIN : 0, context.currentTime);
      } catch (error: unknown) {
        reportAudioError(error, "audio-toggle");
      }
    },
    handleEvents(events: ArenaEvent[]): void {
      if (!enabled || disposed) return;
      for (const event of events.slice(0, MAX_EVENTS)) handleEvent(event);
    },
    updateEngine(speedMps: number, active: boolean): void {
      if (!context || !master || disposed) return;
      if (!enabled || !active) {
        if (engine) {
          try {
            engine.stop(context.currentTime);
            engine.disconnect();
            engineGain?.disconnect();
          } catch (error: unknown) {
            reportAudioError(error, "audio-engine-stop");
          }
          engine = null;
          engineGain = null;
        }
        return;
      }
      try {
        if (!engine || !engineGain) {
          engine = context.createOscillator();
          engineGain = context.createGain();
          engine.type = "sawtooth";
          setParam(engineGain.gain, ENGINE_GAIN, context.currentTime);
          engine.connect(engineGain);
          engineGain.connect(master);
          engine.start(context.currentTime);
        }
        const clamped = Math.max(0, Math.min(30, speedMps));
        setParam(engine.frequency, 70 + clamped * 5, context.currentTime);
      } catch (error: unknown) {
        reportAudioError(error, "audio-engine");
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (engine && context) {
        try {
          engine.stop(context.currentTime);
          engine.disconnect();
          engineGain?.disconnect();
        } catch (error: unknown) {
          reportAudioError(error, "audio-dispose");
        }
      }
      try {
        master?.disconnect();
        const result = context?.close?.();
        if (result instanceof Promise)
          result.catch((error: unknown) =>
            reportAudioError(error, "audio-dispose"),
          );
      } catch (error: unknown) {
        reportAudioError(error, "audio-dispose");
      }
      engine = null;
      engineGain = null;
      master = null;
      context = null;
    },
  };
}
