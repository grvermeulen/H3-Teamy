import { describe, expect, it } from "vitest";
import { boundsOf } from "../mapBuild/geometry";
import { createCollisionGrid } from "../world/collisionGrid";
import type { DecodedTile } from "../world/decode";
import type { Point } from "../world/projection";
import {
  createShots,
  segmentHitsCircle,
  segmentHitsVehicle,
  stepBullets,
  type BulletHit,
  type BulletWorld,
  type ShotSource,
} from "./bullets";
import type { BulletState } from "./types";
import { createVehicle } from "./vehicle";
import { WEAPONS } from "./weapons";

const square: Point[] = [
  [10, -5],
  [20, -5],
  [20, 5],
  [10, 5],
];
const source: ShotSource = { ownerId: 0, ignoreVehicleId: null, firstId: 100 };
const step = 1 / 30;

function tileWith(buildings: Point[][]): DecodedTile {
  return {
    x: 0,
    y: 0,
    rect: { minX: -100, minY: -100, maxX: 1900, maxY: 1900 },
    roads: [],
    buildings: buildings.map((ring) => ({
      ring,
      bounds: boundsOf(ring),
      levels: 2,
    })),
    ground: [],
    water: [],
  };
}

function worldWith(partial: Partial<BulletWorld>): BulletWorld {
  return {
    collision: createCollisionGrid(),
    vehicles: [],
    players: [],
    ...partial,
  };
}

function pistolAt(x: number, y: number): BulletState[] {
  return createShots(WEAPONS.pistol, "pistol", [x, y], 0, source, () => 0.5);
}

describe("createShots", () => {
  it("fires one pistol bullet along the aim with the spec numbers", () => {
    const [bullet] = createShots(
      WEAPONS.pistol,
      "pistol",
      [1, 2],
      0,
      source,
      () => 0.5,
    );
    expect(bullet).toMatchObject({
      id: 100,
      ownerId: 0,
      ignoreVehicleId: null,
      x: 1,
      y: 2,
      directionX: 1,
      directionY: 0,
      speedMps: 120,
      rangeLeftM: 40,
      damage: 20,
      weapon: "pistol",
    });
  });

  it("spreads the Uzi by the seeded jitter and the shotgun into five pellets", () => {
    const [centre] = createShots(
      WEAPONS.uzi,
      "uzi",
      [0, 0],
      0,
      source,
      () => 0.5,
    );
    expect(centre.directionY).toBeCloseTo(0);
    const [edge] = createShots(WEAPONS.uzi, "uzi", [0, 0], 0, source, () => 1);
    expect(edge.directionY).toBeCloseTo(0.0698, 3);
    const pellets = createShots(
      WEAPONS.shotgun,
      "shotgun",
      [0, 0],
      0,
      source,
      () => 0,
    );
    expect(pellets).toHaveLength(5);
    expect(pellets.map((pellet) => pellet.id)).toEqual([
      100, 101, 102, 103, 104,
    ]);
    expect(pellets[0].directionY).toBeCloseTo(-0.1736, 3);
  });
});

describe("segment hit tests", () => {
  it("finds the entry parameter into a circle", () => {
    expect(segmentHitsCircle([0, 0], [10, 0], [5, 1], 0.4)).toBeNull();
    expect(segmentHitsCircle([0, 0], [10, 0], [5, 0.3], 0.4)).toBeCloseTo(
      0.4735,
      3,
    );
    expect(segmentHitsCircle([5, 0], [10, 0], [5, 0], 0.4)).toBe(0);
  });

  it("finds the entry parameter into a car body in its own frame", () => {
    const car = createVehicle(1, "sedan", [10, 0], 0, 0);
    expect(segmentHitsVehicle([0, 0], [20, 0], car)).toBeCloseTo(0.395);
    expect(segmentHitsVehicle([0, 2], [20, 2], car)).toBeNull();
    const turned = createVehicle(2, "sedan", [10, 0], Math.PI / 2, 0);
    expect(segmentHitsVehicle([0, 0], [20, 0], turned)).toBeCloseTo(0.455);
  });
});

describe("stepBullets", () => {
  it("moves bullets 4 m per tick at 120 m/s and drops them at the end of their range", () => {
    const world = worldWith({});
    const first = stepBullets(pistolAt(0, 0), step, world);
    expect(first.bullets[0].x).toBeCloseTo(4);
    expect(first.bullets[0].rangeLeftM).toBeCloseTo(36);
    expect(first.hits).toEqual([]);
    let bullets = first.bullets;
    for (let tick = 0; tick < 9; tick++)
      bullets = stepBullets(bullets, step, world).bullets;
    expect(bullets).toEqual([]);
  });

  it("stops at the first building outline", () => {
    const grid = createCollisionGrid();
    grid.insertTile(tileWith([square]));
    const world = worldWith({ collision: grid });
    let bullets = pistolAt(0, 0);
    let lastHits: BulletHit[] = [];
    for (let tick = 0; tick < 3; tick++) {
      const result = stepBullets(bullets, step, world);
      bullets = result.bullets;
      lastHits = result.hits;
    }
    expect(lastHits[0]).toMatchObject({
      point: [10, 0],
      target: { kind: "building" },
    });
    expect(bullets).toEqual([]);
  });

  it("hits players and cars in sweep order, ignores the shooter's own car and never the shooter", () => {
    const car = createVehicle(7, "sedan", [6, 0], 0, 0);
    const withPlayer = worldWith({
      vehicles: [car],
      players: [
        { id: 0, x: 0, y: 0 },
        { id: 1, x: 2, y: 0 },
      ],
    });
    const playerHit = stepBullets(pistolAt(0, 0), step, withPlayer);
    expect(playerHit.hits[0]).toMatchObject({
      target: { kind: "player", playerId: 1 },
    });
    expect(playerHit.hits[0].point[0]).toBeCloseTo(1.6);
    const withCar = worldWith({
      vehicles: [car],
      players: [{ id: 0, x: 0, y: 0 }],
    });
    const carHit = stepBullets(pistolAt(0, 0), step, withCar);
    expect(carHit.hits[0]).toMatchObject({
      target: { kind: "vehicle", vehicleId: 7 },
    });
    expect(carHit.hits[0].point[0]).toBeCloseTo(3.9);
    const ownCar = createVehicle(8, "sedan", [5, 0], 0, 0);
    const driveBy = createShots(
      WEAPONS.pistol,
      "pistol",
      [5, 0],
      0,
      { ...source, ignoreVehicleId: 8 },
      () => 0.5,
    );
    const passed = stepBullets(
      driveBy,
      step,
      worldWith({ vehicles: [ownCar] }),
    );
    expect(passed.hits).toEqual([]);
    expect(passed.bullets[0].x).toBeCloseTo(9);
  });

  it("keeps the fist reach to 1.2 m", () => {
    const punch = createShots(
      WEAPONS.fist,
      "fist",
      [0, 0],
      0,
      source,
      () => 0.5,
    );
    const first = stepBullets(punch, step, worldWith({}));
    expect(first.bullets[0].x).toBeCloseTo(1);
    expect(first.bullets[0].rangeLeftM).toBeCloseTo(0.2);
    expect(stepBullets(first.bullets, step, worldWith({})).bullets).toEqual([]);
  });
});
