import { describe, expect, it } from "vitest";
import type { EffectState } from "../sim/types";
import {
  MUZZLE_MATCH_M,
  RECOIL_RECOVERY_S,
  collectFreshMuzzles,
  createShotMemory,
  muzzleTickNear,
  newestMuzzleNear,
  registerShot,
} from "./entityShots";

const TICK = 200;

function effect(partial: Partial<EffectState>): EffectState {
  return {
    id: 1,
    kind: "muzzle",
    x: 0,
    y: 0,
    angle: 0,
    bornTick: TICK,
    ttlTicks: 2,
    ...partial,
  };
}

describe("collectFreshMuzzles", () => {
  it("keeps only muzzle flashes born this tick or the one before, in a reused list", () => {
    const out: EffectState[] = [effect({ id: 99 })];
    const effects = [
      effect({ id: 1 }),
      effect({ id: 2, bornTick: TICK - 1 }),
      effect({ id: 3, bornTick: TICK - 3 }),
      effect({ id: 4, kind: "impact" }),
      effect({ id: 5, kind: "explosion" }),
    ];
    const fresh = collectFreshMuzzles(effects, TICK, out);
    expect(fresh).toBe(out);
    expect(fresh.map((muzzle) => muzzle.id)).toEqual([1, 2]);
  });
});

describe("muzzleTickNear", () => {
  it("names the newest shot fired within reach of a gun", () => {
    const muzzles = [
      effect({ x: 0.5, bornTick: TICK - 1 }),
      effect({ x: -0.3, y: 0.4, bornTick: TICK }),
    ];
    expect(muzzleTickNear(muzzles, 0, 0)).toBe(TICK);
  });

  it("ignores flashes farther than the reach", () => {
    const muzzles = [effect({ x: MUZZLE_MATCH_M + 0.01 })];
    expect(muzzleTickNear(muzzles, 0, 0)).toBeNull();
    expect(muzzleTickNear([effect({ x: MUZZLE_MATCH_M })], 0, 0)).toBe(TICK);
  });
});

describe("newestMuzzleNear", () => {
  it("hands over the newest flash within reach, whose angle is the shot's aim", () => {
    const older = effect({ id: 1, bornTick: TICK - 1, angle: 0.3 });
    const newest = effect({ id: 2, x: 0.4, angle: -1.2 });
    const far = effect({ id: 3, x: MUZZLE_MATCH_M + 1, bornTick: TICK + 1 });
    expect(newestMuzzleNear([older, newest, far], 0, 0)).toBe(newest);
    expect(newestMuzzleNear([far], 0, 0)).toBeNull();
  });
});

describe("registerShot", () => {
  it("kicks fully on a new shot and eases back over the recovery time", () => {
    const memory = createShotMemory();
    registerShot(memory, TICK, 1 / 60);
    expect(memory).toMatchObject({ firedTick: TICK, recoil: 1 });
    registerShot(memory, null, RECOIL_RECOVERY_S / 2);
    expect(memory.recoil).toBeCloseTo(0.5, 6);
    registerShot(memory, null, RECOIL_RECOVERY_S);
    expect(memory.recoil).toBe(0);
  });

  it("kicks once per shot, however many frames still see its flash", () => {
    const memory = createShotMemory();
    registerShot(memory, TICK, 1 / 60);
    registerShot(memory, TICK, RECOIL_RECOVERY_S / 2);
    expect(memory.recoil).toBeCloseTo(0.5, 6);
    registerShot(memory, TICK - 1, 0);
    expect(memory.firedTick).toBe(TICK);
    registerShot(memory, TICK + 3, 1 / 60);
    expect(memory).toMatchObject({ firedTick: TICK + 3, recoil: 1 });
  });
});
