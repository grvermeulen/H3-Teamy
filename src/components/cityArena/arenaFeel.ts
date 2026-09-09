"use client";

/**
 * What one simulation tick feels like: sound, haptics and the on-screen feedback, all fed from
 * the same `state.events` so nothing is heard that is not also felt.
 *
 * Called for every tick — including each tick of a catch-up burst — by whichever loop is
 * stepping the world: the offline stepper, the host loop and the client loop alike.
 */

import { hapticPulses } from "@/lib/cityArena/input/haptics";
import { stepFeedback } from "@/lib/cityArena/render/feedback";
import { playerById } from "@/lib/cityArena/sim/players";
import type { ArenaState } from "@/lib/cityArena/sim/types";
import type { Runtime } from "./arenaRuntime";

/** The slice of the runtime a tick's feel touches. */
export type FeelRuntime = Pick<
  Runtime,
  "sound" | "haptics" | "feedback" | "netplay" | "reducedMotion"
>;

/**
 * Feeds one tick's events to the sound, the haptics and the feedback state.
 *
 * @param runtime - The runtime, whose `feedback` is replaced with this tick's.
 * @param state - The state after the tick, with the events it produced.
 */
export function feelTick(runtime: FeelRuntime, state: ArenaState): void {
  runtime.sound.handleEvents(state.events);
  const me = playerById(state, runtime.netplay.playerId);
  if (!me) return;
  const previous = runtime.feedback;
  for (const pulse of hapticPulses(state.events, me, previous.health))
    runtime.haptics.fire(pulse.kind, pulse.strength);
  runtime.feedback = stepFeedback(previous, {
    tick: state.tick,
    events: state.events,
    me,
    reducedMotion: runtime.reducedMotion,
  });
}
