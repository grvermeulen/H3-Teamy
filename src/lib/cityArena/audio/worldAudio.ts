/**
 * The city heard around the listener (immersion spec §6): engine loops on the nearest moving
 * cars, the siren on the nearest police cars, the ambient bed levelled from the surroundings, and
 * the street life — spot sounds and passers-by's steps. Fed once per frame by the sound layer with
 * the scene; the loops follow what they are told, so a car can be heard coming, passing and
 * driving off.
 */

import type { DecodedTile } from "../world/decode";
import type { AmbienceLoop } from "./ambience";
import { createAmbienceBed } from "./ambienceBed";
import type { ClipName } from "./clips";
import type { SoundPoint } from "./eventVoices";
import { engineRate } from "./engineRate";
import { createLoopSlot, type LoopSlot, type LoopTarget } from "./loopSlot";
import type { SamplePlayer } from "./samples";
import type { SpotLandmark, SpotRequest } from "./spotSounds";
import { createStreetLife } from "./streetLife";
import { SOUND_PROFILES, spatialMix, type Listener } from "./spatial";
import type { Surroundings } from "./surroundings";
import {
  ENGINE_VOICES,
  SIREN_VOICES,
  assignVoices,
  type TrafficSource,
} from "./trafficVoices";

/** What the sound layer is told about the world each frame. */
export type WorldSounds = {
  /** Seconds since the previous frame. */
  dt: number;
  /** The cars that can be heard: moving traffic and other players' cars, not the listener's own. */
  traffic: readonly TrafficSource[];
  /** The people about, alive, where they are drawn. */
  peds: readonly SoundPoint[];
  /** The decoded map tiles around the listener. */
  tiles: readonly DecodedTile[];
  /** The landmarks, in metres: the church bell tolls from one. */
  landmarks: readonly SpotLandmark[];
};

/** What the debug seam shows of the world's voices. */
export type WorldAudioSnapshot = {
  /** The car each engine voice follows, `null` for a free voice. */
  engines: (number | null)[];
  /** The car each siren voice follows. */
  sirens: (number | null)[];
  /** The level each ambience loop plays at, 0…1. */
  ambience: Record<AmbienceLoop, number>;
  /** What the ambience last read around the listener. */
  surroundings: Surroundings;
  /** The last few spot sounds, newest last. */
  spots: SpotRequest[];
};

/** The city's loops. */
export type WorldAudio = {
  /** Moves every loop for this frame's world and listener; `ambience` is Omgevingsgeluid. */
  update(world: WorldSounds, listener: Listener, ambience: boolean): void;
  /** Stops every loop. */
  stop(): void;
  snapshot(): WorldAudioSnapshot;
};

/** Below this speed a car is parked and its engine is not heard, m/s. */
export const MIN_MOVING_MPS = 0.5;
/** At this speed and above a passing car is heard at its full level, m/s. */
export const TRAFFIC_FULL_LEVEL_MPS = 12;
/** A traffic engine's level relative to the engine clip, which is recorded from inside a car. */
const TRAFFIC_ENGINE_LEVEL = 0.8;
/** Seconds an engine or siren voice stays running silent before it is stopped. */
const TRAFFIC_IDLE_STOP_S = 3;

/** A pool of voices on one clip, and which car each follows. */
type TrafficPool = {
  slots: LoopSlot[];
  cars: (number | null)[];
  /** Which cars may have a voice, for this listener. */
  accepts(source: TrafficSource, listener: Listener): boolean;
  /** Where the voice on `source` sits, and at what rate. */
  target(source: TrafficSource, listener: Listener): LoopTarget;
};

/** True when `source` is within `rangeM` of the listener. */
function within(
  source: TrafficSource,
  listener: Listener,
  rangeM: number,
): boolean {
  return Math.hypot(source.x - listener.x, source.y - listener.y) <= rangeM;
}

/** `count` voices on `clip`, none following a car yet. */
function pool(
  player: () => SamplePlayer | null,
  clip: ClipName,
  count: number,
  rules: Pick<TrafficPool, "accepts" | "target">,
): TrafficPool {
  return {
    slots: Array.from({ length: count }, () =>
      createLoopSlot(player, clip, TRAFFIC_IDLE_STOP_S),
    ),
    cars: Array.from({ length: count }, () => null),
    ...rules,
  };
}

/** Engines: moving cars within earshot, louder and higher the faster they go. */
const ENGINE_RULES: Pick<TrafficPool, "accepts" | "target"> = {
  accepts: (source, listener) =>
    source.speedMps >= MIN_MOVING_MPS &&
    within(source, listener, SOUND_PROFILES.engine.maxDistanceM),
  target(source, listener) {
    const mix = spatialMix(listener, source.x, source.y, SOUND_PROFILES.engine);
    const speedShare = Math.min(1, source.speedMps / TRAFFIC_FULL_LEVEL_MPS);
    return {
      mix: { ...mix, gain: mix.gain * speedShare * TRAFFIC_ENGINE_LEVEL },
      rate: engineRate(source.speedMps),
    };
  },
};

/** Sirens: police cars within earshot, whatever their speed. */
const SIREN_RULES: Pick<TrafficPool, "accepts" | "target"> = {
  accepts: (source, listener) =>
    source.siren && within(source, listener, SOUND_PROFILES.siren.maxDistanceM),
  target: (source, listener) => ({
    mix: spatialMix(listener, source.x, source.y, SOUND_PROFILES.siren),
  }),
};

/** Reassigns a pool's voices for this frame and moves each loop after its car. */
function updatePool(
  traffic: TrafficPool,
  world: WorldSounds,
  listener: Listener,
): void {
  traffic.cars = assignVoices(
    traffic.cars,
    world.traffic,
    listener,
    traffic.slots.length,
    (source) => traffic.accepts(source, listener),
  );
  traffic.slots.forEach((slot, index) => {
    const id = traffic.cars[index];
    const source = world.traffic.find((candidate) => candidate.id === id);
    slot.follow(source ? traffic.target(source, listener) : null, world.dt);
  });
}

/**
 * Creates the city's sound over the sample player.
 *
 * @param player - The sample player, looked up each frame: it may not exist yet.
 * @param seed - Seeds the spot sounds.
 * @returns The city, silent until {@link WorldAudio.update} is first called.
 */
export function createWorldAudio(
  player: () => SamplePlayer | null,
  seed: number,
): WorldAudio {
  const engines = pool(player, "engine", ENGINE_VOICES, ENGINE_RULES);
  const sirens = pool(player, "siren", SIREN_VOICES, SIREN_RULES);
  const pools = [engines, sirens];
  const bed = createAmbienceBed(player);
  const street = createStreetLife(player, seed);
  return {
    update(world: WorldSounds, listener: Listener, ambience: boolean): void {
      for (const traffic of pools) updatePool(traffic, world, listener);
      bed.update(world, listener, ambience);
      street.update(world, listener, bed.surroundings(), ambience);
    },
    stop(): void {
      for (const traffic of pools) {
        traffic.slots.forEach((slot) => slot.stop());
        traffic.cars = traffic.cars.map(() => null);
      }
      bed.stop();
    },
    snapshot: () => ({
      engines: [...engines.cars],
      sirens: [...sirens.cars],
      ambience: bed.levels(),
      surroundings: bed.surroundings(),
      spots: street.recent(),
    }),
  };
}
