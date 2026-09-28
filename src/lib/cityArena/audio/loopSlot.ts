/**
 * One looping voice that follows a moving target (immersion spec §6): a traffic engine, a siren,
 * an ambience bed. It starts on first need, eases after its target, fades out when the target
 * goes, and stops once it has been silent for a while — so a car that drives off, or a park that
 * is left behind, costs nothing after a few seconds.
 */

import type { ClipName } from "./clips";
import type { LoopHandle, SamplePlayer } from "./samples";
import { MIN_AUDIBLE_GAIN, type SpatialMix } from "./spatial";

/** Where a looping voice should be this frame, and at what playback rate. */
export type LoopTarget = { mix: SpatialMix; rate?: number };

/** A looping voice that follows a target. */
export type LoopSlot = {
  /** Places the loop at `target`, or fades it out with `null`; `dt` counts the silent seconds. */
  follow(target: LoopTarget | null, dt: number): void;
  /** Stops the loop at once. */
  stop(): void;
  /** True while the loop is running, audible or fading. */
  running(): boolean;
};

/**
 * Creates a looping voice for `clip`, silent until the clip has loaded.
 *
 * @param player - The sample player, looked up each time: it may not exist yet.
 * @param clip - The looping clip.
 * @param idleStopS - Seconds of silence after which the loop is stopped.
 * @returns The voice.
 */
export function createLoopSlot(
  player: () => SamplePlayer | null,
  clip: ClipName,
  idleStopS: number,
): LoopSlot {
  let handle: LoopHandle | null = null;
  let last: SpatialMix | null = null;
  let silentS = 0;

  function stop(): void {
    handle?.stop();
    handle = null;
    silentS = 0;
  }

  function fade(dt: number): void {
    if (!handle) return;
    if (silentS === 0 && last) handle.setPlacement({ ...last, gain: 0 });
    silentS += dt;
    if (silentS >= idleStopS) stop();
  }

  return {
    follow(target: LoopTarget | null, dt: number): void {
      if (!target || target.mix.gain < MIN_AUDIBLE_GAIN) {
        fade(dt);
        return;
      }
      silentS = 0;
      last = target.mix;
      if (handle) handle.setPlacement(target.mix);
      else {
        const samples = player();
        handle = samples?.has(clip)
          ? samples.startLoop(clip, target.mix)
          : null;
      }
      if (target.rate !== undefined) handle?.setRate(target.rate);
    },
    stop,
    running: () => handle !== null,
  };
}
