import { describe, expect, it } from "vitest";
import {
  beginBoarding,
  boardingDoor,
  cancelPlayerBoarding,
  HIJACK_TICKS,
  PARKED_ENTRY_TICKS,
  stepBoarding,
} from "./hijacking";
import { createArenaPlayer } from "./roster";
import { createVehicle } from "./vehicle";
import { createCollisionGrid } from "../world/collisionGrid";
import type { ArenaWorld } from "./arenaWorld";
import type { ArenaState } from "./types";
import { createRng } from "./rng";
import { EMPTY_INPUT } from "./types";
import { moveEntities } from "./movement";
import { applySnapshot } from "../net/snapshotApply";
import { decodeSnapshot, encodeSnapshot } from "../net/snapshotWire";
import { isSnapshot } from "../net/wireValidation";
import { heatFromEvents } from "./wanted";
import { boardingPeople } from "../render/boardingPeople";
import { drawBoardingDoor } from "../render/drawVehicles";
import { createFakeContext } from "../render/testing/fakeContext";

const world: ArenaWorld = {
  collision: createCollisionGrid(16),
  index: {
    version: 1,
    generatedAt: "2026-09-18",
    origin: { lat: 52, lon: 5 },
    unitsPerMetre: 4,
    bounds: { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 },
    tileSize: 8000,
    tiles: [],
    zones: [],
    landmarks: [],
  },
  graph: {
    nodes: [
      [0, 0],
      [100, 0],
    ],
    edges: [
      {
        a: 0,
        b: 1,
        roadClass: "residential",
        name: null,
        oneway: 0,
        length: 100,
      },
    ],
    adjacency: [[0], [0]],
  },
};

function initial(driver = true): ArenaState {
  const car = createVehicle(10, "sedan", [0, 0], 0, 0);
  return {
    tick: 0,
    seed: 1,
    nextId: 100,
    players: [createArenaPlayer(boardingDoor(car, -1), 0)],
    vehicles: [car],
    bullets: [],
    effects: [],
    peds: [],
    cops: [],
    pickups: [],
    traffic: driver
      ? [
          {
            vehicleId: car.id,
            role: "traffic",
            cruiseMps: 5,
            fromNode: 0,
            path: [1],
            repathTick: 100,
          },
        ]
      : [],
    events: [],
    zoneKey: null,
    activeZoneKey: null,
    enforcedZoneKey: null,
    zoneEnforced: false,
  };
}

function start(state = initial()): ArenaState {
  return beginBoarding(state, state.players[0], state.vehicles[0], world);
}
function advance(state: ArenaState, tick: number): ArenaState {
  return stepBoarding({ ...state, tick, events: [] }, world);
}

