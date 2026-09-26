import { describe, expect, it } from "vitest";
import { boundsOf } from "../mapBuild/geometry";
import { createCollisionGrid } from "../world/collisionGrid";
import type { DecodedTile } from "../world/decode";
import type { MapIndex } from "../world/mapTypes";
import type { Point } from "../world/projection";
import { decodeRoadGraph } from "../world/roadGraph";
import { structureIdOf } from "../world/structureId";
import type { ArenaWorld } from "./arenaWorld";
import { applyBlast, blastFalloff, CAR_BLAST, type Blast } from "./blast";
import { createArenaPlayer } from "./roster";
import { createCop } from "./cops";
import { createVehicle } from "./vehicle";
import type { ArenaState, PedState } from "./types";

const index: MapIndex = {
  version: 1,
  generatedAt: "2026-09-26T00:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 },
  tileSize: 200,
  tiles: [],
  zones: [],
  landmarks: [],
};
const graph = decodeRoadGraph({ nodes: [], edges: [], classes: [], names: [] });

/** An `ArenaWorld` with an empty collision grid: no structure is ever in reach of a blast. */
function worldWithoutBuildings(): ArenaWorld {
  return { collision: createCollisionGrid(), index, graph };
}

/** A 10x10 m footprint centred on the origin: area 100 x 1 level clamps to the 120-health minimum. */
const SQUARE: Point[] = [
  [-5, -5],
  [5, -5],
  [5, 5],
  [-5, 5],
];

/** An `ArenaWorld` whose collision grid holds one building at `SQUARE`. */
function worldWithBuilding(): ArenaWorld {
  const grid = createCollisionGrid();
  grid.insertTile({
    x: 0,
    y: 0,
    rect: { minX: -100, minY: -100, maxX: 100, maxY: 100 },
    trees: [],
    furniture: [],
    roads: [],
    ground: [],
    water: [],
    buildings: [
      {
        structureId: structureIdOf(0, 0, 0),
        ring: SQUARE,
        bounds: boundsOf(SQUARE),
        levels: 1,
      },
    ],
  } satisfies DecodedTile);
  return { collision: grid, index, graph };
}

/** A minimal but complete arena state with nobody in it. */
function baseState(): ArenaState {
  return {
    tick: 0,
    seed: 1,
    nextId: 1,
    players: [],
    vehicles: [],
    bullets: [],
    effects: [],
    zoneKey: null,
    peds: [],
    cops: [],
    pickups: [],
    traffic: [],
    events: [],
    activeZoneKey: null,
    enforcedZoneKey: null,
    zoneEnforced: false,
  };
}

function pedAt(id: number, x: number, y: number): PedState {
  return {
    id,
    x,
    y,
    facing: 0,
    health: 40,
    mode: "walk",
    modeUntilTick: 0,
    rail: null,
    fleeX: 0,
    fleeY: 0,
  };
}

describe("blastFalloff", () => {
  it("is 1 at the centre, 0.75 at half the radius, 0.5 at the edge and 0 beyond", () => {
    expect(blastFalloff(0, 4)).toBe(1);
    expect(blastFalloff(2, 4)).toBeCloseTo(0.75);
    expect(blastFalloff(4, 4)).toBeCloseTo(0.5);
    expect(blastFalloff(4.01, 4)).toBe(0);
  });
});

