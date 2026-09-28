/**
 * The spot sounds playing (immersion spec §6): the seeded scheduler's chatter, bells, dogs, horns
 * and scooters, and the footsteps of whoever walks close by, each placed where it comes from.
 * Part of Omgevingsgeluid: nothing sounds while the setting is off, and a missing clip is silent.
 */

import type { ClipName } from "./clips";
import type { SoundPoint } from "./eventVoices";
import type { SamplePlayer } from "./samples";
import {
  MIN_AUDIBLE_GAIN,
  SOUND_PROFILES,
  spatialMix,
  type Listener,
  type SoundClass,
} from "./spatial";
import {
  createPedSteps,
  createSpotScheduler,
  type SpotKind,
  type SpotLandmark,
  type SpotRequest,
} from "./spotSounds";
import type { Surroundings } from "./surroundings";
import type { TrafficSource } from "./trafficVoices";

/** What the street is made of this frame. */
export type StreetWorld = {
  dt: number;
  peds: readonly SoundPoint[];
  /** The people on the move, whose footsteps can be heard. */
  walkers: readonly SoundPoint[];
  traffic: readonly TrafficSource[];
  landmarks: readonly SpotLandmark[];
};

/** The spot sounds and the passers-by's footsteps. */
export type StreetLife = {
  /** Moves the clocks on by a frame and plays what is due; `on` is Omgevingsgeluid. */
  update(
    world: StreetWorld,
    listener: Listener,
    surroundings: Surroundings,
    on: boolean,
  ): void;
  /** The last few spot sounds asked for, newest last. */
  recent(): SpotRequest[];
};

/** How many recent spot sounds the debug seam keeps. */
const RECENT_SPOTS = 8;
/** A passer-by's footsteps play at this share of the player's own. */
const PED_STEP_GAIN = 0.5;
/** How each kind carries: chatter is close, the church bell carries across town. */
const SPOT_CLASS: Readonly<Record<SpotKind, SoundClass>> = {
  chatter: "chatter",
  "bike-bell": "spot",
  dog: "spot",
  horn: "spot",
  "church-bell": "bell",
  scooter: "spot",
};

/**
 * Creates the street life over the sample player.
 *
 * @param player - The sample player, looked up each frame: it may not exist yet.
 * @param seed - Seeds the spot-sound scheduler.
 * @returns The street life, silent until its first update.
 */
export function createStreetLife(
  player: () => SamplePlayer | null,
  seed: number,
): StreetLife {
  const scheduler = createSpotScheduler(seed);
  const pedSteps = createPedSteps();
  let recent: SpotRequest[] = [];
  const playAt = (
    clip: ClipName,
    point: SoundPoint,
    listener: Listener,
    placing: { soundClass: SoundClass; gainScale: number },
  ): void => {
    const profile = SOUND_PROFILES[placing.soundClass];
    const mix = spatialMix(listener, point.x, point.y, profile);
    if (mix.gain >= MIN_AUDIBLE_GAIN)
      player()?.play(clip, 1, placing.gainScale, mix);
  };
  return {
    update(world, listener, surroundings, on): void {
      if (!on) return;
      const nearby = { ...world, surroundings };
      const due = scheduler.step(world.dt, listener, nearby, world.landmarks);
      for (const request of due)
        playAt(request.clip, request, listener, {
          soundClass: SPOT_CLASS[request.kind],
          gainScale: 1,
        });
      recent = [...recent, ...due].slice(-RECENT_SPOTS);
      const step = pedSteps.step(world.dt, listener, world.walkers);
      if (step)
        playAt("footstep", step, listener, {
          soundClass: "footstep",
          gainScale: PED_STEP_GAIN,
        });
    },
    recent: () => [...recent],
  };
}
