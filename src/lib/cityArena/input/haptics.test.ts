import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { createArenaPlayer } from "../sim/roster";
import type { ArenaEvent, ArenaPlayerState } from "../sim/types";
import {
  EXPLOSION_FEEL_RADIUS_M,
  HAPTIC_MIN_GAP_MS,
  createHaptics,
  hapticPulses,
  tookDamage,
} from "./haptics";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

/** This client's player, standing at the origin with full health. */
function me(overrides: Partial<ArenaPlayerState> = {}): ArenaPlayerState {
  return { ...createArenaPlayer([0, 0], 0), id: 7, ...overrides };
}

/** A clock the test moves by hand. */
function clock(): { now: () => number; advance: (ms: number) => void } {
  let at = 1000;
  return { now: () => at, advance: (ms) => (at += ms) };
}

describe("createHaptics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps pulses at least 80 ms apart and lets a stronger one pre-empt", () => {
    const vibrate = vi.fn();
    const time = clock();
    const haptics = createHaptics({ vibrate }, () => true, time.now);
    haptics.fire("pickup");
    haptics.fire("pickup");
    expect(vibrate).toHaveBeenCalledTimes(1);
    haptics.fire("death");
    expect(vibrate).toHaveBeenCalledTimes(2);
    expect(vibrate).toHaveBeenLastCalledWith([120, 60, 220]);
    // Equal rank still waits for the gap; after it anything goes.
    haptics.fire("death");
    expect(vibrate).toHaveBeenCalledTimes(2);
    time.advance(HAPTIC_MIN_GAP_MS);
    haptics.fire("pickup");
    expect(vibrate).toHaveBeenCalledTimes(3);
    expect(vibrate).toHaveBeenLastCalledWith(12);
  });

  it("stays silent when Trillen is off and where the device cannot vibrate", () => {
    const vibrate = vi.fn();
    createHaptics({ vibrate }, () => false).fire("death");
    expect(vibrate).not.toHaveBeenCalled();
    expect(() => createHaptics({}, () => true).fire("death")).not.toThrow();
  });

  it("scales a car impact between the gentlest and the hardest knock", () => {
    const vibrate = vi.fn();
    const time = clock();
    const haptics = createHaptics({ vibrate }, () => true, time.now);
    haptics.fire("carImpact", 0);
    expect(vibrate).toHaveBeenLastCalledWith(40);
    time.advance(HAPTIC_MIN_GAP_MS);
    haptics.fire("carImpact", 1);
    expect(vibrate).toHaveBeenLastCalledWith(90);
    time.advance(HAPTIC_MIN_GAP_MS);
    haptics.fire("carImpact", 5);
    expect(vibrate).toHaveBeenLastCalledWith(90);
  });

  it("reports a device that throws on a pattern, and keeps going", () => {
    const vibrate = vi.fn(() => {
      throw new Error("bad pattern");
    });
    const haptics = createHaptics({ vibrate }, () => true);
    expect(() => haptics.fire("hit")).not.toThrow();
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.any(Error),
      { tags: { area: "arena", kind: "haptics" } },
    );
  });
});

describe("hapticPulses", () => {
  const player = me();

  it("feels a bullet through health, not through the hit event", () => {
    const hit: ArenaEvent = {
      kind: "hit",
      target: "player",
      ownerId: 2,
      x: 0,
      y: 0,
    };
    expect(hapticPulses([hit], me({ health: 100 }), 100)).toEqual([]);
    expect(hapticPulses([], me({ health: 80 }), 100)).toEqual([
      { kind: "hit", strength: 1 },
    ]);
    // A respawn sends health up; that is not a hit.
    expect(tookDamage(20, 100)).toBe(false);
    expect(tookDamage(null, 50)).toBe(false);
  });

  it("feels an explosion only when it is close", () => {
    const near: ArenaEvent = { kind: "explosion", x: 10, y: 0 };
    const far: ArenaEvent = {
      kind: "explosion",
      x: EXPLOSION_FEEL_RADIUS_M + 1,
      y: 0,
    };
    expect(hapticPulses([near, far], player, 100)).toEqual([
      { kind: "explosion", strength: 1 },
    ]);
  });

  it("feels its own car's knocks, scaled by speed, and nobody else's", () => {
    const driver = me({ vehicleId: 3 });
    const mine: ArenaEvent = {
      kind: "impact",
      vehicleId: 3,
      otherVehicleId: null,
      impactSpeed: 10,
    };
    const hitByMe: ArenaEvent = {
      kind: "impact",
      vehicleId: 9,
      otherVehicleId: 3,
      impactSpeed: 40,
    };
    const elsewhere: ArenaEvent = {
      kind: "impact",
      vehicleId: 9,
      otherVehicleId: 8,
      impactSpeed: 40,
    };
    expect(hapticPulses([mine, hitByMe, elsewhere], driver, 100)).toEqual([
      { kind: "carImpact", strength: 0.5 },
      { kind: "carImpact", strength: 1 },
    ]);
    expect(hapticPulses([mine], player, 100)).toEqual([]);
  });

  it("tells its own death from a kill it made, and ignores the rest", () => {
    const events: ArenaEvent[] = [
      { kind: "kill", victim: "player", victimId: 7, killerId: 2, x: 0, y: 0 },
      { kind: "kill", victim: "player", victimId: 2, killerId: 7, x: 0, y: 0 },
      { kind: "kill", victim: "ped", victimId: 40, killerId: 7, x: 0, y: 0 },
      { kind: "kill", victim: "player", victimId: 3, killerId: 2, x: 0, y: 0 },
    ];
    expect(
      hapticPulses(events, player, 100).map((pulse) => pulse.kind),
    ).toEqual(["death", "kill"]);
  });

  it("feels its own pickups and rising heat, not anyone else's", () => {
    const events: ArenaEvent[] = [
      { kind: "pickup", pickupKind: "uzi", playerId: 7, x: 0, y: 0 },
      { kind: "pickup", pickupKind: "uzi", playerId: 2, x: 0, y: 0 },
      { kind: "wanted", playerId: 7, level: 2 },
      { kind: "wanted", playerId: 7, level: 0 },
      { kind: "wanted", playerId: 2, level: 3 },
    ];
    expect(
      hapticPulses(events, player, 100).map((pulse) => pulse.kind),
    ).toEqual(["pickup", "wanted"]);
  });
});
