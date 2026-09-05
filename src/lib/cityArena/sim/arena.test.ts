import { describe, expect, it } from "vitest";
import { createCollisionGrid } from "../world/collisionGrid";
import type { MapIndex, MapZone } from "../world/mapTypes";
import { decodeRoadGraph } from "../world/roadGraph";
import {
  BOARDING_TICKS,
  createArenaState,
  stepArena,
  teleportArenaPlayer,
  type ArenaWorld,
} from "./arena";
import { createRng } from "./rng";
import { createInput, type ArenaState, type WorldInput } from "./types";
import { createVehicle } from "./vehicle";

/** One zone with spawn nodes at 0, 100, 200 and 300 m along y = 0. */
const zone: MapZone = {
  key: "campus",
  name: "WUR-campus",
  center: [600, 0],
  radius: 2000,
  spawnNodes: [
    [0, 0],
    [400, 0],
    [800, 0],
    [1200, 0],
  ],
  landmarks: [],
};
const index: MapIndex = {
  version: 1,
  generatedAt: "2026-09-04T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: -26055, minY: -17692, maxX: 26055, maxY: 17692 },
  tileSize: 8000,
  tiles: [],
  zones: [zone],
  landmarks: [],
};
const graph = decodeRoadGraph({
  nodes: [0, 0, 1200, 0],
  edges: [0, 1, 0, -1, 0, 1200],
  classes: ["residential"],
  names: [],
});
const world: ArenaWorld = { collision: createCollisionGrid(), index };
const step = 1 / 30;
const SPAWN_XS = [0, 100, 200, 300];

function boot(seed = 1): ArenaState {
  return createArenaState({ index, graph, seed, zone }, createRng(seed));
}

function run(state: ArenaState, input: WorldInput, ticks: number): ArenaState {
  let current = state;
  for (let index = 0; index < ticks; index++)
    current = stepArena(current, input, step, world);
  return current;
}

/** Replaces the parked cars by one compact `offsetX` metres east of the player. */
function withCar(
  state: ArenaState,
  offsetX: number,
  wrecked = false,
): ArenaState {
  const car = createVehicle(
    500,
    "compact",
    [state.player.x + offsetX, state.player.y],
    0,
    0,
  );
  return { ...state, vehicles: [{ ...car, wrecked }] };
}

describe("createArenaState", () => {
  it("spawns the player on a spawn node with the loadout and parks cars away from them", () => {
    const state = boot();
    expect(state.tick).toBe(0);
    expect(state.seed).toBe(1);
    expect(state.zoneKey).toBe("campus");
    expect(state.player).toMatchObject({
      id: 0,
      health: 100,
      weapon: "pistol",
      ammo: { uzi: 60, shotgun: 8 },
      vehicleId: null,
      diedAtTick: null,
    });
    expect(SPAWN_XS).toContain(state.player.x);
    expect(state.vehicles.length).toBeGreaterThanOrEqual(1);
    expect(state.vehicles.length).toBeLessThanOrEqual(3);
    for (const car of state.vehicles)
      expect(Math.abs(car.x - state.player.x)).toBeGreaterThanOrEqual(8);
    expect(state.nextId).toBe(1 + state.vehicles.length);
    expect(boot(4)).toEqual(boot(4));
  });
});

describe("stepArena on foot", () => {
  it("advances the tick and walks with the aim as facing", () => {
    const start = boot();
    const walked = run(start, createInput({ move: [1, 0], aim: Math.PI }), 30);
    expect(walked.tick).toBe(30);
    expect(walked.player.x).toBeCloseTo(start.player.x + 4);
    expect(walked.player.facing).toBeCloseTo(Math.PI);
    expect(walked.held).toEqual({ enter: false, weaponNext: false });
  });

  it("cycles the weapon on a rising edge only", () => {
    const pressed = run(boot(), createInput({ weaponNext: true }), 5);
    expect(pressed.player.weapon).toBe("uzi");
    const released = run(pressed, createInput({}), 1);
    expect(
      run(released, createInput({ weaponNext: true }), 1).player.weapon,
    ).toBe("shotgun");
  });
});

describe("stepArena driving", () => {
  it("enters a car within 1.5 m on a rising edge, boards for 18 ticks, then drives with the car", () => {
    const near = withCar(boot(), 3);
    const boarded = run(near, createInput({ enter: true }), 1);
    expect(boarded.player.vehicleId).toBe(500);
    expect(boarded.player.boardingTicksLeft).toBe(BOARDING_TICKS - 1);
    const stillBoarding = run(
      boarded,
      createInput({ enter: true, move: [0, -1] }),
      17,
    );
    expect(stillBoarding.player.vehicleId).toBe(500);
    expect(stillBoarding.player.boardingTicksLeft).toBe(0);
    expect(stillBoarding.vehicles[0].x).toBeCloseTo(near.vehicles[0].x);
    const driving = run(stillBoarding, createInput({ move: [0, -1] }), 30);
    expect(driving.vehicles[0].velocityX).toBeCloseTo(6);
    expect(driving.vehicles[0].x).toBeCloseTo(near.vehicles[0].x + 3.1);
    expect(driving.player.x).toBeCloseTo(driving.vehicles[0].x);
    expect(driving.player.speed).toBeCloseTo(6);
  });

  it("steps out beside a stopped car on the next rising edge", () => {
    const boarded = run(withCar(boot(), 3), createInput({ enter: true }), 1);
    const driven = run(boarded, createInput({ move: [0, -1] }), 60);
    const braked = run(driven, createInput({ move: [0, 1] }), 15);
    const stopped = run(braked, createInput({}), 30);
    expect(stopped.vehicles[0].velocityX).toBeCloseTo(0);
    const out = run(stopped, createInput({ enter: true }), 1);
    expect(out.player.vehicleId).toBeNull();
    expect(out.player.x).toBeCloseTo(stopped.vehicles[0].x);
    expect(out.player.y).toBeCloseTo(stopped.vehicles[0].y - 2.5);
    expect(out.player.speed).toBe(0);
  });

  it("refuses cars out of reach and wrecks", () => {
    expect(
      run(withCar(boot(), 5), createInput({ enter: true }), 1).player.vehicleId,
    ).toBeNull();
    expect(
      run(withCar(boot(), 3, true), createInput({ enter: true }), 1).player
        .vehicleId,
    ).toBeNull();
  });

  it("teleports out of the car to the target and is deterministic for a seed", () => {
    const boarded = run(withCar(boot(), 3), createInput({ enter: true }), 1);
    const moved = teleportArenaPlayer(boarded, [150, 0], index);
    expect(moved.player).toMatchObject({
      x: 150,
      y: 0,
      vehicleId: null,
      speed: 0,
    });
    expect(moved.zoneKey).toBe("campus");
    const input = createInput({ move: [0.5, -0.5], enter: true });
    expect(run(boot(3), input, 60)).toEqual(run(boot(3), input, 60));
  });
});
