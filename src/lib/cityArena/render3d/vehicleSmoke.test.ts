import { describe, expect, it, vi } from "vitest";
import type { VehicleState } from "../sim/types";
import { healthMaxOf, lengthOf, smokeHealthOf } from "../sim/vehicle";
import { createParticleSystem, type Particle } from "./particles";
import {
  createVehicleSmoke,
  VEHICLE_SMOKE_RANGE_M,
  WRECK_SMOKE_INTERVAL_S,
} from "./vehicleSmoke";

/** An intact sedan parked at (200, 300) facing east. */
const SEDAN: VehicleState = {
  id: 4,
  kind: "sedan",
  x: 200,
  y: 300,
  heading: 0,
  velocityX: 0,
  velocityY: 0,
  health: healthMaxOf("sedan"),
  wrecked: false,
  colour: 0,
};

const WRECK: VehicleState = { ...SEDAN, health: 0, wrecked: true };
const DAMAGED: VehicleState = {
  ...SEDAN,
  health: smokeHealthOf("sedan") - 1,
};
const NEAR = { x: 200, y: 300 };

function setup(smokeCapacity = 512) {
  const fire = createParticleSystem(256, true);
  const smoke = createParticleSystem(smokeCapacity, false);
  const puffs: Omit<Particle, "life">[] = [];
  const spawn = smoke.spawn.bind(smoke);
  vi.spyOn(smoke, "spawn").mockImplementation((particle) => {
    puffs.push({ ...particle });
    spawn(particle);
  });
  return { fire, smoke, puffs, vents: createVehicleSmoke(fire, smoke) };
}

/** Largest of a colour's red, green and blue bytes. */
function brightest(colour: number): number {
  return Math.max((colour >> 16) & 0xff, (colour >> 8) & 0xff, colour & 0xff);
}

describe("createVehicleSmoke", () => {
  it("pours a thick dark column from a wreck", () => {
    const { puffs, vents } = setup();

    vents.sync([WRECK], NEAR, 0);

    expect(puffs).toHaveLength(1);
    const [puff] = puffs;
    expect(brightest(puff.colour)).toBeLessThan(0x40);
    expect(puff.vy).toBeGreaterThan(0);
    expect(Math.hypot(puff.x - WRECK.x, puff.z - WRECK.y)).toBeLessThan(1);
  });

  it("rate-limits each vehicle instead of puffing every frame", () => {
    const { puffs, vents } = setup();

    vents.sync([WRECK], NEAR, 0);
    vents.sync([WRECK], NEAR, WRECK_SMOKE_INTERVAL_S / 2);
    expect(puffs).toHaveLength(1);

    vents.sync([WRECK], NEAR, WRECK_SMOKE_INTERVAL_S);
    expect(puffs).toHaveLength(2);
  });

  it("throws a few embers up from a wreck", () => {
    const { fire, vents } = setup();

    for (let frame = 0; frame < 60; frame++)
      vents.sync([WRECK], NEAR, frame / 60);

    expect(fire.alive()).toBeGreaterThan(0);
  });

  it("lets thin grey smoke out of a badly damaged car's bonnet", () => {
    const { puffs, vents } = setup();
    const heading = Math.PI / 2;

    vents.sync([{ ...DAMAGED, heading }], NEAR, 0);

    expect(puffs).toHaveLength(1);
    const [puff] = puffs;
    expect(brightest(puff.colour)).toBeGreaterThan(0x60);
    // Facing south (+y), the bonnet is ahead of the centre along +z.
    expect(puff.z).toBeGreaterThan(DAMAGED.y + lengthOf("sedan") / 4);
    expect(Math.abs(puff.x - DAMAGED.x)).toBeLessThan(0.5);
  });

  it("vents from the front whichever way the car faces", () => {
    const { puffs, vents } = setup();

    vents.sync([{ ...DAMAGED, heading: Math.PI }], NEAR, 0);

    // Facing west (−x), the bonnet is west of the centre.
    expect(puffs[0].x).toBeLessThan(DAMAGED.x - lengthOf("sedan") / 4);
  });

  it("leaves a healthy car alone", () => {
    const { puffs, vents } = setup();

    vents.sync([{ ...SEDAN, health: smokeHealthOf("sedan") + 1 }], NEAR, 0);

    expect(puffs).toHaveLength(0);
  });

  it("skips vehicles beyond 120 m of the camera focus", () => {
    const { puffs, vents } = setup();
    const far = { x: WRECK.x + VEHICLE_SMOKE_RANGE_M + 1, y: WRECK.y };

    vents.sync([WRECK], far, 0);
    expect(puffs).toHaveLength(0);

    vents.sync([WRECK], null, 0);
    expect(puffs).toHaveLength(1);
  });

  it("keeps half the smoke pool free for explosions and collapses", () => {
    const { smoke, vents } = setup(8);

    for (let frame = 0; frame < 20; frame++)
      vents.sync([WRECK, { ...WRECK, id: 5 }], NEAR, frame);

    expect(smoke.alive()).toBeLessThanOrEqual(smoke.capacity / 2);
  });

  it("forgets a vehicle once it has left the scene", () => {
    const { puffs, vents } = setup();
    vents.sync([WRECK], NEAR, 0);
    vents.sync([], NEAR, 0.01);

    vents.sync([WRECK], NEAR, 0.02);

    expect(puffs).toHaveLength(2);
  });
});
