import { describe, expect, it } from "vitest";
import { boundsOf, type Rect } from "../mapBuild/geometry";
import { createCollisionGrid } from "../world/collisionGrid";
import type { DecodedTile } from "../world/decode";
import type { Point } from "../world/projection";
import { structureIdOf } from "../world/structureId";
import { decodeRoadGraph } from "../world/roadGraph";
import type { MapIndex } from "../world/mapTypes";
import { createArenaState, stepArena, type ArenaWorld } from "./arena";
import { createArenaPlayer } from "./roster";
import { createCop } from "./cops";
import { createVehicle } from "./vehicle";
import { createRng } from "./rng";
import {
  createInput,
  type ArenaState,
  type PedState,
  type StructureState,
} from "./types";
import { withoutStructures } from "../world/collisionView";
import {
  BULLET_STRUCTURE_FACTOR,
  CRUSH_MARGIN_M,
  CRUSH_PERSON_DAMAGE,
  MAX_STRUCTURES,
  STRUCTURE_HEAL_TICKS,
  STRUCTURE_REBUILD_TICKS,
  damageStructure,
  destroyedStructureIds,
  stepStructures,
  structureDamageShare,
  type StructureHit,
} from "./structures";

/** A 10x10 m footprint at the origin: area 100 x 1 level x 1.2 clamps to the 120 minimum. */
const SQUARE: Point[] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

/** A square footprint offset `index * 20` m east, so distinct buildings never overlap. */
function squareAt(index: number): Point[] {
  const x0 = index * 20;
  return [
    [x0, 0],
    [x0 + 10, 0],
    [x0 + 10, 10],
    [x0, 10],
  ];
}

type BuildingSpec = { ring: Point[]; levels?: number; landmark?: string };

/** A single-tile fixture with the given buildings, ids assigned by their position in the list. */
function tileWith(buildings: BuildingSpec[]): DecodedTile {
  const bounds = (ring: Point[]): Rect => boundsOf(ring);
  return {
    x: 0,
    y: 0,
    rect: { minX: 0, minY: 0, maxX: 2000, maxY: 2000 },
    trees: [],
    furniture: [],
    roads: [],
    ground: [],
    water: [],
    buildings: buildings.map((spec, index) => ({
      structureId: structureIdOf(0, 0, index),
      ring: spec.ring,
      bounds: bounds(spec.ring),
      levels: spec.levels ?? 1,
      landmark: spec.landmark,
    })),
  };
}

/** The building obstacle at `index` in a grid built from `tileWith`. */
function obstacleAt(
  grid: ReturnType<typeof createCollisionGrid>,
  ring: Point[],
  index: number,
) {
  const obstacle = grid
    .query(boundsOf(ring))
    .find(
      (candidate) =>
        candidate.kind === "building" &&
        candidate.structure?.id === structureIdOf(0, 0, index),
    );
  if (!obstacle) throw new Error(`no building obstacle at index ${index}`);
  return obstacle;
}

