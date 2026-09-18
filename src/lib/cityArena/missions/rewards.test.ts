import { describe, expect, it } from "vitest";
import { MISDELIVERED_PARCEL as mission } from "./catalog";
import { missionPayment, settleMission } from "./rewards";
import { startMission } from "./runner";

describe("mission payments", () => {
  it("loses only the time bonus when delivery takes longer", () => {
    const run = {
      ...startMission(mission, 0, "contract", 0),
      status: "completed" as const,
      lastTick: 5401,
    };
    expect(missionPayment(mission, run)).toMatchObject({
      base: 250,
      bonus: 0,
      total: 250,
    });
    const wallet = settleMission(
      { balance: 50, earned: 500, receipts: [] },
      mission,
      run,
    );
    expect(wallet.balance).toBe(300);
    expect(wallet.earned).toBe(750);
  });
  it("rounds a replay reduction once over the full award", () => {
    const run = {
      ...startMission(mission, 0, "contract", 0, true),
      status: "completed" as const,
      lastTick: 100,
    };
    const odd = {
      ...mission,
      basePay: 251,
      bonus: { ...mission.bonus, amount: 75 },
    };
    expect(missionPayment(odd, run)).toMatchObject({
      base: 125,
      bonus: 38,
      total: 163,
    });
  });
  it("never pays a receipt under a different catalogue version", () => {
    const run = {
      ...startMission(mission, 0, "contract", 0),
      status: "completed" as const,
    };
    const wallet = { balance: 0, earned: 0, receipts: [] };
    expect(settleMission(wallet, { ...mission, version: 2 }, run)).toBe(wallet);
  });
});
