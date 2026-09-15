import { describe, expect, it } from "vitest";
import { createArenaState, createArenaPlayer, stepArena } from "./arena";
import type { ArenaWorld } from "./arenaWorld";
import { createInput, type ArenaState } from "./types";
import { applyFire } from "./combat";
import { createRng } from "./rng";
import { activeBonus, landmarkSpeedFactor } from "./landmarkBonuses";
import { visitLandmark, stepLandmarkBonuses } from "./landmarkVisits";
import { damagePlayer } from "./damage";
import { predictLocal } from "../net/predictLocal";
import { encodeSnapshot, decodeSnapshot } from "../net/snapshotWire";
import { isSnapshot } from "../net/wireValidation";
import { nearbyLandmarkActivity } from "../world/landmarkActivities";
import { createVehicle } from "./vehicle";
import type { MapIndex } from "../world/mapTypes";

const index: MapIndex = {
  version: 1,
  generatedAt: "2026-09-15T12:00:00",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 },
  tileSize: 8000,
  tiles: [],
  zones: [],
  landmarks: [
    {
      key: "gastland",
      name: "Zwembad 't Gastland",
      style: "pool",
      center: [0, 0],
      tile: { x: 0, y: 0 },
    },
  ],
};
const world: ArenaWorld = {
  index,
  graph: { nodes: [], edges: [], adjacency: [], nearestNode: () => null },
  collision: { resolveCircle: (point) => point, query: () => [] },
};
const random = createRng(2);
const fresh = () =>
  createArenaState({ index, graph: world.graph, seed: 2, zone: null }, random);

