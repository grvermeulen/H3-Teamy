import { MAX_PEDS, MAX_VEHICLES } from "../sim/limits";
import { describe, expect, it } from "vitest";
import { createCollisionGrid } from "../world/collisionGrid";
import type { MapIndex, MapZone } from "../world/mapTypes";
import { decodeRoadGraph } from "../world/roadGraph";
import { createArenaState } from "../sim/arena";
import { createRng } from "../sim/rng";
import { createInput, type ArenaState } from "../sim/types";
import { createVehicle, VEHICLE_KINDS } from "../sim/vehicle";
import { decodeInput, encodeInput } from "./wire";
import {
  MAX_SNAPSHOT_BYTES,
  decodeSnapshot,
  encodeSnapshot,
  snapshotBytes,
} from "./snapshotWire";

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

/** A booted state, the base every snapshot test starts from. */
function boot(seed = 1): ArenaState {
  return createArenaState({ index, graph, seed, zone }, createRng(seed));
}

describe("input wire format", () => {
  it("round-trips a move, aim and the button flags", () => {
    const input = createInput({
      move: [1, -0.5],
      aim: Math.PI,
      fire: true,
      enter: true,
    });
    const { seq, input: back } = decodeInput(encodeInput(7, input));
    expect(seq).toBe(7);
    expect(back.move[0]).toBeCloseTo(1, 2);
    expect(back.move[1]).toBeCloseTo(-0.5, 2);
    expect(back.aim).toBeCloseTo(Math.PI, 1);
    expect(back.fire).toBe(true);
    expect(back.enter).toBe(true);
    expect(back.weaponNext).toBe(false);
  });

  it("carries no aim as -1 rather than an angle", () => {
    const frame = encodeInput(1, createInput({ aim: null }));
    expect(frame[3]).toBe(-1);
    expect(decodeInput(frame).input.aim).toBeNull();
  });

  it("round-trips every button flag independently", () => {
    for (const key of [
      "fire",
      "enter",
      "weaponNext",
      "moveIsAnalog",
    ] as const) {
      const back = decodeInput(encodeInput(1, createInput({ [key]: true })));
      expect({ key, value: back.input[key] }).toEqual({ key, value: true });
    }
  });

  it("clamps a move outside the unit range instead of overflowing the frame", () => {
    const frame = encodeInput(1, createInput({ move: [9, -9] }));
    expect(frame[1]).toBe(100);
    expect(frame[2]).toBe(-100);
  });

  it("is all integers, so the frame stays small on the wire", () => {
    const frame = encodeInput(
      3,
      createInput({ move: [0.333, -0.666], aim: 1 }),
    );
    expect(frame.every((value) => Number.isInteger(value))).toBe(true);
  });
});

