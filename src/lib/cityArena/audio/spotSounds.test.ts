import { describe, expect, it } from "vitest";
import type { Listener } from "./spatial";
import {
  CHATTER_CLIPS,
  CHURCH_BELL_RANGE_M,
  CHURCH_LANDMARK_ID,
  PED_STEP_INTERVAL_S,
  createPedSteps,
  createSpotScheduler,
  type SpotLandmark,
  type SpotNearby,
  type SpotRequest,
} from "./spotSounds";
import { EMPTY_SURROUNDINGS } from "./surroundings";

const SEED = 20260927;
const FRAME_S = 0.1;
const here: Listener = { x: 0, y: 0, facing: 0 };
const quiet: SpotNearby = {
  peds: [],
  traffic: [],
  surroundings: EMPTY_SURROUNDINGS,
};
const church: SpotLandmark = { id: CHURCH_LANDMARK_ID, x: 400, y: 0 };

/** Every request over `seconds` of frames, with the world held still. */
function run(
  seconds: number,
  nearby: SpotNearby,
  landmarks: readonly SpotLandmark[] = [],
  listener: Listener = here,
  seed = SEED,
): SpotRequest[] {
  const scheduler = createSpotScheduler(seed);
  const requests: SpotRequest[] = [];
  for (let elapsed = 0; elapsed < seconds; elapsed += FRAME_S)
    requests.push(...scheduler.step(FRAME_S, listener, nearby, landmarks));
  return requests;
}

/** The requests of one kind. */
function ofKind(
  requests: SpotRequest[],
  kind: SpotRequest["kind"],
): SpotRequest[] {
  return requests.filter((request) => request.kind === kind);
}

describe("createSpotScheduler", () => {
  it("never chatters with nobody near", () => {
    expect(ofKind(run(120, quiet), "chatter")).toEqual([]);
    const farOff = { ...quiet, peds: [{ x: 40, y: 0 }] };
    expect(ofKind(run(120, farOff), "chatter")).toEqual([]);
  });

  it("chatters from a person near within its interval, placed on them, from a chatter clip", () => {
    const walker = { x: 6, y: -3 };
    const chatter = ofKind(run(9.5, { ...quiet, peds: [walker] }), "chatter");
    expect(chatter.length).toBeGreaterThanOrEqual(1);
    expect(chatter[0]).toMatchObject({ x: 6, y: -3 });
    expect(CHATTER_CLIPS).toContain(chatter[0]!.clip);
    const minute = ofKind(run(60, { ...quiet, peds: [walker] }), "chatter");
    expect(minute.length).toBeGreaterThanOrEqual(60 / 9);
    expect(minute.length).toBeLessThanOrEqual(60 / 4 + 1);
  });

  it("tolls the church bell only within earshot of the Cunerakerk, from the tower", () => {
    const nearChurch = ofKind(run(301, quiet, [church]), "church-bell");
    expect(nearChurch).toHaveLength(1);
    expect(nearChurch[0]).toMatchObject({ clip: "church-bell", x: 400, y: 0 });
    const farAway: Listener = { x: -CHURCH_BELL_RANGE_M, y: 0, facing: 0 };
    expect(ofKind(run(900, quiet, [church], farAway), "church-bell")).toEqual(
      [],
    );
    const otherLandmark = { ...church, id: "klein-zwitserland" };
    expect(ofKind(run(900, quiet, [otherLandmark]), "church-bell")).toEqual([]);
  });

  it("honks from a moving car within 60 m, at the car", () => {
    const car = { id: 3, x: 30, y: 10, speedMps: 9, siren: false };
    const horns = ofKind(run(46, { ...quiet, traffic: [car] }), "horn");
    expect(horns.length).toBeGreaterThanOrEqual(1);
    expect(horns[0]).toMatchObject({ clip: "horn", x: 30, y: 10 });
    const parked = { ...car, speedMps: 0 };
    expect(ofKind(run(200, { ...quiet, traffic: [parked] }), "horn")).toEqual(
      [],
    );
  });

  it("rings bells and runs scooters on the street, and barks among the trees, not elsewhere", () => {
    const street = {
      ...quiet,
      surroundings: {
        ...EMPTY_SURROUNDINGS,
        roadM: 200,
        nearestRoad: { x: 10, y: 20 },
      },
    };
    const onStreet = run(200, street);
    expect(ofKind(onStreet, "bike-bell").length).toBeGreaterThanOrEqual(1);
    expect(ofKind(onStreet, "scooter").length).toBeGreaterThanOrEqual(1);
    for (const request of ofKind(onStreet, "bike-bell"))
      expect(Math.hypot(request.x - 10, request.y - 20)).toBeLessThan(20);
    expect(ofKind(onStreet, "dog")).toEqual([]);
    const park = {
      ...quiet,
      surroundings: { ...EMPTY_SURROUNDINGS, greenShare: 0.8 },
    };
    const inPark = run(200, park);
    expect(ofKind(inPark, "dog").length).toBeGreaterThanOrEqual(1);
    expect(ofKind(inPark, "bike-bell")).toEqual([]);
  });

  it("asks for the same sounds for the same seed", () => {
    const busy = {
      ...quiet,
      peds: [
        { x: 2, y: 2 },
        { x: -3, y: 4 },
      ],
    };
    expect(run(60, busy)).toEqual(run(60, busy));
    expect(run(60, busy, [], here, SEED + 1)).not.toEqual(run(60, busy));
  });
});

describe("createPedSteps", () => {
  it("steps where the nearest person within a few metres walks, every half second", () => {
    const steps = createPedSteps();
    const peds = [
      { x: 5, y: 0 },
      { x: 2, y: 1 },
    ];
    expect(steps.step(FRAME_S, here, peds)).toEqual({ x: 2, y: 1 });
    expect(steps.step(FRAME_S, here, peds)).toBeNull();
    expect(steps.step(PED_STEP_INTERVAL_S, here, peds)).toEqual({ x: 2, y: 1 });
    expect(createPedSteps().step(FRAME_S, here, [{ x: 9, y: 0 }])).toBeNull();
  });
});
