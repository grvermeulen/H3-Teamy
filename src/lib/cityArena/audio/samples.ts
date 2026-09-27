/**
 * Recorded sound in front of the synthesiser (Plan 6, Task 1).
 *
 * The player fetches and decodes every clip in {@link AUDIO_CLIPS} once, then plays whatever it
 * holds. `play` returning `false` is the whole fallback contract: the caller then makes the sound
 * it made before any file existed. A clip the server does not have is not an error — the files
 * land separately — while a clip that arrives and will not decode is reported once.
 *
 * A voice given a placement (immersion spec §6) plays through gain → low-pass → stereo panner;
 * at most {@link MAX_ONE_SHOTS} one-shots sound at once, the quietest giving way.
 */

import * as Sentry from "@sentry/nextjs";
import { AUDIO_CLIPS, CLIP_NAMES, clipUrl, type ClipName } from "./clips";
import type { SpatialMix } from "./spatial";
import type { AudioContextLike, AudioNodeLike, AudioParamLike } from "./sound";
import {
  buildVoiceChain,
  disconnectVoiceChain,
  moveVoiceChain,
  type VoiceChain,
} from "./voiceChain";

/** What the player needs to know about a decoded clip. */
export type AudioBufferLike = { duration: number };

/** Minimal buffer-source surface used by the player. */
export type BufferSourceLike = AudioNodeLike & {
  buffer: AudioBufferLike | null;
  loop: boolean;
  playbackRate: AudioParamLike;
  start(when?: number): void;
  stop(when?: number): void;
};

/** What the sample player needs from a Web Audio context, beyond what the synth needs. */
export type SampleContextLike = AudioContextLike & {
  createBufferSource(): BufferSourceLike;
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike>;
};

/** A looping clip that is playing: the engine, a siren, an ambience bed. */
export type LoopHandle = {
  /** Changes the playback rate, ramped so the pitch does not step. */
  setRate(rate: number): void;
  /**
   * Moves the loop — level, low-pass and pan — eased over ≈ 0.1 s. A loop started without a
   * placement has no panner or filter, and only follows the level.
   */
  setPlacement(mix: SpatialMix): void;
  stop(): void;
};

/** The sample player. */
export type SamplePlayer = {
  /**
   * Fetches and decodes every clip. Idempotent: later calls return the same promise, so the
   * first gesture that unlocks audio can start it without anyone else having to know.
   */
  preload(): Promise<void>;
  /**
   * Plays a clip once, placed when `placement` is given. `false` means it is not available, and
   * the caller keeps its own sound; a voice the cap turns away still counts as handled (`true`).
   */
  play(
    clip: ClipName,
    rate?: number,
    gainScale?: number,
    placement?: SpatialMix,
  ): boolean;
  /** Starts a looping clip, placed when `placement` is given, or `null` when it is not available. */
  startLoop(clip: ClipName, placement?: SpatialMix): LoopHandle | null;
  /** Whether the clip decoded. */
  has(clip: ClipName): boolean;
  /** How many one-shots are sounding right now. */
  liveVoices(): number;
};

/** How a sample player is attached to the sound: given the context and the node to play into. */
export type SamplePlayerFactory = (
  context: AudioContextLike,
  destination: AudioNodeLike,
) => SamplePlayer | null;

/** Seconds over which a rate change is ramped. */
const RATE_RAMP_S = 0.08;
/** Most one-shots sounding at once (spec §6): the quietest gives way to a louder newcomer. */
export const MAX_ONE_SHOTS = 24;

/** A one-shot that is sounding: when it ends, how loud it is, and how to cut it short. */
type LiveVoice = { endsAt: number; level: number; source: BufferSourceLike };

/** A voice that started: its source and the nodes behind it. */
type StartedVoice = { source: BufferSourceLike; chain: VoiceChain };

/** Reports one clip's failure, tagged so it can be filtered by clip. */
function reportClipError(error: unknown, clip: ClipName): void {
  Sentry.captureException(error, {
    tags: { area: "arena", kind: "audio", clip },
  });
}

/** True when `context` can decode and play buffers — every real browser context, not every fake. */
function isSampleContext(
  context: AudioContextLike,
): context is SampleContextLike {
  return "createBufferSource" in context && "decodeAudioData" in context;
}

/**
 * Fetches and decodes one clip.
 *
 * @returns The buffer, or `null` when the server does not have the file, or it will not decode.
 */
