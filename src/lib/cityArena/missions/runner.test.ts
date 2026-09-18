import { describe, expect, it } from "vitest";
import {
  MISDELIVERED_PARCEL as mission,
  validateMissionGraph,
} from "./catalog";
import {
  revealMissionHint,
  retryMission,
  startMission,
  stepMission,
} from "./runner";
import { settleMission } from "./rewards";
import { observation } from "./testing/fixtures";
import type { MissionWallet } from "./types";

describe("parcel contract", () => {
  it("requires the parcel, note, old address and conversation before one final payout", () => {
    let run = startMission(mission, 0, "solo:0:M01:1", 0);
    run = stepMission(mission, run, observation({ interacted: true }));
    expect(run.stage).toBe(1);
    expect(run.inventory).toEqual(["parcel"]);
    for (let tick = 2; tick <= 31; tick++)
      run = stepMission(mission, run, observation({ tick, interacting: true }));
    expect(run.stage).toBe(2);
    run = stepMission(
      mission,
      run,
      observation({ tick: 32, position: [100, 0] }),
    );
    expect(run.stage).toBe(3);
    const remote = stepMission(
      mission,
      run,
      observation({ tick: 33, interacted: true }),
    );
    expect(remote.stage).toBe(3);
    run = stepMission(
      mission,
      remote,
      observation({ tick: 34, position: [100, 0], interacted: true }),
    );
    expect(run.stage).toBe(4);
    run = stepMission(
      mission,
      run,
      observation({ tick: 35, position: [200, 0], interacted: true }),
    );
    expect(run.status).toBe("completed");
    expect(run.inventory).toEqual([]);
    const empty: MissionWallet = { balance: 0, earned: 0, receipts: [] };
    const paid = settleMission(empty, mission, run);
    expect(paid).toMatchObject({ balance: 325, earned: 325 });
    expect(paid.receipts[0]).toMatchObject({ base: 250, bonus: 75 });
    expect(settleMission(paid, mission, JSON.parse(JSON.stringify(run)))).toBe(
      paid,
    );
    expect(retryMission(mission, run, 40, true)).toBe(run);
  });

  it("cannot complete several stages with one press, repeat a tick or act for another player", () => {
    const run = startMission(mission, 0, "round:0:M01:1", 0);
    const tick = observation({ interacting: true, interacted: true });
    const next = stepMission(mission, run, tick);
    expect(next.stage).toBe(1);
    expect(next.objective.ticks).toBe(0);
    expect(stepMission(mission, next, tick)).toBe(next);
    expect(stepMission(mission, run, { ...tick, playerId: 1 })).toBe(run);
  });

  it("fails on same-tick death before a handover and refuses to pay failures", () => {
    const run = {
      ...startMission(mission, 0, "contract", 0),
      stage: 4,
      inventory: ["parcel"],
    };
    const failed = stepMission(
      mission,
      run,
      observation({ alive: false, position: [200, 0], interacted: true }),
    );
    expect(failed).toMatchObject({
      status: "failed",
      failure: "Je bent uitgeschakeld.",
    });
    const wallet = { balance: 500, earned: 700, receipts: [] };
    expect(settleMission(wallet, mission, failed)).toBe(wallet);
  });

  it("accepts completion on the deadline but refuses late completion", () => {
    const timed = { ...mission, deadlineSeconds: 2 };
    const run = {
      ...startMission(timed, 0, "contract", 0),
      stage: 4,
      inventory: ["parcel"],
    };
    const finish = observation({
      tick: 60,
      position: [200, 0],
      interacted: true,
    });
    expect(stepMission(timed, run, finish).status).toBe("completed");
    expect(stepMission(timed, run, { ...finish, tick: 61 })).toMatchObject({
      status: "failed",
      failure: "De tijd is om.",
    });
    expect(
      stepMission(timed, run, { ...finish, interacted: false }).status,
    ).toBe("failed");
  });

  it("reveals hints after inactivity, or on request, and resets them for the next step", () => {
    const run = startMission(mission, 0, "contract", 0);
    expect(stepMission(mission, run, observation({ tick: 599 })).hint).toBe(0);
    expect(stepMission(mission, run, observation({ tick: 600 })).hint).toBe(1);
    const stuck = stepMission(mission, run, observation({ tick: 1350 }));
    expect(stuck.hint).toBe(2);
    expect(
      revealMissionHint(revealMissionHint(revealMissionHint(run))).hint,
    ).toBe(2);
    expect(
      stepMission(mission, stuck, observation({ tick: 1351, interacted: true }))
        .hint,
    ).toBe(0);
  });

  it("preserves checkpoint inventory and contract identity without granting a checkpoint payout", () => {
    const withCheckpoint = {
      ...mission,
      stages: mission.stages.map((stage, index) => ({
        ...stage,
        checkpoint: index === 0,
      })),
    };
    const collected = stepMission(
      withCheckpoint,
      startMission(withCheckpoint, 0, "contract", 0),
      observation({ interacted: true }),
    );
    const failed = stepMission(
      withCheckpoint,
      collected,
      observation({ tick: 2, alive: false }),
    );
    const restored = retryMission(withCheckpoint, failed, 30, true);
    expect(restored).toMatchObject({
      contractId: "contract",
      status: "active",
      stage: 1,
      inventory: ["parcel"],
      startedTick: 0,
    });
    expect(retryMission(withCheckpoint, failed, 30, false)).toMatchObject({
      stage: 0,
      inventory: [],
      startedTick: 30,
    });
    expect(
      settleMission(
        { balance: 0, earned: 0, receipts: [] },
        withCheckpoint,
        restored,
      ).earned,
    ).toBe(0);
  });

  it("rejects invalid content graphs before gameplay", () => {
    expect(validateMissionGraph(mission)).toEqual([]);
    expect(
      validateMissionGraph({
        ...mission,
        stages: mission.stages.map((stage) => ({ ...stage, next: "parcel" })),
      }),
    ).toContain("M01: cyclus bij parcel");
    expect(
      validateMissionGraph({
        ...mission,
        stages: mission.stages.map((stage) => ({ ...stage, next: "missing" })),
      }),
    ).toContain("M01: onbekende vervolgstap missing");
  });
});
