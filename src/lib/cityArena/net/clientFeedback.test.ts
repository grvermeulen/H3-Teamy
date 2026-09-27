import { describe, expect, it } from "vitest";
import { boundsOf } from "../mapBuild/geometry";
import { COLLAPSE_SHAKE_RADIUS_M } from "../render/feedback";
import { COLLAPSE_FEEL_RADIUS_M } from "../input/haptics";
import { EXPLOSION_RADIUS_M } from "../sim/damage";
import { createArenaPlayer } from "../sim/roster";
import type { ArenaState, BulletState, StructureState } from "../sim/types";
import { createVehicle } from "../sim/vehicle";
import { EXPLOSIVES } from "../sim/weapons";
import { createCollisionGrid } from "../world/collisionGrid";
import type { Point } from "../world/projection";
import { structureIdOf } from "../world/structureId";
import {
  COLLAPSE_LOCATE_RADIUS_M,
  FIRST_CLIENT_EFFECT_ID,
  createFeedbackQueue,
  snapshotFeedback,
  type SnapshotFeedbackInput,
} from "./clientFeedback";

/** The client's own player, standing at the origin. */
const ME = 3;
/** A 10×10 m footprint whose centre is 20 m north of the origin. */
const RING: Point[] = [
  [-5, 15],
  [5, 15],
  [5, 25],
  [-5, 25],
];
const BUILDING = structureIdOf(0, 0, 0);

/** A collision grid holding the one building at {@link RING}. */
function gridWithBuilding(): ReturnType<typeof createCollisionGrid> {
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
        structureId: BUILDING,
        ring: RING,
        bounds: boundsOf(RING),
        levels: 1,
      },
    ],
  });
  return grid;
}

