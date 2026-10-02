import { describe, expect, it } from "vitest";
import { createArenaPlayer } from "../sim/arena";
import { SIM_STEP_S } from "../sim/player";
import type { ArenaState, VehicleState } from "../sim/types";
import { createVehicle } from "../sim/vehicle";
import {
  SMOOTH_SNAP_DISTANCE_M,
  smoothAlpha,
  smoothFrame,
  smoothedPlayer,
} from "./smoothing";

/** A world holding one car and one player, at `tick`. */
function stateWith(tick: number, vehicles: VehicleState[]): ArenaState {
  return {
    tick,
    seed: 1,
    nextId: 9,
    players: [createArenaPlayer([0, 0], 0)],
    vehicles,
    bullets: [],
    effects: [],
    zoneKey: null,
    peds: [],
    cops: [],
    pickups: [],
    traffic: [],
    events: [],
    activeZoneKey: null,
    zoneEnforced: false,
  };
}

/** A sedan at `x` metres along the x axis, heading `heading`. */
function carAt(x: number, heading = 0): VehicleState {
  return createVehicle(1, "sedan", [x, 0], heading, 0);
}

describe("smoothAlpha", () => {
  it("maps the leftover accumulator onto 0..1 and clamps both ends", () => {
    expect(smoothAlpha(0)).toBe(0);
    expect(smoothAlpha(SIM_STEP_S / 2)).toBeCloseTo(0.5, 10);
    expect(smoothAlpha(SIM_STEP_S)).toBe(1);
    // A frame so long the stepper hit its iteration cap must not extrapolate past the tick.
    expect(smoothAlpha(SIM_STEP_S * 4)).toBe(1);
    expect(smoothAlpha(-1)).toBe(0);
  });
});

describe("smoothFrame", () => {
  it("draws the car between the two ticks", () => {
    const frame = smoothFrame(
      stateWith(1, [carAt(0)]),
      stateWith(2, [carAt(4)]),
      0.25,
    );
    expect(frame.vehicles[0]!.x).toBeCloseTo(1, 10);
  });

  it("draws the previous tick at alpha 0 and the current one at alpha 1", () => {
    const previous = stateWith(1, [carAt(0)]);
    const current = stateWith(2, [carAt(4)]);
    // Alpha 0 is a real position — the tick just gone — not "leave it alone". At a clean 60 Hz
    // every other frame lands exactly here, so getting it wrong would re-introduce the judder.
    expect(smoothFrame(previous, current, 0).vehicles[0]!.x).toBeCloseTo(0, 10);
    expect(smoothFrame(previous, current, 1).vehicles[0]!.x).toBeCloseTo(4, 10);
  });

  it("turns the short way round when the heading wraps past ±π", () => {
    const previous = stateWith(1, [carAt(0, Math.PI - 0.1)]);
    const current = stateWith(2, [carAt(0, -Math.PI + 0.1)]);
    const { heading } = smoothFrame(previous, current, 0.5).vehicles[0]!;
    // Half way across the 0.2 rad gap at ±π, not half way round the other 6.08 rad.
    expect(Math.abs(heading)).toBeCloseTo(Math.PI, 6);
  });

  it("snaps a teleport instead of sliding the car across the map", () => {
    const previous = stateWith(1, [carAt(0)]);
    const current = stateWith(2, [carAt(SMOOTH_SNAP_DISTANCE_M + 50)]);
    expect(smoothFrame(previous, current, 0.5).vehicles[0]!.x).toBe(
      SMOOTH_SNAP_DISTANCE_M + 50,
    );
  });

  it("draws an entity that did not exist last tick where it is", () => {
    const frame = smoothFrame(stateWith(1, []), stateWith(2, [carAt(12)]), 0.5);
    expect(frame.vehicles[0]!.x).toBe(12);
  });

  it("hands back the state's own entities when there is nothing to blend against", () => {
    const current = stateWith(2, [carAt(4)]);
    // After a cut there is no honest previous pose; the frame must be the state itself.
    expect(smoothFrame(null, current, 0.5).vehicles).toBe(current.vehicles);
  });

  it("leaves the entities that never move alone", () => {
    const previous = stateWith(1, [carAt(0)]);
    const current = stateWith(2, [carAt(4)]);
    const frame = smoothFrame(previous, current, 0.5);
    expect(frame).not.toHaveProperty("pickups");
    expect(frame).not.toHaveProperty("effects");
  });
});

describe("smoothedPlayer", () => {
  it("finds the blended pose of one player, and reports a missing one", () => {
    const frame = smoothFrame(
      stateWith(1, [carAt(0)]),
      stateWith(2, [carAt(4)]),
      0.5,
    );
    const me = frame.players[0]!;
    expect(smoothedPlayer(frame, me.id)).toBe(me);
    expect(smoothedPlayer(frame, 404)).toBeNull();
  });
});

/**
 * The regression the whole module exists for: a 30 Hz stepper driven by 60 Hz frames, exactly as
 * `arenaRuntime` drives it, and the distance the car is *drawn* forward on each of those frames.
 */
function drawnDeltasAt(framesPerSecond: number, speedMps: number): number[] {
  const dt = 1 / framesPerSecond;
  let previous: ArenaState | null = null;
  let current = stateWith(0, [carAt(0)]);
  let accumulator = 0;
  const drawn: number[] = [];
  for (let frame = 0; frame < 60; frame++) {
    accumulator += dt;
    while (accumulator >= SIM_STEP_S) {
      // Mirrors recordStepped: the state being replaced becomes the pose to blend from.
      previous = current;
      current = stateWith(current.tick + 1, [
        carAt(current.vehicles[0]!.x + speedMps * SIM_STEP_S),
      ]);
      accumulator -= SIM_STEP_S;
    }
    drawn.push(
      smoothFrame(previous, current, smoothAlpha(accumulator)).vehicles[0]!.x,
    );
  }
  // Frames before the first tick have no pair to blend and sit at the spawn; measure from well
  // past that, once the loop is in its stride (the real one fades in from black over those frames).
  const settled = 10;
  return drawn
    .slice(settled)
    .map((x, index) => x - drawn[index + settled - 1]!);
}

describe("driving at 30 Hz on a faster display", () => {
  it("advances the car by an even amount every frame at 60 Hz", () => {
    const speedMps = 28;
    const deltas = drawnDeltasAt(60, speedMps);
    const perFrame = speedMps / 60;
    for (const delta of deltas) expect(delta).toBeCloseTo(perFrame, 9);
  });

  it("advances the car by an even amount every frame at 144 Hz", () => {
    const speedMps = 36;
    const deltas = drawnDeltasAt(144, speedMps);
    const perFrame = speedMps / 144;
    for (const delta of deltas) expect(delta).toBeCloseTo(perFrame, 9);
  });

  it("never holds the car still for a frame and then jumps it a whole tick", () => {
    // What the bug looked like: at 60 Hz the drawn position alternated between not moving at all
    // and moving the full 0.93 m a tick covers.
    const deltas = drawnDeltasAt(60, 28);
    const tickTravel = 28 * SIM_STEP_S;
    expect(Math.min(...deltas)).toBeGreaterThan(0);
    expect(Math.max(...deltas)).toBeLessThan(tickTravel * 0.75);
  });
});
