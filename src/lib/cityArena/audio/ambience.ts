/**
 * The ambient bed (immersion spec §6): five seamless loops whose levels follow what surrounds the
 * listener — traffic on busy roads, a crowd among people, birds in parks and woods, wind over open
 * fields, water by the river. Pure: levels from surroundings, and the ease between them.
 */

import type { Surroundings } from "./surroundings";

/** The ambience loops, each a clip in the clip table. */
export type AmbienceLoop =
  "amb-traffic" | "amb-crowd" | "amb-birds" | "amb-wind" | "amb-water";

/** Every ambience loop, in a fixed order. */
export const AMBIENCE_LOOPS: readonly AmbienceLoop[] = [
  "amb-traffic",
  "amb-crowd",
  "amb-birds",
  "amb-wind",
  "amb-water",
];

/** Every loop silent: the bed before the first read, and with Omgevingsgeluid off. */
export const SILENT_AMBIENCE: Readonly<Record<AmbienceLoop, number>> = {
  "amb-traffic": 0,
  "amb-crowd": 0,
  "amb-birds": 0,
  "amb-wind": 0,
  "amb-water": 0,
};

/** Weighted road metres within 80 m that make traffic full on its own (a busy crossing). */
export const TRAFFIC_FULL_ROAD_M = 600;
/** Moving cars within 80 m that make traffic full on their own. */
export const TRAFFIC_FULL_CARS = 6;
/** People within 30 m that make a full crowd. */
export const CROWD_FULL_PEDS = 8;
/** Trees within 60 m that fill the birdsong on their own. */
export const BIRDS_FULL_TREES = 30;
/** How much a fully green ground adds to the birdsong. */
const BIRDS_GREEN_WEIGHT = 0.8;
/** Full traffic drowns this share of the birds. */
const BIRDS_TRAFFIC_MASK = 0.6;
/** How much a share of open field adds to the wind (fields at 80 % already blow in full). */
const WIND_FIELD_WEIGHT = 1.25;
/** How much open water adds to the wind. */
const WIND_WATER_WEIGHT = 0.5;
/** At this share of buildings the wind is fully sheltered. */
const WIND_SHELTER_BUILDINGS = 0.3;
/** Water on this share of the ground already runs at full. */
const WATER_FULL_SHARE = 0.4;
/** Seconds a loop's level takes to travel all the way from silent to full (spec: ≈ 1.5 s). */
export const AMBIENCE_EASE_S = 1.5;

/** Clamps to 0…1. */
function unit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * The level of each ambience loop for what surrounds the listener.
 *
 * @param surroundings - What is around.
 * @returns Each loop's level, 0…1.
 */
export function ambienceLevels(
  surroundings: Surroundings,
): Record<AmbienceLoop, number> {
  const {
    roadM,
    movingCars,
    peds,
    trees,
    greenShare,
    fieldShare,
    waterShare,
    buildingShare,
  } = surroundings;
  const traffic = unit(
    roadM / TRAFFIC_FULL_ROAD_M + movingCars / TRAFFIC_FULL_CARS,
  );
  const shelter = unit(buildingShare / WIND_SHELTER_BUILDINGS);
  return {
    "amb-traffic": traffic,
    "amb-crowd": unit(peds / CROWD_FULL_PEDS),
    "amb-birds":
      unit(trees / BIRDS_FULL_TREES + greenShare * BIRDS_GREEN_WEIGHT) *
      (1 - traffic * BIRDS_TRAFFIC_MASK),
    "amb-wind":
      unit(fieldShare * WIND_FIELD_WEIGHT + waterShare * WIND_WATER_WEIGHT) *
      (1 - shelter),
    "amb-water": unit(waterShare / WATER_FULL_SHARE),
  };
}

/**
 * Eases each level toward its target at a steady pace: a full swing takes
 * {@link AMBIENCE_EASE_S}, so walking out of a park lets the birds fade rather than stop.
 *
 * @param current - The levels playing now.
 * @param target - The levels the surroundings ask for.
 * @param dt - Seconds since the last ease.
 * @returns The levels to play next.
 */
export function easeAmbience(
  current: Readonly<Record<AmbienceLoop, number>>,
  target: Readonly<Record<AmbienceLoop, number>>,
  dt: number,
): Record<AmbienceLoop, number> {
  const step = dt / AMBIENCE_EASE_S;
  const next = { ...SILENT_AMBIENCE };
  for (const loop of AMBIENCE_LOOPS) {
    const gap = target[loop] - current[loop];
    next[loop] = current[loop] + Math.sign(gap) * Math.min(Math.abs(gap), step);
  }
  return next;
}