async function loadClip(
  context: SampleContextLike,
  clip: ClipName,
  fetchImpl: typeof fetch,
): Promise<AudioBufferLike | null> {
  try {
    const response = await fetchImpl(clipUrl(clip));
    // Not shipped yet is the expected state until the files land; only a broken file is news.
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${clip}`);
    return await context.decodeAudioData(await response.arrayBuffer());
  } catch (error: unknown) {
    reportClipError(error, clip);
    return null;
  }
}

/**
 * The one-shots sounding at a moment, with a gate that admits a new one at `level` or not.
 * When all {@link MAX_ONE_SHOTS} are busy, a newcomer louder than the quietest cuts it short;
 * one that is not is turned away.
 */
function createVoiceCap(context: AudioContextLike): {
  admit(level: number, clip: ClipName): boolean;
  add(voice: LiveVoice): void;
  count(): number;
} {
  let live: LiveVoice[] = [];
  const prune = (): void => {
    live = live.filter((voice) => voice.endsAt > context.currentTime);
  };
  return {
    admit(level: number, clip: ClipName): boolean {
      prune();
      if (live.length < MAX_ONE_SHOTS) return true;
      const quietest = live.reduce((low, voice) =>
        voice.level < low.level ? voice : low,
      );
      if (level <= quietest.level) return false;
      live = live.filter((voice) => voice !== quietest);
      try {
        quietest.source.stop(context.currentTime);
      } catch (error: unknown) {
        reportClipError(error, clip);
      }
      return true;
    },
    add(voice: LiveVoice): void {
      live.push(voice);
    },
    count(): number {
      prune();
      return live.length;
    },
  };
}

/** Ramps a playback rate, stepping straight to it where the context cannot ramp. */
function rampRate(
  param: AudioParamLike,
  rate: number,
  context: AudioContextLike,
): void {
  if (param.linearRampToValueAtTime)
    param.linearRampToValueAtTime(rate, context.currentTime + RATE_RAMP_S);
  else param.setValueAtTime(rate, context.currentTime);
}

/** The controls of a loop that started. */
function loopHandle(
  context: AudioContextLike,
  clip: ClipName,
  { source, chain }: StartedVoice,
): LoopHandle {
  return {
    setRate(rate: number): void {
      rampRate(source.playbackRate, rate, context);
    },
    setPlacement(mix: SpatialMix): void {
      try {
        moveVoiceChain(chain, context, AUDIO_CLIPS[clip].gain, mix);
      } catch (error: unknown) {
        reportClipError(error, clip);
      }
    },
    stop(): void {
      try {
        source.stop(context.currentTime);
        source.disconnect();
        disconnectVoiceChain(chain);
      } catch (error: unknown) {
        reportClipError(error, clip);
      }
    },
  };
}

/** Starts `buffer` as `clip` through its nodes, or null when the context refuses. */
function startVoice(
  context: SampleContextLike,
  destination: AudioNodeLike,
  clip: ClipName,
  buffer: AudioBufferLike,
  play: { rate: number; level: number; placement: SpatialMix | null },
): StartedVoice | null {
  try {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = AUDIO_CLIPS[clip].loop;
    source.playbackRate.setValueAtTime(play.rate, context.currentTime);
    const chain = buildVoiceChain(
      context,
      destination,
      play.level,
      play.placement,
    );
    source.connect(chain.input);
    source.start(context.currentTime);
    return { source, chain };
  } catch (error: unknown) {
    reportClipError(error, clip);
    return null;
  }
}

/** Fetches and decodes every clip into `buffers`, leaving out the ones that are not there. */
async function loadAll(
  context: SampleContextLike,
  buffers: Map<ClipName, AudioBufferLike>,
  fetchImpl: typeof fetch,
): Promise<void> {
  await Promise.all(
    CLIP_NAMES.map(async (clip) => {
      const buffer = await loadClip(context, clip, fetchImpl);
      if (buffer) buffers.set(clip, buffer);
    }),
  );
}

/**
 * Creates a sample player over `context`, playing into `destination`.
 *
 * @param context - A Web Audio context that can decode and play buffers.
 * @param destination - The node clips play into — the synth's master gain, so one toggle mutes both.
 * @param fetchImpl - Injectable so tests serve clips without a network.
 * @returns The player, holding nothing until {@link SamplePlayer.preload} has run.
 */
export function createSamplePlayer(
  context: SampleContextLike,
  destination: AudioNodeLike,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): SamplePlayer {
  const buffers = new Map<ClipName, AudioBufferLike>();
  const cap = createVoiceCap(context);
  let loading: Promise<void> | null = null;
  return {
    preload(): Promise<void> {
      loading ??= loadAll(context, buffers, fetchImpl);
      return loading;
    },
    play(clip, rate = 1, gainScale = 1, placement): boolean {
      const buffer = buffers.get(clip);
      if (!buffer) return false;
      const level = AUDIO_CLIPS[clip].gain * gainScale;
      const heard = level * (placement?.gain ?? 1);
      if (!cap.admit(heard, clip)) return true;
      const started = startVoice(context, destination, clip, buffer, {
        rate,
        level,
        placement: placement ?? null,
      });
      if (!started) return false;
      const endsAt = context.currentTime + buffer.duration / rate;
      cap.add({ endsAt, level: heard, source: started.source });
      return true;
    },
    startLoop(clip: ClipName, placement?: SpatialMix): LoopHandle | null {
      const buffer = buffers.get(clip);
      const started =
        buffer &&
        startVoice(context, destination, clip, buffer, {
          rate: 1,
          level: AUDIO_CLIPS[clip].gain,
          placement: placement ?? null,
        });
      return started ? loopHandle(context, clip, started) : null;
    },
    has: (clip) => buffers.has(clip),
    liveVoices: () => cap.count(),
  };
}

/**
 * The sample player for a browser context, or `null` for a context that cannot play buffers.
 *
 * @param context - The context the sound layer created.
 * @param destination - The node to play into.
 * @returns A player over the real network, or `null`.
 */
export function browserSamplePlayer(
  context: AudioContextLike,
  destination: AudioNodeLike,
): SamplePlayer | null {
  return isSampleContext(context)
    ? createSamplePlayer(context, destination)
    : null;
}
