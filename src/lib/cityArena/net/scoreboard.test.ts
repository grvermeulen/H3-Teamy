import { describe, expect, it } from "vitest";
import type { ArenaEvent, ArenaPlayerState } from "../sim/types";
import {
  emptyTally,
  rankScoreboard,
  tallyEvents,
  type Tally,
} from "./scoreboard";

/** A kill event. */
function killed(victimId: number, killerId: number | null): ArenaEvent {
  return { kind: "kill", victim: "player", victimId, killerId, x: 0, y: 0 };
}

/** A player, of which the scoreboard only reads the id. */
function player(id: number): ArenaPlayerState {
  return { id } as ArenaPlayerState;
}

/** Folds several ticks of events in. */
function tallyAll(...ticks: ArenaEvent[][]): Tally {
  return ticks.reduce(tallyEvents, emptyTally());
}

describe("tallyEvents", () => {
  it("counts a kill for the killer and a death for the victim", () => {
    const tally = tallyAll([killed(2, 1)]);
    expect(tally.get(1)).toEqual({ playerId: 1, kills: 1, deaths: 0 });
    expect(tally.get(2)).toEqual({ playerId: 2, kills: 0, deaths: 1 });
  });

  it("counts a death with no killer, so an explosion still costs you", () => {
    const tally = tallyAll([killed(2, null)]);
    expect(tally.get(2)).toEqual({ playerId: 2, kills: 0, deaths: 1 });
    expect(tally.size).toBe(1);
  });

  it("gives a player who killed themselves the death and no kill", () => {
    // Otherwise the quickest route up the scoreboard would be a self-destruct.
    const tally = tallyAll([killed(3, 3)]);
    expect(tally.get(3)).toEqual({ playerId: 3, kills: 0, deaths: 1 });
  });

  it("ignores kills of pedestrians and cops", () => {
    const tally = tallyAll([
      { kind: "kill", victim: "ped", victimId: 40, killerId: 1, x: 0, y: 0 },
      { kind: "kill", victim: "cop", victimId: 41, killerId: 1, x: 0, y: 0 },
    ]);
    expect(tally.size).toBe(0);
  });

  it("ignores every other kind of event", () => {
    const tally = tallyAll([
      { kind: "explosion", x: 1, y: 2 },
      { kind: "shot", weapon: "uzi", ownerId: 1, x: 0, y: 0 },
    ]);
    expect(tally.size).toBe(0);
  });

  it("accumulates across ticks", () => {
    const tally = tallyAll([killed(2, 1)], [], [killed(2, 1)], [killed(1, 2)]);
    expect(tally.get(1)).toEqual({ playerId: 1, kills: 2, deaths: 1 });
    expect(tally.get(2)).toEqual({ playerId: 2, kills: 1, deaths: 2 });
  });

  it("does not modify the tally it was given", () => {
    const first = tallyAll([killed(2, 1)]);
    tallyEvents(first, [killed(2, 1)]);
    expect(first.get(2)?.deaths).toBe(1);
  });
});

describe("rankScoreboard", () => {
  it("gives everyone a line, including players who did nothing", () => {
    const lines = rankScoreboard(emptyTally(), [player(1), player(2)], 1);
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.kills === 0)).toBe(true);
  });

  it("ranks on kills first", () => {
    const tally = tallyAll([killed(2, 3)], [killed(2, 3)], [killed(3, 1)]);
    const lines = rankScoreboard(tally, [player(1), player(2), player(3)], 1);
    expect(lines.map((line) => line.playerId)).toEqual([3, 1, 2]);
  });

  it("breaks equal kills on fewer deaths", () => {
    const tally = tallyAll([killed(3, 1)], [killed(3, 2)], [killed(1, 3)]);
    const lines = rankScoreboard(tally, [player(1), player(2), player(3)], 1);
    expect(lines[0]!.playerId).toBe(2);
    expect(lines[1]!.playerId).toBe(1);
  });

  it("breaks a complete tie on the lower id, so two clients agree on the order", () => {
    const tally = tallyAll([killed(9, 5)], [killed(9, 2)]);
    const lines = rankScoreboard(tally, [player(5), player(2), player(9)], 5);
    expect(lines.map((line) => line.playerId)).toEqual([2, 5, 9]);
  });

  it("marks the reader", () => {
    const lines = rankScoreboard(emptyTally(), [player(1), player(2)], 2);
    expect(lines.find((line) => line.playerId === 2)?.isYou).toBe(true);
    expect(lines.find((line) => line.playerId === 1)?.isYou).toBe(false);
  });

  it("marks the winner", () => {
    const tally = tallyAll([killed(2, 1)]);
    const lines = rankScoreboard(tally, [player(1), player(2)], 1);
    expect(lines[0]!.isWinner).toBe(true);
    expect(lines[1]!.isWinner).toBe(false);
  });

  it("marks a shared top as several winners rather than picking one", () => {
    const tally = tallyAll([killed(3, 1)], [killed(3, 2)]);
    const lines = rankScoreboard(tally, [player(1), player(2), player(3)], 1);
    expect(
      lines.filter((line) => line.isWinner).map((l) => l.playerId),
    ).toEqual([1, 2]);
  });

  it("has no winner when nobody scored", () => {
    const lines = rankScoreboard(emptyTally(), [player(1), player(2)], 1);
    expect(lines.some((line) => line.isWinner)).toBe(false);
  });

  it("has no winner when the only deaths were accidents", () => {
    const tally = tallyAll([killed(1, null)], [killed(2, null)]);
    const lines = rankScoreboard(tally, [player(1), player(2)], 1);
    expect(lines.some((line) => line.isWinner)).toBe(false);
  });
});
