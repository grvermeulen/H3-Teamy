import { describe, expect, it } from "vitest";
import {
  resolveVehicleAgainstCircle,
  resolveVehicleAgainstPlayer,
  resolveVehiclePairs,
} from "./collisions";
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
  ammo: { uzi: 60, shotgun: 8, rifle: 0, bat: 0 },
  vehicleId: null,
  boardingTicksLeft: 0,
  nextShotTick: 0,
  diedAtTick: null,
  invulnerableUntilTick: 0,
  heat: 0,
  heatTick: 0,
  outsideSinceTick: null,
  drunk: 0,
};

describe("resolveVehiclePairs", () => {
  it("separates overlapping cars, exchanges approach velocity with restitution 0.3 and reports the impact", () => {
    const first = { ...createVehicle(1, "sedan", [0, 0], 0, 0), velocityX: 10 };
    const second = createVehicle(2, "sedan", [2, 0], 0, 0);
    const result = resolveVehiclePairs([first, second]);
    // Nose to tail two metres apart, the front and rear hull circles have crossed by 0.2 m: the
    // pull-apart is their 1.9 m contact distance plus that, split evenly between equal cars.
    expect(result.vehicles[0].x).toBeCloseTo(-1.05);
    expect(result.vehicles[1].x).toBeCloseTo(3.05);
    expect(result.vehicles[0].velocityX).toBeCloseTo(3.5);
    expect(result.vehicles[1].velocityX).toBeCloseTo(6.5);
    expect(result.impacts).toEqual([{ first: 0, second: 1, impactSpeed: 10 }]);
  });

  it("pushes cars apart along +x when they sit on the same spot", () => {
    const first = createVehicle(1, "sedan", [5, 5], 0, 0);
    const second = createVehicle(2, "sedan", [5, 5], 0, 0);
    const result = resolveVehiclePairs([first, second]);
    expect(result.vehicles[0].x).toBeCloseTo(5 - 0.95);
    expect(result.vehicles[1].x).toBeCloseTo(5 + 0.95);
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
    expect(result.vehicles[0].x).toBeCloseTo(-1.05);
  });

  it("lets a bus shove a compact: the lighter car moves and slows the more", () => {
    const bus = { ...createVehicle(1, "bus", [0, 0], 0, 0), velocityX: 10 };
    const compact = createVehicle(2, "compact", [7, 0], 0, 0);
    const result = resolveVehiclePairs([bus, compact]);
    const busMoved = Math.abs(result.vehicles[0].x);
    const compactMoved = result.vehicles[1].x - 7;
    expect(compactMoved).toBeGreaterThan(busMoved * 5);
    expect(result.vehicles[0].velocityX).toBeGreaterThan(8.5);
    expect(result.vehicles[1].velocityX).toBeGreaterThan(10);
    expect(result.impacts[0]?.impactSpeed).toBe(10);
  });

  it("ignores cars that are near but not touching, a bus's long body included", () => {
    const bus = createVehicle(1, "bus", [0, 0], 0, 0);
    const beside = createVehicle(2, "compact", [0, 4], 0, 0);
    const behind = createVehicle(3, "compact", [-9, 0], 0, 0);
    const touching = createVehicle(4, "compact", [0, 2], 0, 0);
    expect(resolveVehiclePairs([bus, beside, behind]).impacts).toEqual([]);
    expect(resolveVehiclePairs([bus, beside, behind]).vehicles[1].y).toBe(4);
    expect(resolveVehiclePairs([bus, touching]).vehicles[1].y).toBeGreaterThan(
      2,
    );
  });
});

describe("resolveVehicleAgainstPlayer", () => {
  it("pushes a player clear of a car and deals 5 × speed above 5 m/s", () => {
    const fast = { ...createVehicle(1, "sport", [0, 0], 0, 0), velocityX: 12 };
    const hit = resolveVehicleAgainstPlayer(fast, walker);
    // A metre in front of the centre is nearer the side face than the nose: out sideways, with
    // the moving car's extra clearance.
    expect(hit.player.x).toBeCloseTo(1);
    expect(hit.player.y).toBeCloseTo(1.8);
    expect(hit.damage).toBe(60);
  });

  it("pushes without hurting below 5 m/s and ignores players out of reach", () => {
    const slow = { ...createVehicle(1, "sport", [0, 0], 0, 0), velocityX: 3 };
    const nudged = resolveVehicleAgainstPlayer(slow, walker);
    expect(nudged.player.x).toBeCloseTo(1);
    expect(nudged.player.y).toBeCloseTo(1.3);
    expect(nudged.damage).toBe(0);
    const far = { ...walker, x: 5 };
    expect(resolveVehicleAgainstPlayer(slow, far)).toEqual({
      player: far,
      damage: 0,
    });
  });

  it("settles a player walking into a parked car at exactly minimum with no snap-back, while a moving car keeps the extra clearance", () => {
    const parked = createVehicle(1, "sport", [0, 0], 0, 0);
    const overlapping: ArenaPlayerState = { ...walker, x: 0.5 };
    const tickN = resolveVehicleAgainstPlayer(parked, overlapping);
    expect(tickN.player.x).toBeCloseTo(0.5);
    expect(tickN.player.y).toBeCloseTo(1.3);
    expect(tickN.damage).toBe(0);
    // Resolving again from the settled position (the same held-into-the-car input next
    // tick) must not move the player further: no 0.4 m snap-back oscillation.
    const tickNPlusOne = resolveVehicleAgainstPlayer(parked, tickN.player);
    expect(tickNPlusOne.player.x).toBeCloseTo(tickN.player.x);
    expect(tickNPlusOne.player.y).toBeCloseTo(tickN.player.y);

    const moving = { ...parked, velocityX: 12 };
    const hurt = resolveVehicleAgainstPlayer(moving, overlapping);
    expect(hurt.player.y).toBeCloseTo(1.8);
    expect(hurt.damage).toBe(60);
  });

  it("carries someone hit head-on in front of the nose, and someone beside a bus steps aside", () => {
    const car = { ...createVehicle(1, "sedan", [0, 0], 0, 0), velocityX: 12 };
    const headOn = resolveVehicleAgainstPlayer(car, { ...walker, x: 2.3 });
    expect(headOn.player.x).toBeCloseTo(3);
    expect(headOn.player.y).toBeCloseTo(0);
    const bus = createVehicle(2, "bus", [0, 0], 0, 0);
    const alongside = resolveVehicleAgainstPlayer(bus, {
      ...walker,
      x: -4,
      y: 1,
    });
    expect(alongside.player.x).toBeCloseTo(-4);
    expect(alongside.player.y).toBeCloseTo(1.65);
    expect(
      resolveVehicleAgainstPlayer(bus, { ...walker, x: -4, y: 3 }).player.y,
    ).toBe(3);
  });
});

describe("resolveVehicleAgainstCircle", () => {
  it("reports push-out and run-over damage for a person-sized circle", () => {
    const fast = { ...createVehicle(1, "sport", [0, 0], 0, 0), velocityX: 12 };
    const contact = resolveVehicleAgainstCircle(fast, [1, 0]);
    expect(contact.point[0]).toBeCloseTo(1);
    expect(contact.point[1]).toBeCloseTo(1.8);
    expect(contact.damage).toBe(60);
    expect(contact.touched).toBe(true);
    expect(resolveVehicleAgainstCircle(fast, [5, 0])).toEqual({
      point: [5, 0],
      damage: 0,
      touched: false,
    });
  });
});
