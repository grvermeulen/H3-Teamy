/**
 * Recorded sound in front of the synthesiser (Plan 6, Task 1).
 *
 * The player fetches and decodes every clip in {@link AUDIO_CLIPS} once, then plays whatever it
 * holds. `play` returning `false` is the whole fallback contract: the caller then makes the sound
 * it made before any file existed. A clip the server does not have is not an error — the files
 * land separately — while a clip that arrives and will not decode is reported once.
 */

import * as Sentry from "@sentry/nextjs";
import { AUDIO_CLIPS, CLIP_NAMES, clipUrl, type ClipName } from "./clips";
import type {
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  GainNodeLike,
} from "./sound";

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

/** A looping clip that is playing: the engine, the siren. */
export type LoopHandle = {
  /** Changes the playback rate, ramped so the pitch does not step. */
  setRate(rate: number): void;
  stop(): void;
};

/** The sample player. */
export type SamplePlayer = {
  /**
   * Fetches and decodes every clip. Idempotent: later calls return the same promise, so the
   * first gesture that unlocks audio can start it without anyone else having to know.
   */
  preload(): Promise<void>;
  /** Plays a clip once. `false` means it is not available, and the caller keeps its own sound. */
  play(clip: ClipName, rate?: number): boolean;
  /** Starts a looping clip, or `null` when it is not available. */
  startLoop(clip: ClipName): LoopHandle | null;
  /** Whether the clip decoded. */
  has(clip: ClipName): boolean;
};

/** How a sample player is attached to the sound: given the context and the node to play into. */
export type SamplePlayerFactory = (
  context: AudioContextLike,
  destination: AudioNodeLike,
) => SamplePlayer | null;

/** Seconds over which a rate change is ramped. */
const RATE_RAMP_S = 0.08;

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
  let loading: Promise<void> | null = null;

  /** A source for `clip` through a gain node at the clip's level, or null when it is missing. */
  function voice(clip: ClipName, rate: number): BufferSourceLike | null {
    const buffer = buffers.get(clip);
    if (!buffer) return null;
    try {
      const source = context.createBufferSource();
      const gain: GainNodeLike = context.createGain();
      source.buffer = buffer;
      source.loop = AUDIO_CLIPS[clip].loop;
      source.playbackRate.setValueAtTime(rate, context.currentTime);
      gain.gain.setValueAtTime(AUDIO_CLIPS[clip].gain, context.currentTime);
      source.connect(gain);
      gain.connect(destination);
      source.start(context.currentTime);
      return source;
    } catch (error: unknown) {
      reportClipError(error, clip);
      return null;
    }
  }

  return {
    preload(): Promise<void> {
      loading ??= Promise.all(
        CLIP_NAMES.map(async (clip) => {
          const buffer = await loadClip(context, clip, fetchImpl);
          if (buffer) buffers.set(clip, buffer);
        }),
      ).then(() => undefined);
      return loading;
    },
    play(clip: ClipName, rate = 1): boolean {
      return voice(clip, rate) !== null;
    },
    startLoop(clip: ClipName): LoopHandle | null {
      const source = voice(clip, 1);
      if (!source) return null;
      return {
        setRate(rate: number): void {
          const param = source.playbackRate;
          if (param.linearRampToValueAtTime)
            param.linearRampToValueAtTime(
              rate,
              context.currentTime + RATE_RAMP_S,
            );
          else param.setValueAtTime(rate, context.currentTime);
        },
        stop(): void {
          try {
            source.stop(context.currentTime);
            source.disconnect();
          } catch (error: unknown) {
            reportClipError(error, clip);
          }
        },
      };
    },
    has(clip: ClipName): boolean {
      return buffers.has(clip);
    },
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
