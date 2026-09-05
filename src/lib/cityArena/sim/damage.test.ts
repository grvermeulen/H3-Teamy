import { describe, expect, it } from "vitest";
import {
  damagePlayer,
  damageVehicle,
  impactDamage,
  inBlastRadius,
  isDead,
  isInvulnerable,
} from "./damage";
import type { ArenaPlayerState } from "./types";
import { createVehicle } from "./vehicle";

const walker: ArenaPlayerState = {
  id: 0,
  x: 0,
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

describe("damage", () => {
  it("computes impact damage above the 4 m/s threshold", () => {
    expect(impactDamage(3)).toBe(0);
    expect(impactDamage(10)).toBe(18);
    expect(impactDamage(30)).toBe(78);
  });

  it("hurts the player, records the death tick and then ignores further damage", () => {
    const hurt = damagePlayer(walker, 30, 10);
    expect(hurt).toMatchObject({ health: 70, diedAtTick: null });
    const dead = damagePlayer(hurt, 80, 20);
    expect(dead).toMatchObject({ health: 0, diedAtTick: 20 });
    expect(isDead(dead)).toBe(true);
    expect(damagePlayer(dead, 10, 21)).toBe(dead);
  });

  it("respects invulnerability until the given tick", () => {
    const shielded = { ...walker, invulnerableUntilTick: 50 };
    expect(damagePlayer(shielded, 10, 40)).toBe(shielded);
    expect(damagePlayer(shielded, 10, 50).health).toBe(90);
    expect(isInvulnerable(shielded, 49)).toBe(true);
    expect(isInvulnerable(shielded, 50)).toBe(false);
  });

  it("damages cars down to zero, leaves wrecks alone and tests the blast radius", () => {
    const car = createVehicle(1, "sedan", [0, 0], 0, 0);
    expect(damageVehicle(car, 78).health).toBe(22);
    expect(damageVehicle({ ...car, health: 22 }, 78).health).toBe(0);
    const wreck = { ...car, wrecked: true, health: 0 };
    expect(damageVehicle(wreck, 10)).toBe(wreck);
    expect(inBlastRadius(car, [2, 2])).toBe(true);
    expect(inBlastRadius(car, [3, 1])).toBe(false);
  });
});