/** A minimal but complete arena state with one player and nothing else. */
function baseState(): ArenaState {
  return {
    tick: 0,
    seed: 1,
    nextId: 1,
    players: [createArenaPlayer([0, 0], 0)],
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

describe("destroyedStructureIds", () => {
  it("collects only the ids that have collapsed", () => {
    const structures: StructureState[] = [
      {
        id: 1,
        damage: 10,
        destroyedAtTick: null,
        lastHitTick: 5,
        x: 0,
        y: 0,
        radius: 0,
      },
      {
        id: 2,
        damage: 120,
        destroyedAtTick: 40,
        lastHitTick: 40,
        x: 0,
        y: 0,
        radius: 0,
      },
    ];
    expect(destroyedStructureIds({ structures })).toEqual(new Set([2]));
    expect(destroyedStructureIds({ structures: undefined })).toEqual(new Set());
  });
});

describe("structureDamageShare", () => {
  it("is 0 for an absent entry and the damage fraction otherwise, capped at 1", () => {
    expect(structureDamageShare(undefined, 120)).toBe(0);
    expect(
      structureDamageShare(
        {
          id: 1,
          damage: 60,
          destroyedAtTick: null,
          lastHitTick: 1,
          x: 0,
          y: 0,
          radius: 0,
        },
        120,
      ),
    ).toBe(0.5);
    expect(
      structureDamageShare(
        {
          id: 1,
          damage: 999,
          destroyedAtTick: null,
          lastHitTick: 1,
          x: 0,
          y: 0,
          radius: 0,
        },
        120,
      ),
    ).toBe(1);
  });
});

describe("damageStructure", () => {
  it("destroys a building after three 50-damage hits, producing one collapse event", () => {
    const grid = createCollisionGrid();
    grid.insertTile(tileWith([{ ring: SQUARE, levels: 1 }]));
    const obstacle = obstacleAt(grid, SQUARE, 0);
    expect(obstacle.structure?.maxHealth).toBe(120);

    const hit = (killerId: number | null): StructureHit => ({
      obstacle,
      amount: 50,
      killerId,
    });

    let state = baseState();
    state = damageStructure(state, hit(7), 1);
    expect(state.structures).toEqual([
      {
        id: obstacle.structure!.id,
        damage: 50,
        destroyedAtTick: null,
        lastHitTick: 1,
        x: 5,
        y: 5,
        radius: expect.any(Number),
      },
    ]);
    expect(state.events).toEqual([]);

    state = damageStructure(state, hit(7), 2);
    expect(state.structures![0].damage).toBe(100);
    expect(state.events).toEqual([]);

    state = damageStructure(state, hit(7), 3);
    const entry = state.structures![0];
    expect(entry.damage).toBe(150);
    expect(entry.destroyedAtTick).toBe(3);
    expect(entry.lastHitTick).toBe(3);
    expect(entry.x).toBe(5);
    expect(entry.y).toBe(5);
    expect(entry.radius).toBeCloseTo(Math.sqrt(50), 5);
    expect(state.events).toEqual([
      {
        kind: "collapse",
        structureId: obstacle.structure!.id,
        x: 5,
        y: 5,
        killerId: 7,
      },
    ]);
  });

  it("never gives a landmark building an entry, however much damage it takes", () => {
    const grid = createCollisionGrid();
    grid.insertTile(tileWith([{ ring: SQUARE, landmark: "Kerk" }]));
    const obstacle = obstacleAt(grid, SQUARE, 0);
    expect(obstacle.structure?.maxHealth).toBe(Infinity);

    const state = damageStructure(
      baseState(),
      { obstacle, amount: 10_000, killerId: null },
      5,
    );
    expect(state.structures ?? []).toEqual([]);
    expect(state.events).toEqual([]);
  });

  it("ignores further hits on an already-destroyed entry", () => {
    const grid = createCollisionGrid();
    grid.insertTile(tileWith([{ ring: SQUARE, levels: 1 }]));
    const obstacle = obstacleAt(grid, SQUARE, 0);
    let state = baseState();
    for (let tick = 1; tick <= 3; tick++)
      state = damageStructure(
        state,
        { obstacle, amount: 50, killerId: 1 },
        tick,
      );
    expect(state.structures![0].destroyedAtTick).toBe(3);

    const hitAgain = damageStructure(
      state,
      { obstacle, amount: 50, killerId: 1 },
      4,
    );
    expect(hitAgain).toBe(state);
  });

  it("crushes and can kill a pedestrian just outside the footprint when the building collapses", () => {
    const grid = createCollisionGrid();
    grid.insertTile(tileWith([{ ring: SQUARE, levels: 1 }]));
    const obstacle = obstacleAt(grid, SQUARE, 0);
    // 1 m outside the west wall (x = 0): within CRUSH_MARGIN_M (1.5 m) of the footprint.
    const near = pedAt(300, -1, 5);
    // Comfortably outside the margin: must be left untouched.
    const far = pedAt(301, -5, 5);
    let state: ArenaState = { ...baseState(), peds: [near, far] };
    for (let tick = 1; tick <= 3; tick++)
      state = damageStructure(
        state,
        { obstacle, amount: 50, killerId: 9 },
        tick,
      );

    const crushedNear = state.peds.find((ped) => ped.id === 300);
    const untouchedFar = state.peds.find((ped) => ped.id === 301);
    expect(crushedNear).toMatchObject({ health: 0, mode: "dead" });
    expect(untouchedFar).toMatchObject({ health: 40, mode: "walk" });
    expect(state.events).toContainEqual({
      kind: "kill",
      victim: "ped",
      victimId: 300,
      killerId: 9,
      x: -1,
      y: 5,
    });
    expect(CRUSH_PERSON_DAMAGE).toBe(60);
    expect(CRUSH_MARGIN_M).toBe(1.5);
  });

  it("keeps at most MAX_STRUCTURES entries, dropping the least-damaged intact one when full", () => {
    const grid = createCollisionGrid();
    const specs: BuildingSpec[] = Array.from(
      { length: MAX_STRUCTURES + 1 },
      (_, index) => ({
        ring: squareAt(index),
        levels: 1,
      }),
    );
    grid.insertTile(tileWith(specs));
    const obstacles = specs.map((spec, index) =>
      obstacleAt(grid, spec.ring, index),
    );

    let state = baseState();
    obstacles.forEach((obstacle, index) => {
      state = damageStructure(
        state,
        { obstacle, amount: index + 1, killerId: null },
        index + 1,
      );
    });

    expect(state.structures).toHaveLength(MAX_STRUCTURES);
    const firstId = obstacles[0].structure!.id;
    const lastId = obstacles[MAX_STRUCTURES].structure!.id;
    expect(state.structures!.some((entry) => entry.id === firstId)).toBe(false);
    expect(state.structures!.some((entry) => entry.id === lastId)).toBe(true);
    const ids = state.structures!.map((entry) => entry.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });
});

describe("stepStructures", () => {
  it("heals an undamaged-since entry after STRUCTURE_HEAL_TICKS, not one tick sooner", () => {
    const entry: StructureState = {
      id: 1,
      damage: 40,
      destroyedAtTick: null,
      lastHitTick: 100,
      x: 5,
      y: 5,
      radius: 7.07,
    };
    const state: ArenaState = { ...baseState(), structures: [entry] };
    const stillDamaged = stepStructures(state, 100 + STRUCTURE_HEAL_TICKS - 1);
    expect(stillDamaged.structures).toEqual([entry]);
    const healed = stepStructures(state, 100 + STRUCTURE_HEAL_TICKS);
    expect(healed.structures).toEqual([]);
  });

  it("rebuilds a destroyed entry after STRUCTURE_REBUILD_TICKS, unless a car sits at its centre", () => {
    const entry: StructureState = {
      id: 2,
      damage: 120,
      destroyedAtTick: 200,
      lastHitTick: 200,
      x: 5,
      y: 5,
      radius: 7.07,
    };
    const car = createVehicle(50, "sedan", [5, 5], 0, 0);
    const occupied: ArenaState = {
      ...baseState(),
      structures: [entry],
      vehicles: [car],
    };
    const stillOccupied = stepStructures(
      occupied,
      200 + STRUCTURE_REBUILD_TICKS,
    );
    expect(stillOccupied.structures).toEqual([entry]);

    const empty: ArenaState = { ...baseState(), structures: [entry] };
    const notYet = stepStructures(empty, 200 + STRUCTURE_REBUILD_TICKS - 1);
    expect(notYet.structures).toEqual([entry]);
    const rebuilt = stepStructures(empty, 200 + STRUCTURE_REBUILD_TICKS);
    expect(rebuilt.structures).toEqual([]);
  });

  it("skips the occupancy check for a radius-0 (wire-adopted) entry and always rebuilds it", () => {
    const entry: StructureState = {
      id: 3,
      damage: 120,
      destroyedAtTick: 200,
      lastHitTick: 200,
      x: 5,
      y: 5,
      radius: 0,
    };
    const car = createVehicle(50, "sedan", [5, 5], 0, 0);
    const state: ArenaState = {
      ...baseState(),
      structures: [entry],
      vehicles: [car],
    };
    const rebuilt = stepStructures(state, 200 + STRUCTURE_REBUILD_TICKS);
    expect(rebuilt.structures).toEqual([]);
  });

  it("also treats a living player or cop at the centre as occupying the footprint", () => {
    const entry: StructureState = {
      id: 4,
      damage: 120,
      destroyedAtTick: 200,
      lastHitTick: 200,
      x: 5,
      y: 5,
      radius: 7.07,
    };
    const withPlayer: ArenaState = {
      ...baseState(),
      structures: [entry],
      players: [createArenaPlayer([5, 5], 0)],
    };
    expect(
      stepStructures(withPlayer, 200 + STRUCTURE_REBUILD_TICKS).structures,
    ).toEqual([entry]);

    const withCop: ArenaState = {
      ...baseState(),
      structures: [entry],
      cops: [createCop(9, [5, 5], "pistol", 0)],
    };
    expect(
      stepStructures(withCop, 200 + STRUCTURE_REBUILD_TICKS).structures,
    ).toEqual([entry]);
  });
});

describe("bullet hits on buildings via stepArena (integration)", () => {
  const index: MapIndex = {
    version: 1,
    generatedAt: "2026-09-26T00:00:00.000Z",
    origin: { lat: 51.98, lon: 5.625 },
    unitsPerMetre: 4,
    bounds: { minX: -26055, minY: -17692, maxX: 26055, maxY: 17692 },
    tileSize: 8000,
    tiles: [],
    zones: [],
    landmarks: [],
  };
  const graph = decodeRoadGraph({
    nodes: [0, 0, 100, 0],
    edges: [0, 1, 0, -1, 0, 100],
    classes: ["residential"],
    names: [],
  });
  /** A 10x10 m, 1-level building (maxHealth 120) with its near wall 5 m east of the player. */
  const BUILDING: Point[] = [
    [5, -5],
    [15, -5],
    [15, 5],
    [5, 5],
  ];

  function worldWithBuilding(): ArenaWorld {
    const grid = createCollisionGrid();
    grid.insertTile(tileWith([{ ring: BUILDING, levels: 1 }]));
    return { collision: grid, index, graph };
  }

  it("collapses a building under sustained pistol fire, after which bullets and movement pass through it", () => {
    const world = worldWithBuilding();
    let state: ArenaState = {
      ...baseState(),
      players: [{ ...createArenaPlayer([0, 0], 0), facing: 0 }],
    };
    const input = createInput({ fire: true, aim: 0 });
    const random = createRng(1);
    for (
      let tick = 0;
      tick < 400 && !state.structures?.some((s) => s.destroyedAtTick !== null);
      tick++
    )
      state = stepArena(
        state,
        new Map([[state.players[0].id, input]]),
        1 / 30,
        world,
        random,
      );

    expect(state.structures).toBeTruthy();
    const entry = state.structures!.find((s) => s.destroyedAtTick !== null);
    expect(entry).toBeDefined();
    expect(state.events.some((event) => event.kind === "collapse")).toBe(true);

    // The raw grid still treats the footprint as solid...
    const insideFootprint: Point = [10, 0];
    expect(world.collision.resolveCircle(insideFootprint, 0.4)).not.toEqual(
      insideFootprint,
    );
    // ...but the collision view built from the destroyed ids lets a circle pass straight through.
    const destroyed = destroyedStructureIds(state);
    const live = withoutStructures(world.collision, destroyed);
    expect(live.resolveCircle(insideFootprint, 0.4)).toEqual(insideFootprint);
  });
});

// Sanity: the bullet-to-structure conversion factor from the design spec (§3.3).
describe("BULLET_STRUCTURE_FACTOR", () => {
  it("is a quarter of the bullet's damage", () => {
    expect(BULLET_STRUCTURE_FACTOR).toBe(0.25);
  });
});