describe("door and driver transaction", () => {
  it("ejects one driver, commits once, and releases input after closing", () => {
    let state = start();
    expect(state.players[0].vehicleId).toBeNull();
    state = advance(state, 12);
    expect(state.traffic).toHaveLength(1);
    expect(state.peds).toHaveLength(0);
    state = advance(state, 13);
    expect(state.peds).toHaveLength(1);
    expect(state.traffic).toHaveLength(0);
    state = advance(state, 22);
    expect(state.peds).toHaveLength(1);
    expect(state.players[0].vehicleId).toBeNull();
    state = advance(state, 23);
    expect(state.players[0].vehicleId).toBe(10);
    expect(heatFromEvents(state.events, state.players[0], [], [])).toBe(40);
    expect(
      advance(state, 24).events.filter((event) => event.kind === "hijack"),
    ).toHaveLength(0);
    state = advance(state, HIJACK_TICKS);
    expect(state.vehicles[0].boarding).toBeUndefined();
    expect(state.players[0].boardingTicksLeft).toBe(0);
  });

  it("restores the original driver before ejection but never duplicates them after it", () => {
    const before = start();
    const cancelled = cancelPlayerBoarding(before, 0);
    expect(cancelled.traffic).toHaveLength(1);
    expect(cancelled.peds).toHaveLength(0);
    const after = cancelPlayerBoarding(advance(before, 13), 0);
    expect(after.traffic).toHaveLength(0);
    expect(after.peds).toHaveLength(1);
    expect(after.vehicles[0].boarding).toBeUndefined();
  });

  it("resumes through snapshots without ejecting or rewarding theft twice", () => {
    const ejected = advance(start(), 13);
    const packet = encodeSnapshot(ejected, 1000, {});
    expect(isSnapshot(packet)).toBe(true);
    const resumed = applySnapshot(initial(), decodeSnapshot(packet));
    const committed = advance(resumed, 23);
    expect(committed.peds).toHaveLength(1);
    expect(committed.players[0].vehicleId).toBe(10);
    expect(advance(committed, 24).events).toEqual([]);
  });

  it("refuses fast traffic, an obstructed door and a second reservation", () => {
    const fast = initial();
    fast.vehicles[0].velocityX = 9;
    expect(start(fast)).toBe(fast);
    const base = initial();
    const blocked = {
      ...world,
      collision: {
        ...world.collision,
        resolveCircle: () => [99, 99] as [number, number],
      },
    };
    expect(
      beginBoarding(base, base.players[0], base.vehicles[0], blocked),
    ).toBe(base);
    const reserved = start();
    expect(
      beginBoarding(
        reserved,
        { ...reserved.players[0], id: 2 },
        reserved.vehicles[0],
        world,
      ),
    ).toBe(reserved);
  });

  it("brakes a moving car over successive ticks instead of snapping its velocity", () => {
    const base = initial();
    base.vehicles[0].velocityX = 7;
    let state = start(base);
    state = moveEntities(
      state,
      new Map([[0, EMPTY_INPUT]]),
      1 / 30,
      world,
      1,
      createRng(1),
    );
    expect(state.vehicles[0].velocityX).toBeGreaterThan(0);
    expect(state.vehicles[0].velocityX).toBeLessThan(7);
  });

  it("cancels on death, wreck, disconnect or an obstructed landing", () => {
    for (const cause of ["death", "wreck", "disconnect"] as const) {
      const state = start();
      if (cause === "death") state.players[0].diedAtTick = 1;
      if (cause === "wreck") state.vehicles[0].wrecked = true;
      if (cause === "disconnect") state.players = [];
      expect(advance(state, 1).vehicles[0].boarding).toBeUndefined();
    }
    const state = start();
    const blockedLanding = {
      ...world,
      collision: {
        ...world.collision,
        resolveCircle: (point: [number, number]) =>
          point[1] < -2 ? ([point[0], 0] as [number, number]) : point,
      },
    };
    const cancelled = stepBoarding({ ...state, tick: 13 }, blockedLanding);
    expect(cancelled.peds).toHaveLength(0);
    expect(cancelled.vehicles[0].boarding).toBeUndefined();
  });

  it("opens a parked car without inventing an occupant and preserves readable reduced-motion poses", () => {
    const parked = advance(start(initial(false)), PARKED_ENTRY_TICKS);
    expect(parked.players[0].vehicleId).toBe(10);
    expect(parked.peds).toHaveLength(0);
    expect(parked.events.some((event) => event.kind === "hijack")).toBe(false);
    const thrown = advance(start(), 17);
    const moving = boardingPeople(thrown.peds, thrown.vehicles, 17);
    expect(moving[0].y).not.toBe(thrown.peds[0].y);
    expect(boardingPeople(thrown.peds, thrown.vehicles, 17, true)[0]).toEqual(
      thrown.peds[0],
    );
    const context = createFakeContext();
    drawBoardingDoor(context, thrown.vehicles[0], 8, 17);
    expect(context.calls.some((entry) => entry.startsWith("rotate("))).toBe(
      true,
    );
  });
});
