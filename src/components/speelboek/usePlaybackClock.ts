"use client";

import { useLayoutEffect, useState } from "react";

/** How often a playing drill advances. Divides both play durations. */
const TICK_MS = 25;

/**
 * Walks through `stepCount` steps while `playing` is set. Each step lasts
 * `durationMs`; `t` runs from 0 to 1 inside the current step. `finished`
 * becomes true once the last step has played out.
 */
export function usePlaybackClock(
  playing: boolean,
  stepCount: number,
  durationMs: number,
): { index: number; t: number; finished: boolean } {
  const [index, setIndex] = useState(0);
  const [t, setT] = useState(0);
  const [finished, setFinished] = useState(false);

  useLayoutEffect(() => {
    if (!playing || stepCount < 1 || durationMs <= 0) return;
    const total = stepCount * durationMs;
    let elapsed = 0;
    setIndex(0);
    setT(0);
    setFinished(false);
    const id = window.setInterval(() => {
      elapsed += TICK_MS;
      if (elapsed >= total) {
        window.clearInterval(id);
        setIndex(stepCount - 1);
        setT(1);
        setFinished(true);
        return;
      }
      const step = Math.floor(elapsed / durationMs);
      setIndex(step);
      setT((elapsed - step * durationMs) / durationMs);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [playing, stepCount, durationMs]);

  return { index, t, finished };
}
