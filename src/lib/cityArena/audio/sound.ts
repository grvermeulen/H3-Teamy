import * as Sentry from "@sentry/nextjs";
import { MAX_EVENTS } from "../sim/limits";
import type { ArenaEvent } from "../sim/types";
import type { ClipName } from "./clips";
import {
  clipFor,
  clipGainFor,
  ducksRadio,
  eventPosition,
  fallbackTones,
  isOwnDeath,
  soundClassFor,
  type EventSources,
  type Tone,
} from "./eventVoices";
import type { RadioFactory, RadioPlayer } from "./radio/radio";
import type { LoopHandle, SamplePlayer, SamplePlayerFactory } from "./samples";
import {
  createFootsteps,
  createSkidDetector,
  type SelfCue,
  type SelfMotion,
} from "./selfSounds";
import {
  MIN_AUDIBLE_GAIN,
  SOUND_PROFILES,
  spatialMix,
  type Listener,
  type SpatialMix,
} from "./spatial";
import { buildVoiceChain } from "./voiceChain";

/** Minimal audio parameter surface used by the arena synth. */
export type AudioParamLike = {
  value: number;
  setValueAtTime(value: number, time: number): void;
  linearRampToValueAtTime?(value: number, time: number): void;
  /** Eases exponentially toward a value; how a moving voice follows its source. */
  setTargetAtTime?(value: number, time: number, timeConstant: number): void;
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

/** Minimal stereo panner surface: where a placed voice sits left to right. */
export type StereoPannerLike = AudioNodeLike & { pan: AudioParamLike };

/** Minimal biquad filter surface: the low-pass that closes on a distant voice. */
export type BiquadFilterLike = AudioNodeLike & {
  type: string;
  frequency: AudioParamLike;
};

/** Narrow, injectable Web Audio context contract. */
export type AudioContextLike = {
  currentTime: number;
  destination: AudioNodeLike;
  createGain(): GainNodeLike;
  createOscillator(): OscillatorLike;
  /** Pans placed voices; absent in a context that cannot, and then they play unpanned. */
  createStereoPanner?(): StereoPannerLike;
  /** Muffles distant voices; absent in a context that cannot, and then they play unfiltered. */
  createBiquadFilter?(): BiquadFilterLike;
  /** Attaches a media element; absent in a context that cannot, and then there is no radio. */
  createMediaElementSource?(element: HTMLMediaElement): AudioNodeLike;
  resume(): Promise<void> | void;
  close?(): Promise<void> | void;
};

/** Factory used by production and replaced with a deterministic fake in tests. */
export type AudioContextFactory = () => AudioContextLike | null;

/** Arena sound controls consumed by the runtime. */
export type ArenaSound = {
  unlock(): void;
  setEnabled(enabled: boolean): void;
  /** Where the ears are this frame; until the first call every sound plays as if at the listener. */
  setListener(listener: Listener): void;
  /** Voices a tick's events, each placed around the listener; `sources` fills in what they lack. */
  handleEvents(events: ArenaEvent[], sources?: EventSources): void;
  updateEngine(speedMps: number, active: boolean): void;
  /** Footsteps and tyre squeals from the local player's own motion; call once per frame. */
  updateSelf(motion: SelfMotion): void;
  /** Runs the siren loop while a police car is chasing within earshot; silent without its clip. */
  updateSiren(on: boolean): void;
  dispose(): void;
  /** The car radio (Plan 7), or `null` when there is none. */
  radio: RadioPlayer | null;
};

const MASTER_GAIN = 0.18;
const ENGINE_GAIN = 0.06;
/** The engine clip's playback rate at a standstill. */
export const ENGINE_RATE_MIN = 0.7;
/** The engine clip's playback rate at {@link ENGINE_RATE_TOP_SPEED_MPS} and above. */
export const ENGINE_RATE_MAX = 2.2;
/** The speed at which the engine clip reaches its top rate. */
export const ENGINE_RATE_TOP_SPEED_MPS = 25;
/** The drone's pitch at rest, and how much it rises per m/s, up to {@link DRONE_TOP_SPEED_MPS}. */
const DRONE_BASE_HZ = 70;
const DRONE_HZ_PER_MPS = 5;
const DRONE_TOP_SPEED_MPS = 30;
/** A loud event ducks the radio only when it is heard at least this loud: not a distant shot. */
export const RADIO_DUCK_MIN_GAIN = 0.2;
/** Each footstep's rate is jittered by up to this share either way, so a walk is not a metronome. */
export const FOOTSTEP_RATE_JITTER = 0.06;

/**
 * The engine clip's playback rate for a speed: idle at rest, rising to the top rate at 25 m/s.
 *
 * @param speedMps - The car's speed.
 * @returns The rate to play the loop at.
 */
export function engineRate(speedMps: number): number {
  const share = Math.max(0, Math.min(1, speedMps / ENGINE_RATE_TOP_SPEED_MPS));
  return ENGINE_RATE_MIN + share * (ENGINE_RATE_MAX - ENGINE_RATE_MIN);
}

/**
 * Reports an audio failure to Sentry, tagged so arena audio issues are easy to filter.
 *
 * @param error - What was thrown.
 * @param kind - Which part of the sound layer failed.
 */
export function reportAudioError(error: unknown, kind: string): void {
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

/** Sets an audio parameter to a value at a time. */
function setParam(param: AudioParamLike, value: number, time: number): void {
  param.setValueAtTime(value, time);
}

/** Ramps an audio parameter to a value, stepping straight to it where the context cannot ramp. */
function rampParam(param: AudioParamLike, value: number, time: number): void {
  if (param.linearRampToValueAtTime) param.linearRampToValueAtTime(value, time);
  else setParam(param, value, time);
}

/** The mutable state every part of the sound layer shares. */
type SoundCore = {
  context: AudioContextLike | null;
  master: GainNodeLike | null;
  player: SamplePlayer | null;
  radio: RadioPlayer | null;
  enabled: boolean;
  disposed: boolean;
  unlocked: boolean;
  listener: Listener | null;
  engine: OscillatorLike | null;
  engineGain: GainNodeLike | null;
  engineLoop: LoopHandle | null;
  sirenLoop: LoopHandle | null;
  footsteps: SelfCue;
  skid: SelfCue;
  random: () => number;
};

/** Builds the context, the master gain, the sample player and the radio; a failure costs them all. */
function createCore(
  factory: AudioContextFactory,
  enabled: boolean,
  attach: { samples?: SamplePlayerFactory; radio?: RadioFactory },
  random: () => number,
): SoundCore {
  const core: SoundCore = {
    context: null,
    master: null,
    player: null,
    radio: null,
    enabled,
    disposed: false,
    unlocked: false,
    listener: null,
    engine: null,
    engineGain: null,
    engineLoop: null,
    sirenLoop: null,
    footsteps: createFootsteps(),
    skid: createSkidDetector(),
    random,
  };
  try {
    const context = factory();
    if (!context) return core;
    const master = context.createGain();
    master.connect(context.destination);
    setParam(master.gain, enabled ? MASTER_GAIN : 0, context.currentTime);
    core.context = context;
    core.master = master;
    core.player = attach.samples?.(context, master) ?? null;
    core.radio = attach.radio?.(context, master) ?? null;
  } catch (error: unknown) {
    reportAudioError(error, "audio-init");
    Object.assign(core, {
      context: null,
      master: null,
      player: null,
      radio: null,
    });
  }
  return core;
}

/** True while the layer may make a sound at all. */
function audible(
  core: SoundCore,
): core is SoundCore & { context: AudioContextLike; master: GainNodeLike } {
  return core.enabled && !core.disposed && !!core.context && !!core.master;
}

/** Plays a synthesised tone, placed by `mix` when one is given. */
function playTone(core: SoundCore, tone: Tone, mix: SpatialMix | null): void {
  if (!audible(core)) return;
  try {
    const { context } = core;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    oscillator.type = tone.type;
    setParam(oscillator.frequency, tone.frequency, now);
    if (tone.endFrequency !== undefined)
      rampParam(oscillator.frequency, tone.endFrequency, now + tone.duration);
    const chain = buildVoiceChain(context, core.master, tone.gain, mix);
    rampParam(chain.input.gain, 0, now + tone.duration);
    oscillator.connect(chain.input);
    oscillator.start(now);
    oscillator.stop(now + tone.duration);
  } catch (error: unknown) {
    reportAudioError(error, "audio-voice");
  }
}

/** Where an event sits for the listener, or `null` for one heard as if at the listener. */
function placeEvent(
  core: SoundCore,
  event: ArenaEvent,
  sources: EventSources | undefined,
): SpatialMix | null {
  const soundClass = soundClassFor(event);
  const point = eventPosition(event, sources);
  if (!core.listener || !soundClass || !point) return null;
  return spatialMix(
    core.listener,
    point.x,
    point.y,
    SOUND_PROFILES[soundClass],
  );
}

/**
 * Voices one event: its clip where it has landed, its synthesised tones where not. A clip that
 * played is the whole sound; a placement too faint to hear plays nothing at all.
 */
function handleEvent(
  core: SoundCore,
  event: ArenaEvent,
  sources: EventSources | undefined,
): void {
  if (isOwnDeath(event, sources)) {
    playOwn(core, "death");
    return;
  }
  const mix = placeEvent(core, event, sources);
  const gain = mix?.gain ?? 1;
  if (gain < MIN_AUDIBLE_GAIN) return;
  if (ducksRadio(event) && gain >= RADIO_DUCK_MIN_GAIN) core.radio?.duck();
  const clip = clipFor(event);
  if (
    clip !== null &&
    core.player?.play(clip, 1, clipGainFor(event), mix ?? undefined)
  )
    return;
  for (const tone of fallbackTones(event)) playTone(core, tone, mix);
}

/** Plays one of the local player's own clips, centred and at full level; silent without it. */
function playOwn(core: SoundCore, clip: ClipName, rate = 1): void {
  if (audible(core)) core.player?.play(clip, rate);
}

/** Footsteps and skids from the local player's motion this frame. */
function updateCoreSelf(core: SoundCore, motion: SelfMotion): void {
  const footstep = core.footsteps.step(motion);
  const skid = core.skid.step(motion);
  if (footstep) {
    const jitter = (core.random() * 2 - 1) * FOOTSTEP_RATE_JITTER;
    playOwn(core, "footstep", 1 + jitter);
  }
  if (skid) playOwn(core, "skid");
}

/** Stops the oscillator drone, if it is running. */
function stopDrone(core: SoundCore): void {
  if (!core.engine || !core.context) return;
  try {
    core.engine.stop(core.context.currentTime);
    core.engine.disconnect();
    core.engineGain?.disconnect();
  } catch (error: unknown) {
    reportAudioError(error, "audio-engine-stop");
  }
  core.engine = null;
  core.engineGain = null;
}

/** Stops whichever engine is running: the clip, the drone, or both. */
function stopEngine(core: SoundCore): void {
  core.engineLoop?.stop();
  core.engineLoop = null;
  stopDrone(core);
}

/** Stops the siren, if it is sounding. */
function stopSiren(core: SoundCore): void {
  core.sirenLoop?.stop();
  core.sirenLoop = null;
}

/**
 * Runs the engine from the recorded loop, following the speed.
 *
 * @returns False when there is no engine clip, so the drone takes over.
 */
function driveSampledEngine(core: SoundCore, speedMps: number): boolean {
  if (!core.player?.has("engine")) return false;
  core.engineLoop ??= core.player.startLoop("engine");
  if (!core.engineLoop) return false;
  // The clip lands whenever the preload finishes, mid-drive included: the drone that was
  // covering for it must not keep playing underneath.
  stopDrone(core);
  core.engineLoop.setRate(engineRate(speedMps));
  return true;
}

/** Runs the oscillator drone at the pitch for `speedMps`, starting it on first need. */
function driveDrone(core: SoundCore, speedMps: number): void {
  if (!audible(core)) return;
  try {
    const { context, master } = core;
    if (!core.engine || !core.engineGain) {
      core.engine = context.createOscillator();
      core.engineGain = context.createGain();
      core.engine.type = "sawtooth";
      setParam(core.engineGain.gain, ENGINE_GAIN, context.currentTime);
      core.engine.connect(core.engineGain);
      core.engineGain.connect(master);
      core.engine.start(context.currentTime);
    }
    const clamped = Math.max(0, Math.min(DRONE_TOP_SPEED_MPS, speedMps));
    setParam(
      core.engine.frequency,
      DRONE_BASE_HZ + clamped * DRONE_HZ_PER_MPS,
      context.currentTime,
    );
  } catch (error: unknown) {
    reportAudioError(error, "audio-engine");
  }
}

/** Resumes the context on the first gesture and starts fetching the clips. */
function unlockCore(core: SoundCore): void {
  if (!core.enabled || !core.context || core.disposed) return;
  // Every gesture, not just the first: a play the browser refused is retried on the next one.
  core.radio?.unlock();
  if (core.unlocked) return;
  core.unlocked = true;
  const failed = (error: unknown): void => {
    core.unlocked = false;
    reportAudioError(error, "audio-unlock");
  };
  try {
    const result = core.context.resume();
    if (result instanceof Promise) result.catch(failed);
  } catch (error: unknown) {
    failed(error);
  }
  // The first gesture is also the first moment fetching audio is worth the bandwidth.
  void core.player?.preload().catch((error: unknown) => {
    reportAudioError(error, "audio-preload");
  });
}

/** Mutes or unmutes everything, the radio included. */
function setCoreEnabled(core: SoundCore, next: boolean): void {
  core.enabled = next;
  core.radio?.setSoundEnabled(next);
  if (!core.master || !core.context || core.disposed) return;
  try {
    setParam(
      core.master.gain,
      next ? MASTER_GAIN : 0,
      core.context.currentTime,
    );
  } catch (error: unknown) {
    reportAudioError(error, "audio-toggle");
  }
}

/** Runs the player's own engine — clip or drone — or stops it when they are not driving. */
function updateCoreEngine(
  core: SoundCore,
  speedMps: number,
  active: boolean,
): void {
  if (!core.context || !core.master || core.disposed) return;
  core.radio?.setInCar(active);
  if (!core.enabled || !active) {
    stopEngine(core);
    return;
  }
  if (!driveSampledEngine(core, speedMps)) driveDrone(core, speedMps);
}

/** Stops everything and closes the context; safe to call twice. */
function disposeCore(core: SoundCore): void {
  if (core.disposed) return;
  core.disposed = true;
  core.radio?.dispose();
  stopEngine(core);
  stopSiren(core);
  try {
    core.master?.disconnect();
    const result = core.context?.close?.();
    if (result instanceof Promise)
      result.catch((error: unknown) =>
        reportAudioError(error, "audio-dispose"),
      );
  } catch (error: unknown) {
    reportAudioError(error, "audio-dispose");
  }
  core.master = null;
  core.context = null;
}

/**
 * Creates the arena's sound layer: recorded clips where they exist, the synthesiser everywhere
 * else, every positioned sound placed around the listener.
 *
 * @param factory - Makes the audio context; a deterministic fake in tests.
 * @param initiallyEnabled - Whether sound starts on.
 * @param samples - Attaches a sample player to the context; omitted, everything is synthesised.
 * @param radio - Attaches the car radio to the context; omitted, there is no radio.
 * @param random - Jitters footsteps; seeded in tests.
 * @returns The controls the runtime drives.
 */
export function createArenaSound(
  factory: AudioContextFactory = createBrowserAudioContext,
  initiallyEnabled = true,
  samples?: SamplePlayerFactory,
  radio?: RadioFactory,
  random: () => number = Math.random,
): ArenaSound {
  const core = createCore(
    factory,
    initiallyEnabled,
    { samples, radio },
    random,
  );
  return {
    unlock: () => unlockCore(core),
    setEnabled: (next) => setCoreEnabled(core, next),
    setListener(listener: Listener): void {
      core.listener = listener;
    },
    handleEvents(events: ArenaEvent[], sources?: EventSources): void {
      if (!core.enabled || core.disposed) return;
      for (const event of events.slice(0, MAX_EVENTS))
        handleEvent(core, event, sources);
    },
    updateEngine: (speedMps, active) =>
      updateCoreEngine(core, speedMps, active),
    updateSelf: (motion) => updateCoreSelf(core, motion),
    updateSiren(on: boolean): void {
      if (!core.enabled || !on || core.disposed) {
        stopSiren(core);
        return;
      }
      if (!core.player?.has("siren")) return;
      core.sirenLoop ??= core.player.startLoop("siren");
    },
    dispose: () => disposeCore(core),
    radio: core.radio,
  };
}
