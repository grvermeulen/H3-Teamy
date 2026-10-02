"use client";

/**
 * What one simulation tick feels like: sound, haptics and the on-screen feedback, all fed from
 * the same `state.events` so nothing is heard that is not also felt.
 *
 * Called for every tick — including each tick of a catch-up burst — by whichever loop is
 * stepping the world: the offline stepper, the host loop and the client loop alike.
 */

import type { EventSources } from "@/lib/cityArena/audio/eventVoices";
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
 * What the sound layer needs to voice a tick's events: who this client is, and where a car is.
 *
 * @param state - The state after the tick.
 * @param selfId - This client's player id.
 * @returns The lookups.
 */
export function eventSources(state: ArenaState, selfId: number): EventSources {
  return {
    selfId,
    vehicleAt: (id) =>
      state.vehicles.find((vehicle) => vehicle.id === id) ?? null,
  };
}

/**
 * Feeds one tick's events to the sound, the haptics and the feedback state.
 *
 * @param runtime - The runtime, whose `feedback` is replaced with this tick's.
 * @param state - The state after the tick, with the events it produced.
 */
export function feelTick(runtime: FeelRuntime, state: ArenaState): void {
  runtime.sound.handleEvents(
    state.events,
    eventSources(state, runtime.netplay.playerId),
  );
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
