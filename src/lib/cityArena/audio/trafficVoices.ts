/**
 * Which cars the engine and siren loops follow (immersion spec §6): a small pool of voices on the
 * nearest moving traffic, so cars can be heard passing, and the siren on the nearest police cars.
 * Pure: the sound layer asks every frame and moves its loops to whatever this assigns.
 */

import type { Listener } from "./spatial";

/** A car that can be heard: where it is, how fast it goes, and whether its siren is on. */
export type TrafficSource = {
  id: number;
  x: number;
  y: number;
  speedMps: number;
  siren: boolean;
};

/** Engine loops placed on the nearest moving cars. */
export const ENGINE_VOICES = 4;
/** Siren loops placed on the nearest police cars. */
export const SIREN_VOICES = 2;
/**
 * A car already holding a voice keeps it until a newcomer is this much closer, metres, so two
 * cars at nearly the same distance do not trade the voice back and forth every frame.
 */
export const VOICE_SWAP_MARGIN_M = 5;

/** A candidate for a voice: its id and how near it effectively is. */
type Candidate = { id: number; rankM: number };

/**
 * Stable assignment: keeps a car on its voice while it stays among the nearest, fills free voices
 * nearest-first, and frees a voice whose car left the running.
 *
 * @param previous - Last frame's assignment, one entry per voice (a car id, or `null` for free).
 * @param sources - Every car that might be heard.
 * @param listener - Where the ears are.
 * @param count - How many voices there are.
 * @param filter - Which cars may have a voice at all (moving, a siren, within earshot).
 * @returns This frame's assignment, one entry per voice.
 */
export function assignVoices(
  previous: readonly (number | null)[],
  sources: readonly TrafficSource[],
  listener: Listener,
  count: number,
  filter: (source: TrafficSource) => boolean,
): (number | null)[] {
  const holders = new Set(previous.filter((id): id is number => id !== null));
  const wanted = new Set(
    sources
      .filter(filter)
      .map((source): Candidate => ({
        id: source.id,
        rankM:
          Math.hypot(source.x - listener.x, source.y - listener.y) -
          (holders.has(source.id) ? VOICE_SWAP_MARGIN_M : 0),
      }))
      .sort((first, second) => first.rankM - second.rankM)
      .slice(0, count)
      .map((candidate) => candidate.id),
  );
  const slots = Array.from({ length: count }, (_, index) => {
    const id = previous[index] ?? null;
    return id !== null && wanted.has(id) ? id : null;
  });
  const newcomers = [...wanted].filter((id) => !slots.includes(id));
  return slots.map((id) => id ?? newcomers.shift() ?? null);
}
