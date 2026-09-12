import { localPlayer } from "./players";
import { describe, expect, it } from "vitest";
import { createArenaPlayer } from "./arena";
import { createShots } from "./bullets";
import { COP_BODY_TICKS, createCop } from "./cops";
import { checkInvariants } from "./invariants";
import { MAX_PEDS } from "./limits";
import { PED_BODY_TICKS } from "./peds";
import type { ArenaState, PedState } from "./types";
import { createVehicle } from "./vehicle";
import { WEAPONS } from "./weapons";

const healthy: ArenaState = {
  tick: 10,
  seed: 1,
  nextId: 3,
  players: [createArenaPlayer([5, 5], 0)],
  vehicles: [createVehicle(1, "sedan", [20, 0], 0, 0)],
  bullets: [],
  effects: [],
  zoneKey: null,
  peds: [],
  cops: [],
  pickups: [],
  traffic: [],
  events: [],
  activeZoneKey: null,
  zoneEnforced: false,
};

function pedAt(id: number, x: number): PedState {
  return {
    id,
    x,
    y: 0,
    facing: 0,
    health: 40,
    mode: "walk",
    modeUntilTick: 0,
    rail: null,
    fleeX: 0,
    fleeY: 0,
  };
}

describe("checkInvariants", () => {
  it("accepts a healthy state", () => {
    expect(checkInvariants(healthy)).toEqual([]);
  });

  it("reports broken health, positions, references and stale projectiles", () => {
    expect(
      checkInvariants({
        ...healthy,
        players: [{ ...localPlayer(healthy), health: 150 }],
      }),
    ).toContain("player 0 health 150 out of range");
    expect(
      checkInvariants({
        ...healthy,
        players: [{ ...localPlayer(healthy), x: Number.NaN }],
      }),
    ).toContain("player 0 position is not finite");
    expect(
      checkInvariants({
        ...healthy,
        players: [{ ...localPlayer(healthy), vehicleId: 999 }],
      }),
    ).toContain("player 0 vehicleId points to a missing or wrecked car");
    expect(
      checkInvariants({
        ...healthy,
        players: [
          { ...localPlayer(healthy), health: 0, diedAtTick: 4, vehicleId: 1 },
        ],
      }),
    ).toContain("dead player 0 must be on foot with zero health");
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

  it("rejects a steering command out of range or held on foot", () => {
    expect(
      checkInvariants({
        ...healthy,
        players: [{ ...localPlayer(healthy), driveSteer: 0.5 }],
      }),
    ).toEqual(["player 0 driveSteer 0.5 out of range or set on foot"]);
    expect(
      checkInvariants({
        ...healthy,
        players: [{ ...localPlayer(healthy), vehicleId: 1, driveSteer: 1.5 }],
      }),
    ).toEqual(["player 0 driveSteer 1.5 out of range or set on foot"]);
  });

  it("keeps drunkenness between sober and fully drunk", () => {
    expect(
      checkInvariants({
        ...healthy,
        players: [{ ...localPlayer(healthy), drunk: 1.2 }],
      }),
    ).toEqual(["player 0 drunk 1.2 out of range"]);
    expect(
      checkInvariants({
        ...healthy,
        players: [{ ...localPlayer(healthy), drunk: -0.1 }],
      }),
    ).toEqual(["player 0 drunk -0.1 out of range"]);
  });

  it("reports population caps, duplicate ids and invalid driver references", () => {
    const crowd = Array.from({ length: MAX_PEDS + 1 }, (_, index) =>
      pedAt(100 + index, index),
    );
    expect(checkInvariants({ ...healthy, peds: crowd })).toContain(
      "too many pedestrians",
    );
    expect(checkInvariants({ ...healthy, peds: [pedAt(1, 0)] })).toContain(
      "duplicate entity id 1",
    );
    expect(
      checkInvariants({
        ...healthy,
        traffic: [
          {
            vehicleId: 42,
            role: "traffic",
            cruiseMps: 10,
            fromNode: null,
            path: [],
            repathTick: 0,
          },
        ],
      }),
    ).toContain("driver of vehicle 42 has no intact car");
  });

  it("reports cop health, police drivers, expired bodies and overdue pickups", () => {
    const cop = createCop(5, [0, 0], "pistol", 0);
    expect(
      checkInvariants({ ...healthy, cops: [{ ...cop, health: 150 }] }),
    ).toContain("cop 5 health out of range");
    expect(
      checkInvariants({
        ...healthy,
        traffic: [
          {
            vehicleId: 1,
            role: "police",
            cruiseMps: 18,
            fromNode: null,
            path: [],
            repathTick: 0,
          },
        ],
      }),
    ).toContain("driver of vehicle 1 is not in a police car");
    const staleBody = {
      ...pedAt(50, 0),
      health: 0,
      mode: "dead" as const,
      modeUntilTick: healthy.tick,
    };
    expect(checkInvariants({ ...healthy, peds: [staleBody] })).toContain(
      "ped 50 body expired",
    );
    const staleCop = {
      ...cop,
      health: 0,
      diedAtTick: healthy.tick - COP_BODY_TICKS,
    };
    expect(checkInvariants({ ...healthy, cops: [staleCop] })).toContain(
      "cop 5 body expired",
    );
    const freshBody = {
      ...staleBody,
      modeUntilTick: healthy.tick + PED_BODY_TICKS,
    };
    expect(checkInvariants({ ...healthy, peds: [freshBody] })).toEqual([]);
    expect(
      checkInvariants({
        ...healthy,
        tick: 700,
        pickups: [{ id: 60, kind: "uzi", x: 0, y: 0, takenAtTick: 100 }],
      }),
    ).toContain("pickup 60 overdue for its respawn");
  });
});
