import { describe, expect, it } from "vitest";
import { boundsOf, rectsIntersect, type Rect } from "../mapBuild/geometry";
import { createCollisionGrid, type Obstacle } from "../world/collisionGrid";
import type { DecodedTile } from "../world/decode";
import type { MapIndex } from "../world/mapTypes";
import type { Point } from "../world/projection";
import { decodeRoadGraph } from "../world/roadGraph";
import { structureIdOf } from "../world/structureId";
import type { ArenaWorld } from "./arenaWorld";
import {
  STRUCTURE_LOOKUP_PAD_M,
  advanceBullets,
  structureObstacle,
} from "./combat";
import type { ArenaState, BulletState, PedState } from "./types";
import { WEAPONS } from "./weapons";

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

/** A cannon shell heading due east from the origin with the weapon's own spec numbers. */
function cannonShell(ownerId: number, rangeLeftM: number): BulletState {
  return {
    id: 900,
    ownerId,
    ignoreVehicleId: null,
    x: 0,
    y: 0,
    directionX: 1,
    directionY: 0,
    speedMps: WEAPONS.cannon.speedMps,
    rangeLeftM,
    damage: WEAPONS.cannon.damage,
    weapon: "cannon",
  };
}

describe("structureObstacle (Ruling 9)", () => {
  it("still resolves an obstacle when the hit point lies a hair outside its bounds", () => {
    const wall: Obstacle = {
      ring: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      kind: "building",
      structure: { id: 1, maxHealth: 120 },
    };
    const world: ArenaWorld = {
      collision: {
        query: (rect: Rect) =>
          rectsIntersect(wall.bounds, rect) ? [wall] : [],
        resolveCircle: (centre: Point) => centre,
      },
      index,
      graph,
    };
    // A float intersection point 1e-9 m outside the wall's own maxX bound: a zero-area query rect
    // there would miss it entirely (no padding), but STRUCTURE_LOOKUP_PAD_M widens the rect enough
    // to still find it.
    const point: Point = [10 + 1e-9, 5];
    expect(STRUCTURE_LOOKUP_PAD_M).toBeGreaterThan(1e-9);
    expect(structureObstacle(world, point, 1)).toBe(wall);
  });
});

describe("advanceBullets — explosive detonation", () => {
  function worldWithShed(): ArenaWorld {
    const grid = createCollisionGrid();
    const ring: Point[] = [
      [10, -5],
      [20, -5],
      [20, 5],
      [10, 5],
    ];
    const tile: DecodedTile = {
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
          ring,
          bounds: boundsOf(ring),
          levels: 1,
        },
      ],
    };
    grid.insertTile(tile);
    return { collision: grid, index, graph };
  }

  it("destroys a 120-health shed 10 m away and credits the shooter with the ped it crushes", () => {
    const world = worldWithShed();
    const state: ArenaState = {
      ...baseState(),
      bullets: [cannonShell(5, WEAPONS.cannon.rangeM)],
      // Well inside the shed's footprint (x 10..20, y -5..5), 5 m from the blast's centre (10, 0)
      // — beyond the cannon's 4 m entityRadius, so this ped can only die to the collapse crush.
      peds: [pedAt(99, 15, 0)],
    };
    // Travels exactly 10 m this tick, landing precisely on the shed's near wall.
    const dt = 10 / WEAPONS.cannon.speedMps;
    const next = advanceBullets(state, dt, world, 4);

    expect(next.bullets).toEqual([]);
    const entry = next.structures?.find(
      (structure) => structure.id === structureIdOf(0, 0, 0),
    );
    expect(entry?.destroyedAtTick).toBe(4);
    expect(next.peds[0]).toMatchObject({ mode: "dead" });
    expect(next.events).toContainEqual(
      expect.objectContaining({
        kind: "kill",
        victim: "ped",
        victimId: 99,
        killerId: 5,
      }),
    );
    expect(next.events).toContainEqual(
      expect.objectContaining({ kind: "collapse", killerId: 5 }),
    );
  });

  it("still explodes at its end point once it runs out of range without hitting anything", () => {
    const world: ArenaWorld = {
      collision: createCollisionGrid(),
      index,
      graph,
    };
    const state: ArenaState = {
      ...baseState(),
      bullets: [cannonShell(5, 2)],
      // 3 m off the flight path (clear of a direct hit) but within the 4 m entityRadius of the
      // shell's end point (2, 0): blastFalloff(3, 4) * 70 = 43.75, enough to kill a 40-health ped.
      peds: [pedAt(7, 2, 3)],
    };
    const next = advanceBullets(state, 1, world, 12);

    expect(next.bullets).toEqual([]);
    expect(next.events).toContainEqual({ kind: "explosion", x: 2, y: 0 });
    expect(next.peds[0]).toMatchObject({ mode: "dead" });
    expect(next.events).toContainEqual(
      expect.objectContaining({
        kind: "kill",
        victim: "ped",
        victimId: 7,
        killerId: 5,
      }),
    );
  });
});
