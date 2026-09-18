import { describe, expect, it } from "vitest";
import { arenaScore, compareArenaScores, isArenaWinner } from "./scoring";
import { emptyTally, rankScoreboard, tallyEvents } from "./net/scoreboard";
import { emptyMissionProfile } from "./missions/world";
import { createArenaPlayer } from "./sim/roster";
import { validRoundReceipts } from "./missions/receipts";
import type { MissionReceipt } from "./missions/types";

const receipt: MissionReceipt = {
  contractId: "0:1:M01",
  missionId: "M01",
  version: 1,
  playerId: 0,
  tick: 900,
  base: 250,
  bonus: 75,
  total: 325,
};

describe("mission scoring", () => {
  it("ranks combined earnings, shares ties and preserves the legacy policy", () => {
    const cash = { kills: 0, deaths: 2, cashEarned: 1200 };
    const mixed = { kills: 2, deaths: 2, cashEarned: 700 };
    const kills = { kills: 4, deaths: 0, cashEarned: 0 };
    expect(arenaScore(mixed)).toBe(1200);
    expect(compareArenaScores(cash, kills)).toBeLessThan(0);
    expect(isArenaWinner(cash, mixed)).toBe(true);
    expect(isArenaWinner(kills, mixed)).toBe(false);
    expect(isArenaWinner(kills, cash, 1)).toBe(false);
    expect(compareArenaScores(kills, cash, 1)).toBeLessThan(0);
    expect(
      isArenaWinner({ kills: 0, deaths: 0 }, { kills: 0, deaths: 0 }),
    ).toBe(false);
  });

  it("retains paid cash after death or departure without counting repeated snapshots twice", () => {
    const player = {
      ...createArenaPlayer([0, 0], 0),
      mission: emptyMissionProfile(),
    };
    player.mission.wallet = { balance: 25, earned: 325, receipts: [receipt] };
    let tally = tallyEvents(emptyTally(), [], [player]);
    tally = tallyEvents(tally, [], [player]);
    tally = tallyEvents(
      tally,
      [
        {
          kind: "kill",
          victim: "player",
          victimId: 0,
          killerId: null,
          x: 0,
          y: 0,
        },
      ],
      [],
    );
    expect(rankScoreboard(tally, [], 0)[0]).toMatchObject({
      cashEarned: 325,
      score: 325,
      missionsCompleted: 1,
      deaths: 1,
      isWinner: true,
      receipts: [receipt],
    });
  });

  it("rejects duplicate, wrong-zone and inflated contract payments", () => {
    expect(validRoundReceipts([receipt], "rhenen", 180)).toBe(true);
    expect(validRoundReceipts([receipt, receipt], "rhenen", 180)).toBe(false);
    expect(
      validRoundReceipts([{ ...receipt, total: 999 }], "rhenen", 180),
    ).toBe(false);
    expect(validRoundReceipts([receipt], "campus", 180)).toBe(false);
    expect(
      validRoundReceipts(
        [{ ...receipt, bonus: 74, total: 324 }],
        "rhenen",
        180,
      ),
    ).toBe(false);
    expect(validRoundReceipts([receipt], "rhenen", 0)).toBe(false);
  });
});
