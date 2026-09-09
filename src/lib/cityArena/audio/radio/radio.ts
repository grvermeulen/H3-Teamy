/**
 * The car radio (Plan 7): one `<audio>` element behind the sound layer's master gain, playing
 * the tuned station while the player sits in a car.
 *
 * The element streams the track — a track is a couple of minutes, nothing is decoded up front —
 * and Web Audio takes its output through a gain of the radio's own into the master, so Geluid
 * mutes it with everything else and a loud effect can duck it. Getting out pauses and keeps the
 * position; getting back in resumes. A `play()` the browser refuses for want of a gesture is not
 * an error: it waits for the next unlock, which comes from one.
 */

import * as Sentry from "@sentry/nextjs";
import type {
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  GainNodeLike,
} from "../sound";
import {
  RADIO_STATIONS,
  nextStationAfter,
  stationById,
  trackUrl,
  type RadioStation,
} from "./stations";

/** The slice of an `<audio>` element the radio drives; a fake in tests. */
export type MediaElementLike = {
  src: string;
  currentTime: number;
  preload: string;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: "ended", listener: () => void): void;
  removeEventListener(type: "ended", listener: () => void): void;
};

/** What the settings say about the radio when the runtime is built. */
export type RadioSettings = { enabled: boolean; stationId?: string };

/** Everything a radio is built from. */
export type RadioOptions = {
  context: AudioContextLike;
  /** The node the radio plays into — the sound layer's master gain. */
  destination: AudioNodeLike;
  element: MediaElementLike;
  /** The element's node in the graph (`createMediaElementSource(element)`). */
  source: AudioNodeLike;
  stations: RadioStation[];
  stationId?: string;
  enabled: boolean;
};

/** The radio the runtime drives. */
export type RadioPlayer = {
  /** From a gesture: primes the element silently so later plays are allowed, and retries a refused play. */
  unlock(): void;
  /** Plays while true, pauses — keeping the position — while false. */
  setInCar(inCar: boolean): void;
  /** The Radio setting. Off pauses and loads nothing. */
  setEnabled(enabled: boolean): void;
  /** The Geluid setting, forwarded by the sound layer. */
  setSoundEnabled(enabled: boolean): void;
  /** Tunes to a station by id (unknown: the first); a change starts it from the top. */
  tune(stationId: string): RadioStation | null;
  /** The next station on the dial, from the top. */
  nextStation(): RadioStation | null;
  /** The station tuned in, or `null` without a dial. */
  station(): RadioStation | null;
  /** True while a track is wanted audible: in a car, Radio on, Geluid on, a dial to play. */
  playing(): boolean;
  /** Dips the volume under a loud effect and ramps it back. */
  duck(): void;
  dispose(): void;
};

/** How a radio is attached to the sound layer, mirroring `SamplePlayerFactory`. */
export type RadioFactory = (
  context: AudioContextLike,
  destination: AudioNodeLike,
) => RadioPlayer | null;

/** The radio's level relative to the master gain: under the effects, over the engine. */
export const RADIO_GAIN = 0.5;
/** The share of its level the radio drops to under a shot or an explosion. */
export const DUCK_LEVEL = 0.35;
/** Seconds the radio takes to come back up after a duck. */
export const DUCK_S = 0.3;

/** What `play()` rejects with when the browser wants a gesture first. */
const NOT_ALLOWED = "NotAllowedError";
/** What `play()` rejects with when a pause interrupted the start; routine, not news. */
const ABORTED = "AbortError";

function reportRadioError(error: unknown, kind: string): void {
  Sentry.captureException(error, { tags: { area: "arena", kind } });
}

function setParam(param: AudioParamLike, value: number, time: number): void {
  param.setValueAtTime(value, time);
}

function rampParam(param: AudioParamLike, value: number, time: number): void {
  if (param.linearRampToValueAtTime) param.linearRampToValueAtTime(value, time);
  else setParam(param, value, time);
}

/**
 * Creates a radio over an element already attached to the graph.
 *
 * @param options - The context, the graph nodes, the element, the dial and the settings.
 * @returns The radio.
 */
