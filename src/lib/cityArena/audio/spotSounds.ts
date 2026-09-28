/**
 * Spot sounds (immersion spec §6): short sounds from real sources near the listener, rate-limited
 * and randomised — a snatch of chatter from someone walking by, a bicycle bell and a scooter on
 * the street, a dog in the park, a horn from a passing car, the Cunera tower's bell in Rhenen.
 * Pure and seeded: the same seed and the same world ask for the same sounds.
 */

import { createRng } from "../sim/rng";
import type { ClipName } from "./clips";
import type { SoundPoint } from "./eventVoices";
import type { Listener } from "./spatial";
import type { Surroundings } from "./surroundings";
import type { TrafficSource } from "./trafficVoices";

/** The kinds of spot sound. */
export type SpotKind =
  "chatter" | "bike-bell" | "dog" | "horn" | "church-bell" | "scooter";

/** One spot sound to play: which, from which clip, and where. */
export type SpotRequest = {
  kind: SpotKind;
  clip: ClipName;
  x: number;
  y: number;
};

/** A landmark a spot sound can come from. */
export type SpotLandmark = { id: string; x: number; y: number };

/** What is near the listener this frame. */
export type SpotNearby = {
  peds: readonly SoundPoint[];
  traffic: readonly TrafficSource[];
  surroundings: Surroundings;
};

/** The scheduler. */
export type SpotScheduler = {
  /** Moves the clocks on by `dt` and returns the sounds due now. */
  step(
    dt: number,
    listener: Listener,
    nearby: SpotNearby,
    landmarks: readonly SpotLandmark[],
  ): SpotRequest[];
};

/** The murmured snatches of chatter, one picked at random each time. */
export const CHATTER_CLIPS: readonly ClipName[] = [
  "chatter-1",
  "chatter-2",
  "chatter-3",
  "chatter-4",
];
/** The landmark whose bell tolls: the Cunerakerk in Rhenen (`mapBuild/landmarks.config.ts`). */
export const CHURCH_LANDMARK_ID = "cunerakerk";
/** How close to the church its bell is heard, metres. */
export const CHURCH_BELL_RANGE_M = 700;
/** How close a person must be for their chatter to be heard, metres. */
const CHATTER_RANGE_M = 18;
/** How close a car must be for its horn, metres. */
const HORN_RANGE_M = 60;
/** Weighted road metres around that make a street for bells and scooters. */
const STREET_MIN_ROAD_M = 40;
/** Green ground share, or trees, that make a place for dogs. */
const DOG_MIN_GREEN_SHARE = 0.2;
const DOG_MIN_TREES = 5;
/** How far from the listener a dog barks, metres. */
const DOG_NEAR_M = 15;
const DOG_FAR_M = 40;
/** How far along the street a bell or scooter may sit from the nearest road point, metres. */
const STREET_JITTER_M = 12;
/** Below this speed a car is parked and does not honk, m/s. */
const HORN_MIN_SPEED_MPS = 2;

/** Everything a rule can place a sound by. */
type SpotScene = SpotNearby & {
  listener: Listener;
  landmarks: readonly SpotLandmark[];
};

/** How often one kind sounds, and where it comes from — `null` when nothing fits. */
type SpotRule = {
  kind: SpotKind;
  minS: number;
  maxS: number;
  place(
    scene: SpotScene,
    random: () => number,
  ): { clip: ClipName; point: SoundPoint } | null;
};

/** One of `items`, picked at random, or `undefined` for none. */
function pick<Item>(
  items: readonly Item[],
  random: () => number,
): Item | undefined {
  return items[Math.floor(random() * items.length)];
}

/** The points within `rangeM` of the listener. */
function near<Point extends SoundPoint>(
  points: readonly Point[],
  listener: Listener,
  rangeM: number,
): Point[] {
  return points.filter(
    (point) => Math.hypot(point.x - listener.x, point.y - listener.y) <= rangeM,
  );
}

/** A point on the street near the listener, or `null` off the streets. */
function streetPoint(
  scene: SpotScene,
  random: () => number,
): SoundPoint | null {
  const { roadM, nearestRoad } = scene.surroundings;
  if (roadM < STREET_MIN_ROAD_M || !nearestRoad) return null;
  const jitter = (): number => (random() * 2 - 1) * STREET_JITTER_M;
  return { x: nearestRoad.x + jitter(), y: nearestRoad.y + jitter() };
}

