import { describe, expect, it } from "vitest";
import { resolveVehicleAgainstPlayer, resolveVehiclePairs } from "./collisions";
import type { ArenaPlayerState } from "./types";
import { createVehicle } from "./vehicle";

const walker: ArenaPlayerState = {
  id: 0,
  x: 1,
  y: 0,
  facing: 0,
  speed: 0,
  health: 100,
  weapon: "pistol",
  ammo: { uzi: 60, shotgun: 8 },
  vehicleId: null,
  boardingTicksLeft: 0,
  nextShotTick: 0,
  diedAtTick: null,
  invulnerableUntilTick: 0,
};

describe("resolveVehiclePairs", () => {
  it("separates overlapping cars, exchanges approach velocity with restitution 0.3 and reports the impact", () => {
    const first = { ...createVehicle(1, "sedan", [0, 0], 0, 0), velocityX: 10 };
    const second = createVehicle(2, "sedan", [2, 0], 0, 0);
    const result = resolveVehiclePairs([first, second]);
    expect(result.vehicles[0].x).toBeCloseTo(-0.6);
    expect(result.vehicles[1].x).toBeCloseTo(2.6);
    expect(result.vehicles[0].velocityX).toBeCloseTo(3.5);
    expect(result.vehicles[1].velocityX).toBeCloseTo(6.5);
    expect(result.impacts).toEqual([{ first: 0, second: 1, impactSpeed: 10 }]);
  });

  it("pushes cars apart along +x when they sit on the same spot", () => {
    const first = createVehicle(1, "sedan", [5, 5], 0, 0);
    const second = createVehicle(2, "sedan", [5, 5], 0, 0);
    const result = resolveVehiclePairs([first, second]);
    expect(result.vehicles[0].x).toBeCloseTo(5 - 1.6);
    expect(result.vehicles[1].x).toBeCloseTo(5 + 1.6);
    expect(result.vehicles[0].y).toBeCloseTo(5);
    expect(result.impacts).toEqual([]);
  });

  it("leaves separated cars alone and only separates receding ones", () => {
    const parked = [
      createVehicle(1, "sedan", [0, 0], 0, 0),
      createVehicle(2, "sedan", [10, 0], 0, 0),
    ];
    expect(resolveVehiclePairs(parked)).toEqual({
      vehicles: parked,
      impacts: [],
    });
    const receding = [
      { ...createVehicle(1, "sedan", [0, 0], 0, 0), velocityX: -5 },
      createVehicle(2, "sedan", [2, 0], 0, 0),
    ];
    const result = resolveVehiclePairs(receding);
    expect(result.impacts).toEqual([]);
    expect(result.vehicles[0].velocityX).toBe(-5);
    expect(result.vehicles[0].x).toBeCloseTo(-0.6);
  });
});

describe("resolveVehicleAgainstPlayer", () => {
  it("pushes a player clear of a car and deals 5 × speed above 5 m/s", () => {
    const fast = { ...createVehicle(1, "sport", [0, 0], 0, 0), velocityX: 12 };
    const hit = resolveVehicleAgainstPlayer(fast, walker);
    expect(hit.player.x).toBeCloseTo(2.5);
    expect(hit.player.y).toBeCloseTo(0);
    expect(hit.damage).toBe(60);
  });

  it("pushes without hurting below 5 m/s and ignores players out of reach", () => {
    const slow = { ...createVehicle(1, "sport", [0, 0], 0, 0), velocityX: 3 };
    const nudged = resolveVehicleAgainstPlayer(slow, walker);
    expect(nudged.player.x).toBeCloseTo(2.5);
    expect(nudged.damage).toBe(0);
    const far = { ...walker, x: 5 };
    expect(resolveVehicleAgainstPlayer(slow, far)).toEqual({
      player: far,
      damage: 0,
    });
  });
});