describe("landmark visits", () => {
  it("activates once per press and cannot stack or refresh during cooldown", () => {
    const first = stepArena(
      fresh(),
      new Map([[0, createInput({ enter: true })]]),
      1 / 30,
      world,
      random,
    );
    expect(first.players[0].bonus).toEqual({
      kind: "speed",
      untilTick: 1201,
      readyAtTick: 1651,
    });
    const held = stepArena(
      first,
      new Map([[0, createInput({ enter: true })]]),
      1 / 30,
      world,
      random,
    );
    expect(held.players[0].bonus).toEqual(first.players[0].bonus);
    expect(visitLandmark(held, held.players[0], world)).toBe(held);
    const ready = { ...held, tick: 1651 };
    expect(
      visitLandmark(ready, ready.players[0], world).players[0].bonus?.untilTick,
    ).toBe(2851);
  });
  it("offers large landmarks at the outside wall, not only the inaccessible centre", () => {
    const collision: ArenaWorld["collision"] = {
      ...world.collision,
      query: () => [
        {
          kind: "building",
          bounds: { minX: -40, minY: -25, maxX: 40, maxY: 25 },
          ring: [
            [-40, -25],
            [40, -25],
            [40, 25],
            [-40, 25],
          ],
        },
      ],
    };
    expect(
      nearbyLandmarkActivity(
        index,
        { ...createArenaPlayer([42, 0], 0) },
        collision,
      )?.key,
    ).toBe("gastland");
    expect(
      nearbyLandmarkActivity(index, createArenaPlayer([45, 0], 0), collision),
    ).toBeNull();
  });
  it("refuses dead and seated players and gives a nearby car precedence", () => {
    const base = fresh();
    const player = base.players[0];
    expect(visitLandmark(base, { ...player, diedAtTick: 0 }, world)).toBe(base);
    expect(visitLandmark(base, { ...player, vehicleId: 42 }, world)).toBe(base);
    const withCar = {
      ...base,
      vehicles: [createVehicle(42, "sedan", [1, 0], 0, 0)],
    };
    const next = stepArena(
      withCar,
      new Map([[0, createInput({ enter: true })]]),
      1 / 30,
      world,
      random,
    );
    expect(next.players[0].vehicleId).toBe(42);
    expect(next.players[0].bonus).toBeUndefined();
  });
  it("uses identical bonus movement for the host and prediction and expires exactly on time", () => {
    const base = fresh();
    const player = {
      ...base.players[0],
      bonus: { kind: "speed" as const, untilTick: 100, readyAtTick: 550 },
    };
    const state = { ...base, tick: 10, players: [player] };
    const inputs = new Map([[0, createInput({ move: [1, 0] })]]);
    const host = stepArena(state, inputs, 1 / 30, world, random);
    const client = predictLocal(state, inputs, 1 / 30, world, random);
    expect(client.players[0].x).toBeCloseTo(host.players[0].x);
    expect(landmarkSpeedFactor(player, 99)).toBe(1.25);
    expect(landmarkSpeedFactor(player, 100)).toBe(1);
    expect(activeBonus({ ...player, diedAtTick: 99 }, 99)).toBeNull();
  });
  it("reduces damage only while protection is active", () => {
    const player = {
      ...fresh().players[0],
      bonus: { kind: "guard" as const, untilTick: 100, readyAtTick: 550 },
    };
    expect(damagePlayer(player, 40, 99).health).toBe(70);
    expect(damagePlayer(player, 40, 100).health).toBe(60);
  });
  it("recovers at two HP per second, caps health, and never revives a dead player", () => {
    const base = fresh();
    const player = {
      ...base.players[0],
      health: 50,
      bonus: { kind: "recovery" as const, untilTick: 100, readyAtTick: 550 },
    };
    let state: ArenaState = { ...base, players: [player] };
    for (let tick = 1; tick <= 30; tick++)
      state = stepLandmarkBonuses({ ...state, tick });
    expect(state.players[0].health).toBeCloseTo(52);
    expect(
      stepLandmarkBonuses({ ...state, players: [{ ...player, health: 99.99 }] })
        .players[0].health,
    ).toBe(100);
    const dead = stepLandmarkBonuses({
      ...state,
      players: [{ ...player, health: 0, diedAtTick: 1 }],
    });
    expect(dead.players[0].health).toBe(0);
    expect(dead.players[0].bonus).toBeUndefined();
  });
  it("keeps bonuses per player across snapshots and rejects invalid bonus rows", () => {
    const base = fresh();
    const bonus = { kind: "focus" as const, untilTick: 900, readyAtTick: 1350 };
    const state = {
      ...base,
      players: [
        { ...base.players[0], bonus },
        { ...base.players[0], id: 3 },
      ],
    };
    const snapshot = encodeSnapshot(state, 1000, {});
    expect(isSnapshot(snapshot)).toBe(true);
    expect(decodeSnapshot(snapshot).players.map((p) => p.bonus)).toEqual([
      bonus,
      undefined,
    ]);
    const legacy = {
      ...snapshot,
      p: snapshot.p.map((row) => row.slice(0, 19)),
    };
    expect(isSnapshot(legacy)).toBe(true);
    expect(decodeSnapshot(legacy).players[0].bonus).toBeUndefined();
    snapshot.p[0][19] = 100;
    expect(isSnapshot(snapshot)).toBe(false);
  });
  it("shortens the firing pause with focus and boosts only melee damage with power", () => {
    const base = fresh();
    const player = base.players[0];
    const input = createInput({ fire: true, aim: 0 });
    const fire = (
      kind?: "focus" | "power",
      weapon = player.weapon,
      tick = 10,
    ) => {
      const shooter = {
        ...player,
        weapon,
        bonus: kind ? { kind, untilTick: 100, readyAtTick: 550 } : undefined,
      };
      return applyFire(
        { ...base, players: [shooter] },
        shooter,
        input,
        tick,
        random,
      );
    };
    const normal = fire();
    expect(fire("focus").players[0].nextShotTick - 10).toBe(
      Math.ceil((normal.players[0].nextShotTick - 10) * 0.8),
    );
    expect(fire("power").bullets[0].damage).toBe(normal.bullets[0].damage);
    expect(fire("power", "fist").bullets[0].damage).toBe(
      fire(undefined, "fist").bullets[0].damage * 1.25,
    );
    expect(fire("power", "fist", 100).bullets[0].damage).toBe(
      fire(undefined, "fist", 100).bullets[0].damage,
    );
  });
});