/** A spot somewhere in the green around the listener, or `null` among the houses. */
function greenPoint(scene: SpotScene, random: () => number): SoundPoint | null {
  const { greenShare, trees } = scene.surroundings;
  if (greenShare < DOG_MIN_GREEN_SHARE && trees < DOG_MIN_TREES) return null;
  const bearing = random() * 2 * Math.PI;
  const distance = DOG_NEAR_M + random() * (DOG_FAR_M - DOG_NEAR_M);
  return {
    x: scene.listener.x + Math.cos(bearing) * distance,
    y: scene.listener.y + Math.sin(bearing) * distance,
  };
}

/** A single-clip rule placed by `where`. */
function atPoint(
  clip: ClipName,
  where: (
    scene: SpotScene,
    random: () => number,
  ) => SoundPoint | null | undefined,
): SpotRule["place"] {
  return (scene, random) => {
    const point = where(scene, random);
    return point ? { clip, point } : null;
  };
}

/** Per kind: the interval between sounds, seconds, and where the sound comes from. */
const SPOT_RULES: readonly SpotRule[] = [
  {
    kind: "chatter",
    minS: 4,
    maxS: 9,
    place(scene, random) {
      const ped = pick(
        near(scene.peds, scene.listener, CHATTER_RANGE_M),
        random,
      );
      const clip = pick(CHATTER_CLIPS, random);
      return ped && clip ? { clip, point: ped } : null;
    },
  },
  {
    kind: "bike-bell",
    minS: 25,
    maxS: 60,
    place: atPoint("bike-bell", streetPoint),
  },
  { kind: "dog", minS: 40, maxS: 90, place: atPoint("dog", greenPoint) },
  {
    kind: "horn",
    minS: 20,
    maxS: 45,
    place: atPoint("horn", (scene, random) =>
      pick(
        near(scene.traffic, scene.listener, HORN_RANGE_M).filter(
          (car) => car.speedMps >= HORN_MIN_SPEED_MPS,
        ),
        random,
      ),
    ),
  },
  {
    kind: "church-bell",
    minS: 180,
    maxS: 300,
    place: atPoint("church-bell", (scene) =>
      near(
        scene.landmarks.filter(
          (landmark) => landmark.id === CHURCH_LANDMARK_ID,
        ),
        scene.listener,
        CHURCH_BELL_RANGE_M,
      ).at(0),
    ),
  },
  {
    kind: "scooter",
    minS: 30,
    maxS: 70,
    place: atPoint("scooter", streetPoint),
  },
];

/**
 * Creates a seeded spot-sound scheduler. Each kind waits a random interval within its range;
 * when it is up, the kind sounds if something near can make it, and waits a fresh interval
 * either way.
 *
 * @param seed - Seeds the intervals and the picks.
 * @returns The scheduler.
 */
export function createSpotScheduler(seed: number): SpotScheduler {
  const random = createRng(seed);
  const interval = (rule: SpotRule): number =>
    rule.minS + random() * (rule.maxS - rule.minS);
  const waits = SPOT_RULES.map(interval);
  return {
    step(dt, listener, nearby, landmarks): SpotRequest[] {
      const scene: SpotScene = { ...nearby, listener, landmarks };
      const requests: SpotRequest[] = [];
      SPOT_RULES.forEach((rule, index) => {
        waits[index] = (waits[index] ?? 0) - dt;
        if ((waits[index] ?? 0) > 0) return;
        waits[index] = interval(rule);
        const placed = rule.place(scene, random);
        if (!placed) return;
        const { x, y } = placed.point;
        requests.push({ kind: rule.kind, clip: placed.clip, x, y });
      });
      return requests;
    },
  };
}

/** People closer than this are heard walking, metres (spec §6: "within a few metres"). */
const PED_STEP_RANGE_M = 6;
/** Seconds between a nearby walker's footfalls. */
export const PED_STEP_INTERVAL_S = 0.5;

/** A walker's footfalls near the listener. */
export type PedSteps = {
  /** Moves the clock on by `dt`; where a footfall sounds now, or `null`. */
  step(
    dt: number,
    listener: Listener,
    peds: readonly SoundPoint[],
  ): SoundPoint | null;
};

/**
 * The footsteps of the nearest person within {@link PED_STEP_RANGE_M}: one every
 * {@link PED_STEP_INTERVAL_S} while someone is that close, placed where they walk.
 *
 * @returns The tracker.
 */
export function createPedSteps(): PedSteps {
  let waitS = 0;
  return {
    step(dt, listener, peds): SoundPoint | null {
      waitS -= dt;
      if (waitS > 0) return null;
      const distance = (ped: SoundPoint): number =>
        Math.hypot(ped.x - listener.x, ped.y - listener.y);
      const walker = near(peds, listener, PED_STEP_RANGE_M).sort(
        (first, second) => distance(first) - distance(second),
      )[0];
      if (!walker) return null;
      waitS = PED_STEP_INTERVAL_S;
      return { x: walker.x, y: walker.y };
    },
  };
}
