import { describe, expect, it } from "vitest";
import {
  ADS_SPREAD_FACTOR,
  addAmmo,
  aimedSpec,
  ammoFor,
  consumeAmmo,
  cooldownTicks,
  EXPLOSIVES,
  hasAmmo,
  isExplosive,
  isMelee,
  MAX_AMMO,
  nextWeapon,
  SPAWN_AMMO,
  WEAPON_ORDER,
  weaponLabel,
  WEAPONS,
} from "./weapons";

describe("aimedSpec", () => {
  it("narrows a spraying weapon's cone while aiming down the sights, and nothing else", () => {
    const shotgun = aimedSpec(WEAPONS.shotgun, true);
    expect(shotgun.spreadRad).toBeCloseTo(
      WEAPONS.shotgun.spreadRad * ADS_SPREAD_FACTOR,
    );
    expect({ ...shotgun, spreadRad: 0 }).toEqual({
      ...WEAPONS.shotgun,
      spreadRad: 0,
    });
    expect(aimedSpec(WEAPONS.uzi, false)).toBe(WEAPONS.uzi);
    expect(aimedSpec(WEAPONS.pistol, true).spreadRad).toBe(0);
  });
});

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
    expect(
      ammoFor({ uzi: 60, shotgun: 8, rifle: 0, bat: 0, rocket: 0 }, "uzi"),
    ).toBe(60);
    expect(
      consumeAmmo({ uzi: 60, shotgun: 8, rifle: 0, bat: 0, rocket: 0 }, "uzi"),
    ).toEqual({
      uzi: 59,
      shotgun: 8,
      rifle: 0,
      bat: 0,
      rocket: 0,
    });
    expect(consumeAmmo(SPAWN_AMMO, "pistol")).toBe(SPAWN_AMMO);
    expect(
      hasAmmo({ uzi: 0, shotgun: 0, rifle: 0, bat: 0, rocket: 0 }, "uzi"),
    ).toBe(false);
    expect(
      hasAmmo({ uzi: 0, shotgun: 0, rifle: 0, bat: 0, rocket: 0 }, "fist"),
    ).toBe(true);
  });

  it("adds pickup rounds up to the magazine caps", () => {
    expect(SPAWN_AMMO).toEqual({
      uzi: 0,
      shotgun: 0,
      rifle: 0,
      bat: 0,
      rocket: 0,
    });
    expect(MAX_AMMO).toEqual({
      uzi: 120,
      shotgun: 16,
      rifle: 30,
      bat: 40,
      rocket: 12,
    });
    expect(addAmmo(SPAWN_AMMO, "uzi", 60)).toEqual({
      uzi: 60,
      shotgun: 0,
      rifle: 0,
      bat: 0,
      rocket: 0,
    });
    expect(
      addAmmo({ uzi: 100, shotgun: 0, rifle: 0, bat: 0, rocket: 0 }, "uzi", 60),
    ).toEqual({
      uzi: 120,
      shotgun: 0,
      rifle: 0,
      bat: 0,
      rocket: 0,
    });
    expect(
      addAmmo(
        { uzi: 0, shotgun: 12, rifle: 0, bat: 0, rocket: 0 },
        "shotgun",
        8,
      ),
    ).toEqual({
      uzi: 0,
      shotgun: 16,
      rifle: 0,
      bat: 0,
      rocket: 0,
    });
    expect(
      addAmmo(
        { uzi: 60, shotgun: 8, rifle: 0, bat: 0, rocket: 0 },
        "pistol",
        5,
      ),
    ).toEqual({
      uzi: 60,
      shotgun: 8,
      rifle: 0,
      bat: 0,
      rocket: 0,
    });
  });

  it("cycles to the next weapon that has ammo and wraps around", () => {
    expect(nextWeapon("pistol", SPAWN_AMMO)).toBe("fist");
    expect(
      nextWeapon("pistol", { uzi: 0, shotgun: 8, rifle: 0, bat: 0, rocket: 0 }),
    ).toBe("shotgun");
    expect(nextWeapon("shotgun", SPAWN_AMMO)).toBe("fist");
    expect(
      nextWeapon("pistol", { uzi: 0, shotgun: 0, rifle: 0, bat: 0, rocket: 0 }),
    ).toBe("fist");
  });
});

