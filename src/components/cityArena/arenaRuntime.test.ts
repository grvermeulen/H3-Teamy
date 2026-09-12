import { describe, expect, it } from "vitest";
import { createCamera } from "@/lib/cityArena/render/camera";
import type { HostLoop } from "@/lib/cityArena/net/hostLoop";
import { SIM_STEP_S } from "@/lib/cityArena/sim/player";
import type { ArenaState } from "@/lib/cityArena/sim/types";
import {
  canApplyRuntimeUpdate,
  nextCamera,
  recordStepped,
  renderAlpha,
} from "./arenaRuntime";

describe("arena runtime async guards", () => {
  it("rejects callbacks after runtime disposal", () => {
    expect(canApplyRuntimeUpdate({ disposed: false })).toBe(true);
    expect(canApplyRuntimeUpdate({ disposed: true })).toBe(false);
  });
});

describe("nextCamera", () => {
  it("holds the viewport zoom on foot and widens one step at driving speed", () => {
    const start = createCamera([0, 0], 8);
    const walking = nextCamera(start, 8, [10, 0], [5.5, 0], 1 / 30, false);
    expect(walking.zoom).toBe(8);
    expect(walking.x).toBeGreaterThan(0);
    expect(nextCamera(start, 8, [10, 0], [20, 0], 1 / 30, true).zoom).toBe(6);
  });

  it("leads further ahead while driving", () => {
    let onFoot = createCamera([0, 0], 8);
    let inCar = createCamera([0, 0], 8);
    for (let frame = 0; frame < 300; frame++) {
      onFoot = nextCamera(onFoot, 8, [0, 0], [1000, 0], 1 / 60, false);
      inCar = nextCamera(inCar, 8, [0, 0], [1000, 0], 1 / 60, true);
    }
    expect(onFoot.x).toBeCloseTo(15, 1);
    expect(inCar.x).toBeCloseTo(30, 1);
  });
});

/** A state carrying nothing but its tick, which is all the pairing rule looks at. */
function atTick(tick: number): ArenaState {
  return { tick } as ArenaState;
}

describe("recordStepped", () => {
  it("keeps the pair a frame that stepped nothing", () => {
    // The common case: 60 Hz frames outnumber 30 Hz ticks two to one, and it is precisely the
    // untouched pair that lets the blend carry the world forward between ticks.
    const runtime = { state: atTick(7), previousState: atTick(6) };
    recordStepped(runtime, runtime.state);
    expect(runtime.state.tick).toBe(7);
    expect(runtime.previousState?.tick).toBe(6);
  });

  it("remembers the state a single tick replaced", () => {
    const before = atTick(7);
    const runtime = { state: before, previousState: atTick(6) };
    recordStepped(runtime, atTick(8));
    expect(runtime.state.tick).toBe(8);
    expect(runtime.previousState).toBe(before);
  });

  it("drops the pair when a catch-up burst ran several ticks at once", () => {
    // Blending across a burst would replay it in slow motion over one frame; better to land on
    // the new state and blend again from the next tick.
    const runtime = { state: atTick(7), previousState: atTick(6) };
    recordStepped(runtime, atTick(12));
    expect(runtime.state.tick).toBe(12);
    expect(runtime.previousState).toBeNull();
  });

  it("drops the pair when the host's state went backwards", () => {
    const runtime = { state: atTick(40), previousState: atTick(39) };
    recordStepped(runtime, atTick(12));
    expect(runtime.previousState).toBeNull();
  });
});

describe("renderAlpha", () => {
  it("reads the runtime's own accumulator while offline", () => {
    const netplay = { kind: "offline", playerId: 0 } as const;
    expect(renderAlpha({ netplay, accumulator: 0 })).toBe(0);
    expect(renderAlpha({ netplay, accumulator: SIM_STEP_S / 2 })).toBeCloseTo(
      0.5,
      10,
    );
    // A frame that hit the stepper's iteration cap leaves more than a tick behind; the blend must
    // still stop at the tick it has rather than extrapolating past it.
    expect(renderAlpha({ netplay, accumulator: SIM_STEP_S * 3 })).toBe(1);
  });

  it("asks the loop in a room, whose clock owns the ticks", () => {
    const loop = { stepFraction: () => 0.4 } as unknown as HostLoop;
    expect(
      renderAlpha({
        netplay: { kind: "host", loop, playerId: 2 },
        accumulator: 999,
      }),
    ).toBe(0.4);
  });
});
