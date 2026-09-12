import { localPlayer } from "./players";
import { describe, expect, it } from "vitest";
import type { MapIndex, MapZone } from "../world/mapTypes";
import type { Point } from "../world/projection";
import { decodeRoadGraph } from "../world/roadGraph";
import { createArenaState } from "./arena";
import {
  PED_BODY_TICKS,
  PED_FLEE_TICKS,
  PED_RECYCLE_DISTANCE_M,
  PED_SPAWN_RADIUS_M,
  alivePeds,
  blastPeds,
  createPed,
  damagePed,
  pedLook,
  pedLookName,
  frightenPeds,
  recyclePeds,
  spawnPeds,
  stepPed,
  stepPeds,
  threatSources,
  type PedWorld,
} from "./peds";
import { createRng } from "./rng";
import type { ArenaState, PedState, RailPosition } from "./types";
import { createVehicle } from "./vehicle";

const graph = decodeRoadGraph({
  nodes: [0, 0, 400, 0, 400, 400, 0, 400],
  edges: [
    0, 1, 0, -1, 0, 400, 1, 2, 0, -1, 0, 400, 2, 3, 0, -1, 0, 400, 3, 0, 0, -1,
    0, 400,
  ],
  classes: ["residential"],
  names: [],
});
const zone: MapZone = {
  key: "campus",
  name: "WUR-campus",
  center: [200, 200],
  radius: 2000,
  spawnNodes: [[0, 0]],
  landmarks: [],
};
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
const world: PedWorld = {
  graph,
  collision: { resolveCircle: (point: Point): Point => point },
};
const east: RailPosition = { edge: 0, direction: 1, edgeT: 0.25, side: 1 };
const step = 1 / 30;

function walkerAt(x: number, y: number): PedState {
  return { ...createPed(7, graph, east), x, y };
}

function standingAt(id: number, x: number, y: number): PedState {
  return { ...walkerAt(x, y), id, rail: null };
}

function lonePlayer(): ArenaState {
  return createArenaState(
    { index: emptyIndex, graph, seed: 3, zone: null },
    createRng(3),
  );
}

