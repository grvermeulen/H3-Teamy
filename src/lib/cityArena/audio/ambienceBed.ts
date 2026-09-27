/**
 * The ambient bed playing (immersion spec §6): the five ambience loops, levelled from the
 * surroundings — re-read at most every {@link SURROUNDINGS_READ_S} — and eased so a level never
 * jumps. A loop starts on first need and stops after {@link AMBIENCE_IDLE_STOP_S} of silence; a
 * missing clip is simply silent (there is no synthesised ambience).
 */

import type { DecodedTile } from "../world/decode";
import {
  AMBIENCE_LOOPS,
  SILENT_AMBIENCE,
  ambienceLevels,
  easeAmbience,
  type AmbienceLoop,
} from "./ambience";
import type { SoundPoint } from "./eventVoices";
import { createLoopSlot, type LoopSlot } from "./loopSlot";
import type { SamplePlayer } from "./samples";
import { OPEN_CUTOFF_HZ, type Listener } from "./spatial";
import {
  EMPTY_SURROUNDINGS,
  readSurroundings,
  type Surroundings,
} from "./surroundings";
import type { TrafficSource } from "./trafficVoices";

/** Seconds between two reads of the surroundings. */
export const SURROUNDINGS_READ_S = 0.5;
/** Seconds an ambience loop stays running silent before it is stopped. */
export const AMBIENCE_IDLE_STOP_S = 5;

/** What the bed reads the surroundings from each frame. */
export type BedWorld = {
  dt: number;
  tiles: readonly DecodedTile[];
  peds: readonly SoundPoint[];
  traffic: readonly TrafficSource[];
};

/** The ambient bed. */
export type AmbienceBed = {
  /** Moves the bed on by a frame; `on` is the Omgevingsgeluid setting. */
  update(world: BedWorld, listener: Listener, on: boolean): void;
  stop(): void;
  /** The level each loop plays at now, 0…1. */
  levels(): Record<AmbienceLoop, number>;
  /** What the last read found around the listener. */
  surroundings(): Surroundings;
};

/**
 * Creates the ambient bed over the sample player.
 *
 * @param player - The sample player, looked up each frame: it may not exist yet.
 * @returns The bed, silent until its first update.
 */
export function createAmbienceBed(
  player: () => SamplePlayer | null,
): AmbienceBed {
  const slot = (loop: AmbienceLoop): LoopSlot =>
    createLoopSlot(player, loop, AMBIENCE_IDLE_STOP_S);
  const slots: Record<AmbienceLoop, LoopSlot> = {
    "amb-traffic": slot("amb-traffic"),
    "amb-crowd": slot("amb-crowd"),
    "amb-birds": slot("amb-birds"),
    "amb-wind": slot("amb-wind"),
    "amb-water": slot("amb-water"),
  };
  let levels = { ...SILENT_AMBIENCE };
  let target = { ...SILENT_AMBIENCE };
  let around = EMPTY_SURROUNDINGS;
  let sinceReadS = SURROUNDINGS_READ_S;
  return {
    update(world: BedWorld, listener: Listener, on: boolean): void {
      sinceReadS += world.dt;
      if (!on) target = { ...SILENT_AMBIENCE };
      else if (sinceReadS >= SURROUNDINGS_READ_S) {
        around = readSurroundings(world.tiles, world, listener);
        target = ambienceLevels(around);
        sinceReadS = 0;
      }
      levels = easeAmbience(levels, target, world.dt);
      for (const loop of AMBIENCE_LOOPS)
        slots[loop].follow(
          { mix: { gain: levels[loop], pan: 0, cutoffHz: OPEN_CUTOFF_HZ } },
          world.dt,
        );
    },
    stop(): void {
      for (const loop of AMBIENCE_LOOPS) slots[loop].stop();
      levels = { ...SILENT_AMBIENCE };
      sinceReadS = SURROUNDINGS_READ_S;
    },
    levels: () => ({ ...levels }),
    surroundings: () => around,
  };
}
