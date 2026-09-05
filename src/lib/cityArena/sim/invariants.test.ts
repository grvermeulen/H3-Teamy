import { describe, expect, it } from "vitest";
import { createArenaPlayer } from "./arena";
import { createShots } from "./bullets";
import { checkInvariants } from "./invariants";
import type { ArenaState } from "./types";
import { createVehicle } from "./vehicle";
import { WEAPONS } from "./weapons";

const healthy: ArenaState = {
  tick: 10,
  seed: 1,
  nextId: 3,
  player: createArenaPlayer([5, 5], 0),
  vehicles: [createVehicle(1, "sedan", [20, 0], 0, 0)],
  bullets: [],
  effects: [],
  held: { enter: false, weaponNext: false },
  zoneKey: null,
};

describe("checkInvariants", () => {
  it("accepts a healthy state", () => {
    expect(checkInvariants(healthy)).toEqual([]);
  });

  it("reports broken health, positions, references and stale projectiles", () => {
    expect(
      checkInvariants({
        ...healthy,
        player: { ...healthy.player, health: 150 },
      }),
    ).toContain("player.health 150 out of range");
    expect(
      checkInvariants({
        ...healthy,
        player: { ...healthy.player, x: Number.NaN },
      }),
    ).toContain("player position is not finite");
    expect(
      checkInvariants({
        ...healthy,
        player: { ...healthy.player, vehicleId: 999 },
      }),
    ).toContain("player.vehicleId points to a missing or wrecked car");
    expect(
      checkInvariants({
        ...healthy,
        player: { ...healthy.player, health: 0, diedAtTick: 4, vehicleId: 1 },
      }),
    ).toContain("dead player must be on foot with zero health");
    const [stale] = createShots(
      WEAPONS.pistol,
      "pistol",
      [0, 0],
      0,
      { ownerId: 0, ignoreVehicleId: null, firstId: 9 },
      () => 0,
    );
    expect(
      checkInvariants({ ...healthy, bullets: [{ ...stale, rangeLeftM: 0 }] }),
    ).toContain("bullet 9 expired or not finite");
    expect(
      checkInvariants({
        ...healthy,
        effects: [
          {
            id: 2,
            kind: "impact",
            x: 0,
            y: 0,
            angle: 0,
            bornTick: 0,
            ttlTicks: 6,
          },
        ],
      }),
    ).toContain("effect 2 expired");
  });
});
