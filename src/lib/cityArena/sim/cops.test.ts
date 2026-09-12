import { localPlayer } from "./players";
import { describe, expect, it } from "vitest";
import type { MapIndex } from "../world/mapTypes";
import type { Point } from "../world/projection";
import { decodeRoadGraph } from "../world/roadGraph";
import { createArenaState } from "./arena";
import {
  COP_BODY_TICKS,
  COP_COOLDOWN_TICKS,
  aliveCops,
  blastCops,
  copAim,
  copWeaponForLevel,
  createCop,
  damageCop,
  manageCops,
  nodesWithin,
  spawnPointsAround,
  stepCop,
  stepCops,
  type CopWorld,
} from "./cops";
import { createRng } from "./rng";
import type { ArenaState, CopState } from "./types";
import { createVehicle } from "./vehicle";

const graph = decodeRoadGraph({
  nodes: [0, 0, 200, 0, 400, 0, 600, 0, 800, 0, 0, -320],
  edges: [
    0, 1, 0, -1, 0, 200, 1, 2, 0, -1, 0, 200, 2, 3, 0, -1, 0, 200, 3, 4, 0, -1,
    0, 200, 0, 5, 0, -1, 0, 320,
  ],
  classes: ["residential"],
  names: [],
});
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
const world: CopWorld = {
  graph,
  collision: { resolveCircle: (centre: Point): Point => centre },
};
const step = 1 / 30;

function stateWithHeat(heat: number): ArenaState {
  const state = createArenaState(
    { index: emptyIndex, graph, seed: 3, zone: null },
    createRng(3),
  );
  return { ...state, players: [{ ...localPlayer(state), heat, heatTick: 0 }] };
}

function copAt(id: number, x: number, y = 0): CopState {
  return createCop(id, [x, y], "pistol", 0);
}

describe("cop basics", () => {
  it("tracks health, bodies, weapons and out-of-view spawn points", () => {
    expect(copWeaponForLevel(2)).toBe("pistol");
    expect(copWeaponForLevel(3)).toBe("shotgun");
    const cop = copAt(5, 100);
    expect(damageCop(cop, 20, 4)).toMatchObject({ health: 80 });
    const dead = damageCop(cop, 100, 4);
    expect(dead).toMatchObject({ health: 0, diedAtTick: 4, path: [] });
    expect(aliveCops([cop, dead])).toEqual([cop]);
    expect(nodesWithin(graph, [0, 0], 60, 120)).toEqual([2, 5]);
    expect(spawnPointsAround(graph, [0, 0], null, createRng(1))).toHaveLength(
      2,
    );
    expect(
      spawnPointsAround(
        graph,
        [0, 0],
        { minX: -50, minY: -100, maxX: 50, maxY: 50 },
        createRng(1),
      ),
    ).toEqual([[100, 0]]);
  });

  it("aims within fifteen degrees and follows the road toward a distant target", () => {
    const cop = copAt(5, 0);
    expect(copAim(cop, [10, 0], () => 0.5)).toBeCloseTo(0);
    expect(copAim(cop, [10, 0], () => 1)).toBeCloseTo((15 * Math.PI) / 180);
    const moved = stepCop(copAt(5, 100), [0, 0], world, step, 1);
    expect(moved.x).toBeCloseTo(99.8);
    expect(moved.path).toEqual([1, 0]);
  });
});

describe("stepCops and management", () => {
  it("fires at a wanted player and respects its cooldown", () => {
    const wanted: ArenaState = {
      ...stateWithHeat(40),
      cops: [copAt(5, 15)],
    };
    const fired = stepCops(wanted, world, step, 1, () => 0.5);
    expect(fired.cops[0]).toMatchObject({
      nextShotTick: 1 + COP_COOLDOWN_TICKS,
    });
    expect(fired.bullets).toHaveLength(1);
    expect(fired.bullets[0]).toMatchObject({ ownerId: 5, damage: 20 });
    expect(fired.events).toContainEqual({
      kind: "shot",
      weapon: "pistol",
      ownerId: 5,
      x: fired.cops[0].x,
      y: 0,
    });
    expect(
      stepCops({ ...fired, events: [] }, world, step, 2, () => 0.5).bullets,
    ).toHaveLength(1);
  });

  it("runs over and blasts cops, then spawns the wanted level's missing cops", () => {
    const base = stateWithHeat(0);
    const car = { ...createVehicle(40, "sedan", [0, 0], 0, 0), velocityX: 21 };
    const hit = stepCops(
      { ...base, vehicles: [car], cops: [copAt(5, 1.5)] },
      world,
      step,
      5,
      () => 0.5,
    );
    expect(hit.cops[0]).toMatchObject({ health: 0, diedAtTick: 5 });
    const blast = blastCops(
      [copAt(6, 1), { ...copAt(7, 2), health: 50 }, copAt(8, 5)],
      { x: 0, y: 0 },
      3,
    );
    expect(blast.cops[0].health).toBe(20);
    expect(blast.cops[1].diedAtTick).toBe(3);
    expect(blast.cops[2].health).toBe(100);
    const managed = manageCops(stateWithHeat(40), world, 1, createRng(2));
    expect(managed.cops).toHaveLength(2);
    expect(managed.cops.every((cop) => cop.weapon === "pistol")).toBe(true);
    expect(
      manageCops(managed, world, COP_BODY_TICKS, createRng(2)).cops,
    ).toHaveLength(2);
  });
});
