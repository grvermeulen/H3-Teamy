import { describe, expect, it } from "vitest";
import {
  SPAWN_AMMO,
  WEAPONS,
  ammoFor,
  consumeAmmo,
  cooldownTicks,
  hasAmmo,
  nextWeapon,
  weaponLabel,
} from "./weapons";

describe("weapons", () => {
  it("carries the spec values and Dutch labels", () => {
    expect(WEAPONS.pistol).toMatchObject({
      damage: 20,
      rangeM: 40,
      speedMps: 120,
      magazine: null,
    });
    expect(WEAPONS.shotgun.pellets).toBe(5);
    expect(WEAPONS.uzi.spreadRad).toBeCloseTo(0.0698, 4);
    expect(weaponLabel("pistol")).toBe("Pistool");
    expect(weaponLabel("fist")).toBe("Vuist");
  });

  it("derives cooldowns in ticks from the fire rates", () => {
    expect(cooldownTicks("fist")).toBe(15);
    expect(cooldownTicks("pistol")).toBe(12);
    expect(cooldownTicks("uzi")).toBe(3);
    expect(cooldownTicks("shotgun")).toBe(25);
  });

  it("tracks ammo only for the magazine weapons", () => {
    expect(ammoFor(SPAWN_AMMO, "pistol")).toBeNull();
    expect(ammoFor(SPAWN_AMMO, "uzi")).toBe(60);
    expect(consumeAmmo(SPAWN_AMMO, "uzi")).toEqual({ uzi: 59, shotgun: 8 });
    expect(consumeAmmo(SPAWN_AMMO, "pistol")).toBe(SPAWN_AMMO);
    expect(hasAmmo({ uzi: 0, shotgun: 0 }, "uzi")).toBe(false);
    expect(hasAmmo({ uzi: 0, shotgun: 0 }, "fist")).toBe(true);
  });

  it("cycles to the next weapon that has ammo and wraps around", () => {
    expect(nextWeapon("pistol", SPAWN_AMMO)).toBe("uzi");
    expect(nextWeapon("pistol", { uzi: 0, shotgun: 8 })).toBe("shotgun");
    expect(nextWeapon("shotgun", SPAWN_AMMO)).toBe("fist");
    expect(nextWeapon("pistol", { uzi: 0, shotgun: 0 })).toBe("fist");
  });
});
