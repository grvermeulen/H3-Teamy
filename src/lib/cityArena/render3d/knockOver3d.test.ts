import { Object3D, Quaternion, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";
import type { EffectState, VehicleState } from "../sim/types";
import { createVehicle, widthOf } from "../sim/vehicle";
import type { FurnitureInstance } from "./furnitureMesh";
import {
  BLAST_KNOCK_RADIUS_M,
  KNOCK_MIN_SPEED_MPS,
  KNOCK_REACH_M,
  createKnockOvers,
  type FurnitureSource,
  type KnockScene,
} from "./knockOver3d";

/** One bench at a point, its proxy standing there as the city's do; the fake city hands it out. */
function benchAt(x: number, y: number): FurnitureInstance {
  const object = new Object3D();
  object.position.set(x, 0, y);
  return { kind: "bench", x, y, heading: 0, object };
}

/** A city holding `pieces`, searched by straight-line distance, recording every search. */
function fakeCity(pieces: FurnitureInstance[]): FurnitureSource & {
  furnitureNear: ReturnType<typeof vi.fn>;
  keepDown: ReturnType<typeof vi.fn>;
} {
  return {
    keepDown: vi.fn(),
    furnitureNear: vi.fn(
      (
        x: number,
        y: number,
        radius: number,
        into: FurnitureInstance[] = [],
      ) => {
        into.length = 0;
        for (const piece of pieces)
          if (Math.hypot(piece.x - x, piece.y - y) <= radius) into.push(piece);
        return into;
      },
    ),
  };
}

function carAt(x: number, y: number, speed: number): VehicleState {
  const car = createVehicle(1, "sedan", [x, y], 0, 0);
  car.velocityX = speed;
  return car;
}

function explosionAt(id: number, x: number, y: number): EffectState {
  return { id, kind: "explosion", x, y, angle: 0, bornTick: 0, ttlTicks: 20 };
}

function scene(
  vehicles: VehicleState[],
  effects: EffectState[] = [],
): KnockScene {
  return { vehicles, effects };
}

describe("createKnockOvers", () => {
  it("knocks over furniture a car passes faster than 3 m/s, away from the car", () => {
    expect(KNOCK_MIN_SPEED_MPS).toBe(3);
    expect(KNOCK_REACH_M).toBe(1.5);
    const bench = benchAt(10, 2);
    const city = fakeCity([bench]);
    const knockOver = vi.fn();

    createKnockOvers().update(
      scene([carAt(10, 0, KNOCK_MIN_SPEED_MPS + 0.1)]),
      city,
      { knockOver },
    );

    expect(city.furnitureNear).toHaveBeenCalledWith(
      10,
      0,
      KNOCK_REACH_M + widthOf("sedan") / 2,
      expect.any(Array),
    );
    expect(knockOver).toHaveBeenCalledWith(bench.object, 10, 0);
  });

  it("has the city keep each knocked piece lying a quarter turn away from the hit", () => {
    const bench = benchAt(10, 2);
    const city = fakeCity([bench]);

    createKnockOvers().update(scene([carAt(10, 0, 8)]), city, {
      knockOver: vi.fn(),
    });

    expect(city.keepDown).toHaveBeenCalledTimes(1);
    const [piece, pose] = city.keepDown.mock.calls[0] as [
      FurnitureInstance,
      Quaternion,
    ];
    expect(piece).toBe(bench);
    const top = new Vector3(0, 1, 0).applyQuaternion(pose);
    // World y (away from the car here) is three's z.
    expect(top.x).toBeCloseTo(0);
    expect(top.y).toBeCloseTo(0);
    expect(top.z).toBeCloseTo(1);
  });

  it("leaves furniture alone next to a car at 3 m/s or slower", () => {
    const city = fakeCity([benchAt(10, 1)]);
    const knockOver = vi.fn();

    createKnockOvers().update(
      scene([carAt(10, 0, KNOCK_MIN_SPEED_MPS), carAt(10, 0, 0)]),
      city,
      { knockOver },
    );

    expect(city.furnitureNear).not.toHaveBeenCalled();
    expect(knockOver).not.toHaveBeenCalled();
  });

  it("reaches 1.5 m past the car's side, not further", () => {
    const reach = KNOCK_REACH_M + widthOf("sedan") / 2;
    const inside = benchAt(10, reach - 0.05);
    const outside = benchAt(10, -(reach + 0.05));
    const knockOver = vi.fn();

    createKnockOvers().update(
      scene([carAt(10, 0, 12)]),
      fakeCity([inside, outside]),
      { knockOver },
    );

    expect(knockOver).toHaveBeenCalledTimes(1);
    expect(knockOver).toHaveBeenCalledWith(inside.object, 10, 0);
  });

  it("knocks each piece over once, however long the car stays next to it", () => {
    const bench = benchAt(10, 1);
    const city = fakeCity([bench]);
    const knocks = createKnockOvers();
    const knockOver = vi.fn();

    for (let frame = 0; frame < 5; frame++)
      knocks.update(scene([carAt(10 + frame, 0, 8)]), city, { knockOver });

    expect(knockOver).toHaveBeenCalledTimes(1);
  });

  it("knocks over furniture within 3 m of a new explosion, away from the blast, once", () => {
    expect(BLAST_KNOCK_RADIUS_M).toBe(3);
    const near = benchAt(52, 50);
    const far = benchAt(54, 50);
    const city = fakeCity([near, far]);
    const knocks = createKnockOvers();
    const knockOver = vi.fn();
    const blast = explosionAt(4, 50, 50);

    knocks.update(scene([], [blast]), city, { knockOver });
    knocks.update(scene([], [blast]), city, { knockOver });

    expect(city.furnitureNear).toHaveBeenCalledTimes(1);
    expect(knockOver).toHaveBeenCalledTimes(1);
    expect(knockOver).toHaveBeenCalledWith(near.object, 50, 50);
  });

  it("ignores muzzle flashes and bullet impacts", () => {
    const city = fakeCity([benchAt(50, 50)]);
    const knockOver = vi.fn();

    createKnockOvers().update(
      scene(
        [],
        [
          { ...explosionAt(1, 50, 50), kind: "muzzle" },
          { ...explosionAt(2, 50, 50), kind: "impact" },
        ],
      ),
      city,
      { knockOver },
    );

    expect(knockOver).not.toHaveBeenCalled();
  });

  it("reuses one search list across frames", () => {
    const city = fakeCity([benchAt(10, 1)]);
    const knocks = createKnockOvers();

    knocks.update(scene([carAt(10, 0, 8)]), city, { knockOver: vi.fn() });
    knocks.update(scene([carAt(40, 0, 8)]), city, { knockOver: vi.fn() });

    const [first, second] = city.furnitureNear.mock.calls.map(
      (call) => call[3],
    );
    expect(second).toBe(first);
  });
});