describe("the bat and the rifle", () => {
  it("sit in the rack between and beyond the guns, with their own reach and pace", () => {
    expect(WEAPON_ORDER).toEqual([
      "fist",
      "bat",
      "pistol",
      "uzi",
      "shotgun",
      "rifle",
      "rocket",
    ]);
    expect(WEAPONS.bat.rangeM).toBe(1.6);
    expect(WEAPONS.rifle.rangeM).toBe(70);
    expect(cooldownTicks("bat")).toBe(20);
    expect(cooldownTicks("rifle")).toBe(38);
    expect(isMelee("bat")).toBe(true);
    expect(isMelee("rifle")).toBe(false);
  });

  it("carry rounds like the other magazines, the bat's being swings", () => {
    const empty = { uzi: 0, shotgun: 0, rifle: 0, bat: 0, rocket: 0 };
    expect(ammoFor(empty, "rifle")).toBe(0);
    const armed = addAmmo(addAmmo(empty, "rifle", 25), "bat", 50);
    expect(armed).toEqual({
      uzi: 0,
      shotgun: 0,
      rifle: 25,
      bat: 40,
      rocket: 0,
    });
    expect(consumeAmmo(armed, "rifle").rifle).toBe(24);
    expect(consumeAmmo(armed, "bat").bat).toBe(39);
    expect(consumeAmmo(armed, "fist")).toBe(armed);
  });
});

describe("the cannon", () => {
  it("is the tank's, never in the rack, and fires a car-wrecking shell every two seconds", () => {
    const empty = { uzi: 0, shotgun: 0, rifle: 0, bat: 0, rocket: 0 };
    expect(WEAPON_ORDER).not.toContain("cannon");
    expect(WEAPONS.cannon).toMatchObject({
      label: "Kanon",
      damage: 150,
      magazine: null,
    });
    expect(cooldownTicks("cannon")).toBe(60);
    expect(ammoFor(empty, "cannon")).toBeNull();
    expect(isMelee("cannon")).toBe(false);
    expect(nextWeapon("cannon", empty)).toBe("fist");
  });
});

describe("the rocket launcher", () => {
  const empty = { uzi: 0, shotgun: 0, rifle: 0, bat: 0, rocket: 0 };

  it("carries the spec's numbers under its Dutch name", () => {
    expect(WEAPONS.rocket).toEqual({
      label: "Raketwerper",
      damage: 60,
      shotsPerSecond: 0.6,
      rangeM: 90,
      speedMps: 45,
      spreadRad: 0,
      pellets: 1,
      magazine: 4,
    });
    expect(weaponLabel("rocket")).toBe("Raketwerper");
    expect(cooldownTicks("rocket")).toBe(50);
    expect(isMelee("rocket")).toBe(false);
  });

  it("closes the rack after the rifle and is skipped while empty", () => {
    expect(nextWeapon("rifle", { ...empty, rocket: 2 })).toBe("rocket");
    expect(nextWeapon("rocket", { ...empty, rocket: 2 })).toBe("fist");
    expect(nextWeapon("rifle", empty)).toBe("fist");
  });

  it("spawns empty and carries at most twelve rockets", () => {
    expect(SPAWN_AMMO.rocket).toBe(0);
    expect(MAX_AMMO.rocket).toBe(12);
    expect(ammoFor(empty, "rocket")).toBe(0);
    expect(addAmmo({ ...empty, rocket: 10 }, "rocket", 4).rocket).toBe(12);
    expect(consumeAmmo({ ...empty, rocket: 1 }, "rocket").rocket).toBe(0);
    expect(hasAmmo(empty, "rocket")).toBe(false);
  });
});

describe("EXPLOSIVES", () => {
  it("gives the cannon's shell the spec's blast numbers and marks it explosive", () => {
    expect(EXPLOSIVES.cannon).toEqual({
      entityRadius: 4,
      entityDamage: 70,
      vehicleDamage: 90,
      structureRadius: 5,
      structureDamage: 320,
      entityFalloff: true,
    });
    expect(isExplosive("cannon")).toBe(true);
  });

  it("gives the rocket the cannon's reach with a heavier structure blast", () => {
    expect(EXPLOSIVES.rocket).toEqual({
      entityRadius: 4,
      entityDamage: 70,
      vehicleDamage: 90,
      structureRadius: 5,
      structureDamage: 420,
      entityFalloff: true,
    });
    expect(isExplosive("rocket")).toBe(true);
  });

  it("leaves every other weapon a direct-damage-only hit", () => {
    for (const kind of WEAPON_ORDER)
      if (kind !== "rocket") expect(isExplosive(kind)).toBe(false);
  });
});
