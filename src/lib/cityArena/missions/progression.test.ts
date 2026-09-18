import { beforeEach, describe, expect, it } from "vitest";
import {
  loadMissionProgress,
  saveMissionProgress,
  MISSION_SAVE_KEY,
} from "./progression";
import { emptyMissionProfile } from "./world";
import { startMission } from "./runner";
import { MISDELIVERED_PARCEL } from "./catalog";

describe("local story progression", () => {
  beforeEach(() => localStorage.clear());
  it("keeps wallet and unlocks atomic and counts offline time toward contact cooldowns", () => {
    const profile = {
      ...emptyMissionProfile(),
      completed: ["M01"],
      cooldownUntil: { M01: 10_000 },
      wallet: { balance: 325, earned: 325, receipts: [] },
    };
    saveMissionProgress(profile, 1000, 1_000_000);
    const saved = loadMissionProgress(1_060_000)!;
    expect(saved.profile.wallet).toEqual(profile.wallet);
    expect(saved.profile.completed).toEqual(["M01"]);
    expect(saved.profile.cooldownUntil.M01).toBe(8200);
  });
  it("resumes an interrupted checkpoint without stale actor IDs or an automatic payout", () => {
    const profile = emptyMissionProfile();
    profile.run = {
      ...startMission(MISDELIVERED_PARCEL, 0, "contract", 0),
      stage: 2,
      lastTick: 100,
      checkpoint: { stage: 2, inventory: ["pakket"] },
    };
    profile.actors = {
      ontvanger: {
        id: 222,
        routeIndex: 0,
        path: [],
        nextShot: 0,
        vehicleId: null,
      },
    };
    saveMissionProgress(profile, 100);
    const saved = loadMissionProgress()!;
    expect(saved.profile.run).toMatchObject({
      status: "failed",
      contractId: "contract",
      checkpoint: { stage: 2 },
    });
    expect(saved.profile.actors).toEqual({});
    expect(saved.profile.wallet.earned).toBe(0);
  });
  it("ignores corrupt and future-version saves", () => {
    localStorage.setItem(MISSION_SAVE_KEY, "{");
    expect(loadMissionProgress()).toBeNull();
    localStorage.setItem(
      MISSION_SAVE_KEY,
      JSON.stringify({
        version: 99,
        profile: emptyMissionProfile(),
        tick: 0,
        savedAt: 0,
      }),
    );
    expect(loadMissionProgress()).toBeNull();
  });
});
