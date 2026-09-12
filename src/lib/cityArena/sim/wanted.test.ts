import { localPlayer } from "./players";
import { describe, expect, it } from "vitest";
import type { MapIndex } from "../world/mapTypes";
import { decodeRoadGraph } from "../world/roadGraph";
import { createArenaState } from "./arena";
import { createRng } from "./rng";
import type { ArenaEvent, ArenaState, CopState, DriverState } from "./types";
import {
  HEAT_QUIET_TICKS,
  addHeat,
  applyWanted,
  currentWantedLevel,
  decayHeat,
  heatFromEvents,
  wantedLevel,
  wantedTarget,
} from "./wanted";

const emptyIndex: MapIndex = {
  version: 1,
  generatedAt: "2026-09-05T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  bounds: { minX: -26055, minY: -17692, maxX: 26055, maxY: 17692 },
  tileSize: 8000,
  tiles: [],
  zones: [],
  landmarks: [],
};
const graph = decodeRoadGraph({ nodes: [], edges: [], classes: [], names: [] });

function lonePlayer(): ArenaState {
  return createArenaState(
    { index: emptyIndex, graph, seed: 1, zone: null },
    createRng(1),
  );
}

function copAt(
  id: number,
  x: number,
  diedAtTick: number | null = null,
): CopState {
  return {
    id,
    x,
    y: 0,
    facing: 0,
    health: diedAtTick === null ? 100 : 0,
    weapon: "pistol",
    path: [],
    repathTick: 0,
    nextShotTick: 0,
    diedAtTick,
  };
}

function policeDriver(vehicleId: number): DriverState {
  return {
    vehicleId,
    role: "police",
    cruiseMps: 18,
    fromNode: null,
    path: [],
    repathTick: 0,
  };
}

describe("heat bookkeeping", () => {
  it("turns heat into at most three stars and decays after quiet time", () => {
    expect(wantedLevel(39)).toBe(0);
    expect(wantedLevel(40)).toBe(1);
    expect(wantedLevel(120)).toBe(3);
    const player = localPlayer(lonePlayer());
    const heated = addHeat(player, 30, 10);
    expect(heated).toMatchObject({ heat: 30, heatTick: 10 });
    expect(decayHeat(heated, 10 + HEAT_QUIET_TICKS - 1)).toBe(heated);
    expect(decayHeat(heated, 10 + HEAT_QUIET_TICKS).heat).toBeCloseTo(
      30 - 1 / 6,
      4,
    );
  });

  it("chases the most wanted player, breaking equal heat on the lower id", () => {
    const base = localPlayer(lonePlayer());
    const hotter = { ...base, id: 5, heat: 90 };
    const cooler = { ...base, id: 2, heat: 45 };
    const tied = { ...base, id: 9, heat: 45 };
    const state = { ...lonePlayer(), players: [cooler, hotter] };
    expect(wantedTarget(state)?.id).toBe(5);
    // Same heat: the lower id wins, whichever order they sit in the array.
    expect(wantedTarget({ ...state, players: [tied, cooler] })?.id).toBe(2);
    expect(wantedTarget({ ...state, players: [cooler, tied] })?.id).toBe(2);
    // A dead player is not chased even while their heat is still high.
    const dead = { ...hotter, health: 0, diedAtTick: 3 };
    expect(wantedTarget({ ...state, players: [cooler, dead] })?.id).toBe(2);
  });

  it("counts only this player's kills, nearby shots and police rams", () => {
    const player = localPlayer(lonePlayer());
    const driver = { ...player, vehicleId: 4 };
    const events: ArenaEvent[] = [
      { kind: "kill", victim: "ped", killerId: 0, x: 1, y: 1 },
      { kind: "kill", victim: "cop", killerId: 0, x: 2, y: 2 },
      { kind: "kill", victim: "ped", killerId: 7, x: 3, y: 3 },
      { kind: "shot", weapon: "pistol", ownerId: 0, x: 0, y: 0 },
      { kind: "impact", vehicleId: 4, otherVehicleId: 9, impactSpeed: 6 },
    ];
    expect(
      heatFromEvents(events, driver, [copAt(50, 10)], [policeDriver(9)]),
    ).toBe(120);
  });

  it("selects a living wanted target and emits level changes", () => {
    const state = lonePlayer();
    expect(wantedTarget(state)).toBeNull();
    const first = applyWanted(
      {
        ...state,
        events: [{ kind: "kill", victim: "ped", killerId: 0, x: 1, y: 1 }],
      },
      5,
    );
    expect(localPlayer(first).heat).toBe(30);
    const second = applyWanted(
      {
        ...first,
        events: [{ kind: "kill", victim: "ped", killerId: 0, x: 1, y: 1 }],
      },
      6,
    );
    expect(localPlayer(second).heat).toBe(60);
    expect(second.events).toContainEqual({
      kind: "wanted",
      playerId: 0,
      level: 1,
    });
    expect(currentWantedLevel(second)).toBe(1);
    const dead: ArenaState = {
      ...second,
      players: [{ ...localPlayer(second), health: 0, diedAtTick: 6 }],
    };
    expect(localPlayer(applyWanted(dead, 6)).heat).toBe(0);
  });
});