export function createRadio(options: RadioOptions): RadioPlayer {
  const { context, element, source, stations } = options;
  let current = stationById(options.stationId, stations);
  let trackIndex = 0;
  let loaded: string | null = null;
  let inCar = false;
  let enabled = options.enabled;
  let soundOn = true;
  let primed = false;
  let refused = false;
  let disposed = false;
  const gain: GainNodeLike = context.createGain();
  setParam(gain.gain, 0, context.currentTime);
  source.connect(gain);
  gain.connect(options.destination);

  const wantsPlay = (): boolean =>
    !disposed &&
    inCar &&
    enabled &&
    soundOn &&
    current !== null &&
    current.tracks.length > 0;

  /** Points the element at the current track when it is not already there. */
  function load(): void {
    const track = current?.tracks[trackIndex];
    if (!track) return;
    const url = trackUrl(track);
    if (loaded === url) return;
    element.src = url;
    loaded = url;
  }

  /** Plays; a refusal before a gesture waits for the next unlock, a pause mid-start is routine. */
  function play(): void {
    element.play().catch((error: unknown) => {
      if (error instanceof Error && error.name === NOT_ALLOWED) refused = true;
      else if (!(error instanceof Error && error.name === ABORTED))
        reportRadioError(error, "radio-play");
    });
  }

  /**
   * A silent play-then-pause inside a gesture: from here on the element may play from the frame
   * loop, on iOS included. The gain stays at zero until a car wants it.
   */
  function prime(): void {
    load();
    element
      .play()
      .then(() => {
        if (!wantsPlay()) element.pause();
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === NOT_ALLOWED)
          refused = true;
      });
  }

  /** Makes the element match what the radio wants right now. */
  function apply(): void {
    if (disposed) return;
    if (!wantsPlay()) {
      setParam(gain.gain, 0, context.currentTime);
      element.pause();
      return;
    }
    load();
    setParam(gain.gain, RADIO_GAIN, context.currentTime);
    play();
  }

  /** The next track of the playlist, wrapping. */
  function onEnded(): void {
    if (!current || current.tracks.length === 0) return;
    trackIndex = (trackIndex + 1) % current.tracks.length;
    loaded = null;
    apply();
  }
  element.addEventListener("ended", onEnded);

  function tune(stationId: string): RadioStation | null {
    const station = stationById(stationId, stations);
    if (!station || station === current) return station;
    current = station;
    trackIndex = 0;
    loaded = null;
    apply();
    return station;
  }

  return {
    unlock(): void {
      if (disposed || !current || !enabled) return;
      if (!primed) {
        primed = true;
        prime();
      }
      if (refused) {
        refused = false;
        apply();
      }
    },
    setInCar(next: boolean): void {
      if (next === inCar) return;
      inCar = next;
      apply();
    },
    setEnabled(next: boolean): void {
      enabled = next;
      apply();
    },
    setSoundEnabled(next: boolean): void {
      soundOn = next;
      apply();
    },
    tune,
    nextStation(): RadioStation | null {
      if (!current) return null;
      return tune(nextStationAfter(current.id, stations)?.id ?? "");
    },
    station: () => current,
    playing: wantsPlay,
    duck(): void {
      if (!wantsPlay()) return;
      const now = context.currentTime;
      setParam(gain.gain, RADIO_GAIN * DUCK_LEVEL, now);
      rampParam(gain.gain, RADIO_GAIN, now + DUCK_S);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      try {
        element.pause();
        element.removeEventListener("ended", onEnded);
        source.disconnect();
        gain.disconnect();
      } catch (error: unknown) {
        reportRadioError(error, "radio-dispose");
      }
    },
  };
}

/**
 * The radio for a browser context, or `null` where there is no dial, no document, or no way to
 * attach media to Web Audio — in which case the game simply has no radio.
 *
 * @param context - The context the sound layer created.
 * @param destination - The node to play into: the master gain.
 * @param settings - The Radio setting and the station tuned in.
 * @returns The radio, or `null`.
 */
export function browserRadio(
  context: AudioContextLike,
  destination: AudioNodeLike,
  settings: RadioSettings,
): RadioPlayer | null {
  if (typeof document === "undefined" || !context.createMediaElementSource)
    return null;
  if (RADIO_STATIONS.length === 0) return null;
  try {
    const element = document.createElement("audio");
    element.preload = "none";
    const source = context.createMediaElementSource(element);
    return createRadio({
      context,
      destination,
      element,
      source,
      stations: RADIO_STATIONS,
      stationId: settings.stationId,
      enabled: settings.enabled,
    });
  } catch (error: unknown) {
    reportRadioError(error, "radio-init");
    return null;
  }
}
