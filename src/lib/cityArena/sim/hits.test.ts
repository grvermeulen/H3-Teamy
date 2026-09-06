import { describe, expect, it } from "vitest";
import type { MapIndex } from "../world/mapTypes";
import { decodeRoadGraph } from "../world/roadGraph";
import { createArenaState } from "./arena";
import type { BulletHit } from "./bullets";
import { applyEntityHit } from "./hits";
import { createRng } from "./rng";
import type { ArenaState, BulletState, PedState } from "./types";

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
const ped: PedState = {
  id: 300,
  x: 5,
  y: 0,
  facing: 0,
  health: 40,
  mode: "walk",
  modeUntilTick: 0,
  rail: null,
  fleeX: 0,
  fleeY: 0,
};

function bulletFrom(ownerId: number, damage: number): BulletState {
  return {
    id: 1,
    ownerId,
    ignoreVehicleId: null,
    x: 4,
    y: 0,
    directionX: 1,
    directionY: 0,
    speedMps: 120,
    rangeLeftM: 30,
    damage,
    weapon: "pistol",
  };
}

function hitOn(targetId: number, bullet: BulletState): BulletHit {
  return {
    bullet,
    point: [4.6, 0],
    target: { kind: "player", playerId: targetId },
  };
}

function withPed(): ArenaState {
  const state = createArenaState(
    { index: emptyIndex, graph, seed: 1, zone: null },
    createRng(1),
  );
  return { ...state, peds: [ped] };
}

describe("applyEntityHit", () => {
  it("damages a pedestrian and records a kill when its health reaches zero", () => {
    const hurt = applyEntityHit(withPed(), hitOn(300, bulletFrom(0, 20)), 4);
    expect(hurt?.peds[0]).toMatchObject({ health: 20, mode: "walk" });
    expect(hurt?.events).toEqual([
      { kind: "hit", target: "ped", x: 4.6, y: 0 },
    ]);
    const killed = applyEntityHit(withPed(), hitOn(300, bulletFrom(0, 40)), 4);
    expect(killed?.peds[0]).toMatchObject({ health: 0, mode: "dead" });
    expect(killed?.events).toEqual([
      { kind: "hit", target: "ped", x: 4.6, y: 0 },
      { kind: "kill", victim: "ped", killerId: 0, x: 5, y: 0 },
    ]);
  });

  it("absorbs non-player bullets and ignores non-pedestrian targets", () => {
    const absorbed = applyEntityHit(
      withPed(),
      hitOn(300, bulletFrom(77, 40)),
      4,
    );
    expect(absorbed?.peds[0].health).toBe(40);
    expect(absorbed?.events).toEqual([
      { kind: "hit", target: "ped", x: 4.6, y: 0 },
    ]);
    expect(
      applyEntityHit(withPed(), hitOn(0, bulletFrom(77, 40)), 4),
    ).toBeNull();
    expect(
      applyEntityHit(
        withPed(),
        {
          bullet: bulletFrom(0, 20),
          point: [4.6, 0],
          target: { kind: "building" },
        },
        4,
      ),
    ).toBeNull();
  });
});