describe("snapshot wire format", () => {
  it("round-trips the tick, server time and every player", () => {
    const state = boot();
    const snapshot = encodeSnapshot(state, 1234, { 0: 9 });
    const back = decodeSnapshot(snapshot);
    expect(back.tick).toBe(state.tick);
    expect(back.serverTimeMs).toBe(1234);
    expect(back.lastInputSeqs[0]).toBe(9);
    expect(back.players).toHaveLength(state.players.length);
    const first = back.players[0]!;
    expect(first.id).toBe(state.players[0]!.id);
    expect(first.x).toBeCloseTo(state.players[0]!.x, 1);
    expect(first.y).toBeCloseTo(state.players[0]!.y, 1);
    expect(first.health).toBe(state.players[0]!.health);
    expect(first.weapon).toBe(state.players[0]!.weapon);
  });

  it("round-trips a null vehicleId as -1 and back", () => {
    const state = boot();
    const back = decodeSnapshot(encodeSnapshot(state, 0, {}));
    expect(back.players[0]!.vehicleId).toBeNull();
  });

  it("round-trips a driven car by id", () => {
    const base = boot();
    const car = createVehicle(90, "sedan", [10, 0], 0, 0);
    const state: ArenaState = {
      ...base,
      vehicles: [car],
      players: [{ ...base.players[0]!, vehicleId: car.id }],
    };
    const back = decodeSnapshot(encodeSnapshot(state, 0, {}));
    expect(back.players[0]!.vehicleId).toBe(car.id);
    expect(back.vehicles[0]!.id).toBe(car.id);
    expect(back.vehicles[0]!.kind).toBe("sedan");
  });

  it("round-trips the rifle and the bat, their rounds appended past the original row", () => {
    const base = boot();
    const player = base.players[0]!;
    const state: ArenaState = {
      ...base,
      players: [
        {
          ...player,
          weapon: "rifle",
          ammo: { uzi: 1, shotgun: 2, rifle: 7, bat: 13 },
        },
      ],
      pickups: [
        { id: 900, kind: "rifle", x: 1, y: 1, takenAtTick: null },
        { id: 901, kind: "bat", x: 2, y: 2, takenAtTick: null },
      ],
    };
    const back = decodeSnapshot(encodeSnapshot(state, 0, {}));
    expect(back.players[0]!.weapon).toBe("rifle");
    expect(back.players[0]!.ammo).toEqual({
      uzi: 1,
      shotgun: 2,
      rifle: 7,
      bat: 13,
    });
    expect(back.pickups.map((pickup) => pickup.kind)).toEqual(["rifle", "bat"]);
  });

  it("round-trips the kinds added later by their appended indices", () => {
    const base = boot();
    const state: ArenaState = {
      ...base,
      vehicles: [
        createVehicle(90, "bus", [10, 0], 0, 0),
        createVehicle(91, "tractor", [30, 0], 0, 0),
      ],
    };
    const back = decodeSnapshot(encodeSnapshot(state, 0, {}));
    expect(back.vehicles.map((vehicle) => vehicle.kind)).toEqual([
      "bus",
      "tractor",
    ]);
    expect(back.vehicles[0]!.health).toBe(220);
  });

  it("round-trips cars, pedestrians, cops, bullets and pickups", () => {
    const state = boot(4);
    const back = decodeSnapshot(encodeSnapshot(state, 0, {}));
    expect(back.vehicles).toHaveLength(state.vehicles.length);
    expect(back.peds).toHaveLength(state.peds.length);
    expect(back.cops).toHaveLength(state.cops.length);
    expect(back.bullets).toHaveLength(state.bullets.length);
    expect(back.pickups).toHaveLength(state.pickups.length);
  });

  it("keeps a full 8-player world inside the size budget", () => {
    const base = boot(5);
    const players = Array.from({ length: 8 }, (_, index) => ({
      ...base.players[0]!,
      id: index,
      x: index * 5,
    }));
    const state: ArenaState = { ...base, players };
    const bytes = snapshotBytes(encodeSnapshot(state, 1, {}));
    expect(bytes).toBeLessThan(MAX_SNAPSHOT_BYTES);
  });

  it("keeps a world at every cap inside the size budget", () => {
    const base = boot(5);
    const vehicles = Array.from({ length: MAX_VEHICLES }, (_, index) =>
      createVehicle(
        1000 + index,
        VEHICLE_KINDS[index % VEHICLE_KINDS.length]!,
        [index * 3, -index * 2],
        0,
        index % 6,
      ),
    );
    const ped = base.peds[0]!;
    const peds = Array.from({ length: MAX_PEDS }, (_, index) => ({
      ...ped,
      id: 5000 + index,
      x: index * 2,
    }));
    const players = Array.from({ length: 8 }, (_, index) => ({
      ...base.players[0]!,
      id: index,
      x: index * 5,
    }));
    const state: ArenaState = { ...base, vehicles, peds, players };
    const bytes = snapshotBytes(encodeSnapshot(state, 1, {}));
    expect(bytes).toBeLessThan(MAX_SNAPSHOT_BYTES);
  });

  it("is all integers, so a snapshot never carries a float", () => {
    const snapshot = encodeSnapshot(boot(6), 7, { 0: 1 });
    const flat = JSON.stringify(snapshot);
    expect(flat).not.toMatch(/\d\.\d/);
  });
});

describe("input wire format against a hostile peer", () => {
  it("turns NaN and Infinity into safe defaults rather than letting them into the world", () => {
    const { input } = decodeInput([
      Number.NaN,
      Number.NaN,
      Infinity,
      Number.NaN,
      0,
    ]);
    expect(input.move).toEqual([0, 0]);
    expect(input.aim).toBeNull();
    expect(
      Number.isFinite(input.move[0]) && Number.isFinite(input.move[1]),
    ).toBe(true);
  });

  it("clamps out-of-range moves and angles instead of trusting them", () => {
    const { input } = decodeInput([1, 5000, -5000, 9999, 0]);
    expect(input.move).toEqual([1, -1]);
    expect(input.aim).not.toBeNull();
    expect(input.aim!).toBeGreaterThanOrEqual(0);
    expect(input.aim!).toBeLessThan(Math.PI * 2 + 0.01);
  });

  it("never lets a sequence number go negative or non-integer", () => {
    expect(decodeInput([-7, 0, 0, -1, 0]).seq).toBe(0);
    expect(decodeInput([3.9, 0, 0, -1, 0]).seq).toBe(3);
  });

  it("keeps decoding a well-formed frame exactly as before", () => {
    const original = createInput({ move: [0.5, -0.25], aim: 1, fire: true });
    const { input } = decodeInput(encodeInput(9, original));
    expect(input.move[0]).toBeCloseTo(0.5, 2);
    expect(input.move[1]).toBeCloseTo(-0.25, 2);
    expect(input.aim).toBeCloseTo(1, 1);
    expect(input.fire).toBe(true);
  });
});