/** A world with only this client's player in it, at `at`. */
function world(tick: number, at: Point = [0, 0]): ArenaState {
  return {
    tick,
    seed: 1,
    nextId: 100,
    players: [{ ...createArenaPlayer(at, 0), id: ME }],
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

/** A round of `weapon` in flight at `(x, y)`. */
function round(id: number, weapon: BulletState["weapon"], x = 8, y = 0) {
  return {
    id,
    ownerId: ME,
    ignoreVehicleId: null,
    x,
    y,
    directionX: 1,
    directionY: 0,
    speedMps: 45,
    rangeLeftM: 50,
    damage: 60,
    weapon,
  } satisfies BulletState;
}

/** The building's sparse entry: destroyed at `destroyedAtTick`, footprint known or not. */
function ruin(destroyedAtTick: number | null, known = false): StructureState {
  return {
    id: BUILDING,
    damage: 500,
    destroyedAtTick,
    lastHitTick: destroyedAtTick ?? 1,
    x: known ? 1 : 0,
    y: known ? 2 : 0,
    radius: known ? 7 : 0,
  };
}

/** The feedback between `before` and `after`, with the ids starting afresh. */
function feedback(
  before: ArenaState,
  after: ArenaState,
  collision: SnapshotFeedbackInput["collision"] = createCollisionGrid(),
) {
  return snapshotFeedback({
    before,
    after,
    collision,
    playerId: ME,
    nextEffectId: FIRST_CLIENT_EFFECT_ID,
  });
}

describe("snapshotFeedback", () => {
  it("sets off a rocket that vanished where it was last seen, with an event and a 4 m fireball", () => {
    const before = { ...world(10), bullets: [round(50, "rocket", 8, 3)] };
    const result = feedback(before, world(13));
    expect(result.events).toEqual([{ kind: "explosion", x: 8, y: 3 }]);
    expect(result.effects).toEqual([
      {
        id: FIRST_CLIENT_EFFECT_ID,
        kind: "explosion",
        x: 8,
        y: 3,
        angle: 0,
        bornTick: 13,
        ttlTicks: 18,
        radius: EXPLOSIVES.rocket!.entityRadius,
      },
    ]);
    expect(result.nextEffectId).toBe(FIRST_CLIENT_EFFECT_ID - 1);
  });

  it("sets off a vanished tank shell, but not a gun round or a rocket still in flight", () => {
    const before = {
      ...world(10),
      bullets: [round(50, "cannon"), round(51, "pistol"), round(52, "rocket")],
    };
    const after = { ...world(13), bullets: [round(52, "rocket", 12)] };
    const result = feedback(before, after);
    expect(result.events).toEqual([{ kind: "explosion", x: 8, y: 0 }]);
    expect(result.effects.map((effect) => effect.id)).toEqual([-1]);
  });

  it("blows up a car the host wrecked since the last snapshot at a car blast's 3 m, once", () => {
    const car = createVehicle(60, "sedan", [30, 4], 0, 0);
    const wreck = { ...car, wrecked: true, health: 0 };
    const before = { ...world(10), vehicles: [car] };
    const after = { ...world(13), vehicles: [wreck] };
    const result = feedback(before, after);
    expect(result.events).toEqual([{ kind: "explosion", x: 30, y: 4 }]);
    expect(result.effects[0]).toMatchObject({ radius: EXPLOSION_RADIUS_M });
    const again = feedback(after, { ...after, tick: 16 });
    expect(again.events).toEqual([]);
  });

  it("brings a building down where this client knew it stood, once", () => {
    const before = { ...world(10), structures: [ruin(null, true)] };
    const after = { ...world(13), structures: [ruin(12, true)] };
    expect(feedback(before, after).events).toEqual([
      { kind: "collapse", structureId: BUILDING, x: 1, y: 2, killerId: null },
    ]);
    expect(feedback(after, { ...after, tick: 16 }).events).toEqual([]);
  });

  it("finds a footprint it never knew in the collision grid near the player", () => {
    const after = { ...world(13), structures: [ruin(12)] };
    const events = feedback(world(10), after, gridWithBuilding()).events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "collapse",
      structureId: BUILDING,
    });
    const collapse = events[0] as { x: number; y: number };
    expect(collapse.x).toBeCloseTo(0);
    expect(collapse.y).toBeCloseTo(20);
  });

  it("leaves out a collapse it can place neither by its footprint nor near the player", () => {
    const far: Point = [0, 20 + COLLAPSE_LOCATE_RADIUS_M + 10];
    const after = { ...world(13, far), structures: [ruin(12)] };
    expect(feedback(world(10, far), after, gridWithBuilding()).events).toEqual(
      [],
    );
  });

  it("looks as far as any collapse is felt or shakes the screen", () => {
    expect(COLLAPSE_LOCATE_RADIUS_M).toBeGreaterThanOrEqual(
      Math.max(COLLAPSE_FEEL_RADIUS_M, COLLAPSE_SHAKE_RADIUS_M),
    );
  });
});

describe("createFeedbackQueue", () => {
  it("makes nothing up from the world it had before the first snapshot", () => {
    const queue = createFeedbackQueue(createCollisionGrid(), ME);
    const offline = { ...world(0), bullets: [round(7, "rocket")] };
    const first = world(40);
    expect(queue.fold(offline, first)).toBe(first);
    expect(queue.take()).toEqual([]);
  });

  it("queues each snapshot's events for one tick and counts effect ids down", () => {
    const queue = createFeedbackQueue(createCollisionGrid(), ME);
    queue.fold(world(0), world(10));
    const withTwo = {
      ...world(10),
      bullets: [round(50, "rocket"), round(51, "rocket")],
    };
    const next = queue.fold(withTwo, world(13));
    expect(next.effects.map((effect) => effect.id)).toEqual([-1, -2]);
    expect(queue.take()).toHaveLength(2);
    expect(queue.take()).toEqual([]);
    const later = queue.fold(
      { ...world(13), bullets: [round(52, "cannon")] },
      next,
    );
    expect(later.effects.map((effect) => effect.id)).toEqual([-1, -2, -3]);
  });
});