describe("pedestrian spawning and movement", () => {
  it("creates a pavement pedestrian and walks its rail", () => {
    expect(createPed(7, graph, east)).toMatchObject({
      id: 7,
      x: 25,
      y: 4,
      facing: 0,
      health: 40,
      mode: "walk",
      rail: east,
    });
    let current = createPed(7, graph, east);
    for (let tick = 1; tick <= 30; tick++)
      current = stepPed(current, world, step, tick, () => 0) ?? current;
    expect(current.x).toBeCloseTo(26.4);
    expect(current.y).toBeCloseTo(4);
  });

  it("spawns deterministically away from the player and drops expired bodies", () => {
    const peds = spawnPeds(zone, graph, createRng(2), [[0, 0]], null, 100, 5);
    expect(peds.map((ped) => ped.id)).toEqual([100, 101, 102, 103, 104]);
    for (const ped of peds)
      expect(Math.hypot(ped.x, ped.y)).toBeGreaterThanOrEqual(30);
    expect(
      spawnPeds(zone, graph, createRng(2), [[0, 0]], null, 100, 5),
    ).toEqual(peds);
    expect(alivePeds([peds[0], { ...peds[1], mode: "dead" }])).toEqual([
      peds[0],
    ]);
  });

  it("spawns around the players when asked, and recycles the ones they left behind", () => {
    /** A 2 km residential street: 0–1000 m and 1000–2000 m. */
    const street = decodeRoadGraph({
      nodes: [0, 0, 4000, 0, 8000, 0],
      edges: [0, 1, 0, -1, 0, 4000, 1, 2, 0, -1, 0, 4000],
      classes: ["residential"],
      names: [],
    });
    const wide: MapZone = { ...zone, center: [4000, 0], radius: 8000 };
    const anchor: Point = [1000, 0];
    const peds = spawnPeds(
      wide,
      street,
      createRng(3),
      [anchor],
      null,
      100,
      20,
      [anchor],
    );
    expect(peds).toHaveLength(20);
    for (const ped of peds) {
      const distance = Math.hypot(ped.x - anchor[0], ped.y - anchor[1]);
      expect(distance).toBeGreaterThanOrEqual(30);
      expect(distance).toBeLessThanOrEqual(PED_SPAWN_RADIUS_M + 5);
    }
    const near = walkerAt(100, 4);
    const far = walkerAt(PED_RECYCLE_DISTANCE_M + 50, 4);
    const body: PedState = { ...walkerAt(900, 4), mode: "dead" };
    const onScreen = walkerAt(600, 4);
    const view = { minX: 550, minY: -50, maxX: 650, maxY: 50 };
    expect(recyclePeds([near, far, body, onScreen], [[0, 0]], view)).toEqual([
      near,
      body,
      onScreen,
    ]);
    const all = [near, far];
    expect(recyclePeds(all, [], null)).toBe(all);
    const close = [near];
    expect(recyclePeds(close, [[0, 0]], null)).toBe(close);
  });

  it("flees from nearby gunfire, then rejoins a rail", () => {
    const [scared] = frightenPeds([walkerAt(10, 4)], [[0, 4]], 50);
    expect(scared).toMatchObject({
      mode: "flee",
      modeUntilTick: 50 + PED_FLEE_TICKS,
      fleeX: 1,
      fleeY: 0,
      facing: 0,
    });
    const moved = stepPed(scared, world, step, 51, () => 0);
    expect(moved?.x).toBeCloseTo(10 + 5.5 / 30);
  });

  it("keeps dead bodies for 240 ticks and reports fresh threats", () => {
    const dead = damagePed(walkerAt(25, 4), 40, 10);
    expect(dead).toMatchObject({
      health: 0,
      mode: "dead",
      modeUntilTick: 10 + PED_BODY_TICKS,
      rail: null,
    });
    expect(stepPed(dead, world, step, 249, () => 0)).toBe(dead);
    expect(stepPed(dead, world, step, 250, () => 0)).toBeNull();
    expect(
      threatSources(
        [{ kind: "shot", weapon: "pistol", ownerId: 0, x: 1, y: 2 }],
        [
          {
            id: 1,
            kind: "explosion",
            x: 5,
            y: 6,
            angle: 0,
            bornTick: 9,
            ttlTicks: 18,
          },
        ],
        10,
      ),
    ).toEqual([
      [1, 2],
      [5, 6],
    ]);
  });
});

describe("pedestrian contacts", () => {
  it("pushes and kills a pedestrian with a fast car, crediting the driver", () => {
    const base = lonePlayer();
    const car = { ...createVehicle(40, "sedan", [0, 0], 0, 0), velocityX: 10 };
    const state: ArenaState = {
      ...base,
      vehicles: [car],
      peds: [standingAt(70, 1.5, 0)],
    };
    const hit = stepPeds(state, world, step, 5, () => 0);
    expect(hit.peds[0]).toMatchObject({ mode: "dead", health: 0 });
    expect(hit.peds[0].x).toBeCloseTo(3);
    expect(hit.events).toEqual([
      {
        kind: "kill",
        victim: "ped",
        victimId: 70,
        killerId: null,
        x: 1.5,
        y: 0,
      },
    ]);
    expect(
      stepPeds(
        { ...state, players: [{ ...localPlayer(state), vehicleId: 40 }] },
        world,
        step,
        5,
        () => 0,
      ).events[0],
    ).toMatchObject({ killerId: 0 });
  });

  it("kills pedestrians in an explosion but leaves distant ones alone", () => {
    const blast = blastPeds(
      [standingAt(72, 1, 0), standingAt(73, 5, 0)],
      { x: 0, y: 0 },
      3,
    );
    expect(blast.peds[0]).toMatchObject({ mode: "dead", modeUntilTick: 243 });
    expect(blast.peds[1].mode).toBe("walk");
    expect(blast.killed).toEqual([blast.peds[0]]);
  });
});

describe("pedLook", () => {
  it("derives a look in 0..5 from the id, every id included, and names its art", () => {
    expect(pedLook(0)).toBe(0);
    expect(pedLook(7)).toBe(1);
    expect(pedLook(-1)).toBe(5);
    expect(pedLookName(8)).toBe("ped3");
    const looks = new Set(Array.from({ length: 60 }, (_, id) => pedLook(id)));
    expect([...looks].sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