describe("applyBlast — CAR_BLAST (flat, no entity falloff)", () => {
  it("deals flat damage to people and cars inside the radius, none beyond", () => {
    const world = worldWithoutBuildings();
    const state: ArenaState = {
      ...baseState(),
      peds: [pedAt(10, 1, 0), pedAt(11, 5, 0)],
      cops: [
        createCop(20, [0, 2], "pistol", 0),
        createCop(21, [0, 5], "pistol", 0),
      ],
      players: [{ ...createArenaPlayer([2.9, 0], 0), id: 30 }],
      vehicles: [
        { ...createVehicle(40, "compact", [-2.9, 0], 0, 0), health: 100 },
        { ...createVehicle(41, "compact", [3.1, 0], 0, 0), health: 100 },
      ],
    };
    const blast: Blast = { ...CAR_BLAST, x: 0, y: 0, ownerId: null };
    const next = applyBlast(state, blast, world, 5);

    expect(next.peds.find((p) => p.id === 10)?.mode).toBe("dead");
    expect(next.peds.find((p) => p.id === 11)?.health).toBe(40);
    expect(next.cops.find((c) => c.id === 20)?.health).toBe(20);
    expect(next.cops.find((c) => c.id === 21)?.health).toBe(100);
    expect(next.players.find((p) => p.id === 30)?.health).toBe(20);
    expect(next.vehicles.find((v) => v.id === 40)?.health).toBe(20);
    expect(next.vehicles.find((v) => v.id === 41)?.health).toBe(100);
    expect(next.events).toContainEqual({ kind: "explosion", x: 0, y: 0 });
    expect(next.events).toContainEqual(
      expect.objectContaining({
        kind: "kill",
        victim: "ped",
        victimId: 10,
        killerId: null,
      }),
    );
  });
});

describe("applyBlast — an explosive projectile (entity falloff on)", () => {
  const cannon: Omit<Blast, "x" | "y" | "ownerId"> = {
    entityRadius: 4,
    entityDamage: 70,
    vehicleDamage: 90,
    structureRadius: 5,
    structureDamage: 320,
    entityFalloff: true,
  };

  it("feathers entity damage with distance and credits kills to the shooter", () => {
    const world = worldWithoutBuildings();
    const state: ArenaState = {
      ...baseState(),
      cops: [
        createCop(20, [0, 2], "pistol", 0),
        createCop(21, [0, 4], "pistol", 0),
        createCop(22, [0, 4.01], "pistol", 0),
      ],
      peds: [pedAt(10, 0, 0)],
    };
    const blast: Blast = { ...cannon, x: 0, y: 0, ownerId: 7 };
    const next = applyBlast(state, blast, world, 9);

    // Half the radius (2 m of 4): 70 * blastFalloff(2, 4) = 70 * 0.75 = 52.5.
    expect(next.cops.find((c) => c.id === 20)?.health).toBeCloseTo(47.5);
    // At the edge: 70 * 0.5 = 35.
    expect(next.cops.find((c) => c.id === 21)?.health).toBeCloseTo(65);
    // Just beyond the edge: untouched.
    expect(next.cops.find((c) => c.id === 22)?.health).toBe(100);
    // At the centre, the ped's 40 health takes the full 70 and dies, credited to the shooter.
    expect(next.peds.find((p) => p.id === 10)?.mode).toBe("dead");
    expect(next.events).toContainEqual(
      expect.objectContaining({
        kind: "kill",
        victim: "ped",
        victimId: 10,
        killerId: 7,
      }),
    );
  });

  it("damages a structure at the falloff for its nearest footprint point, and crushes a ped inside it credited to the shooter", () => {
    const world = worldWithBuilding();
    // The footprint's near wall sits at x = 5; a blast centred 5 m further out is exactly at the
    // structure radius, so blastFalloff(5, 5) = 0.5 and the 120-health shed takes 320 * 0.5 = 160.
    const blast: Blast = { ...cannon, x: 10, y: 0, ownerId: 3 };
    const state: ArenaState = {
      ...baseState(),
      // Inside the footprint (SQUARE spans -5..5) but 10 m from the blast, well outside its 4 m
      // entityRadius — this ped only dies to the building's own collapse crush.
      peds: [pedAt(10, 0, 0)],
    };
    const next = applyBlast(state, blast, world, 4);

    const entry = next.structures?.find(
      (structure) => structure.id === structureIdOf(0, 0, 0),
    );
    expect(entry?.destroyedAtTick).toBe(4);
    expect(next.peds[0]).toMatchObject({ mode: "dead" });
    expect(next.events).toContainEqual(
      expect.objectContaining({
        kind: "kill",
        victim: "ped",
        victimId: 10,
        killerId: 3,
      }),
    );
    expect(next.events.some((event) => event.kind === "collapse")).toBe(true);
  });
});
