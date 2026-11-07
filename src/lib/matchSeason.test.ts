import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  matchDayAmsterdamYmd,
  matchSeasonYearRangeLabel,
  splitTeamEventsByMatchSeason,
} from "./matchSeason";
import type { TeamEvent } from "../types";

function evt(id: string, start: string): TeamEvent {
  return { id, title: `Match ${id}`, start };
}

describe("matchSeason", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses Amsterdam calendar day at UTC boundaries", () => {
    expect(matchDayAmsterdamYmd("2026-07-01T00:30:00.000Z")).toBe(
      "2026-07-01",
    );
    expect(matchDayAmsterdamYmd("2026-06-30T22:00:00.000Z")).toBe(
      "2026-07-01",
    );
  });

  it("labels july-to-july windows as sport years", () => {
    expect(matchSeasonYearRangeLabel("2026-07-01", "2027-07-01")).toBe(
      "2026–2027",
    );
  });

  it("keeps autumn fixtures in current and spring ones in previous season", () => {
    vi.stubEnv("SEASON_START", "01-07-2026");
    vi.stubEnv("SEASON_END", "01-07-2027");
    const now = new Date("2026-11-08T00:27:00.000Z").getTime();
    const split = splitTeamEventsByMatchSeason(
      [
        evt("old-apr", "2026-04-18T12:00:00.000Z"),
        evt("current-nov", "2026-11-07T17:50:00.000Z"),
        evt("future-jan", "2027-01-16T19:15:00.000Z"),
      ],
      now,
    );
    expect(split.currentSeason.map((e) => e.id)).toEqual([
      "current-nov",
      "future-jan",
    ]);
    expect(split.previousSeason.map((e) => e.id)).toEqual(["old-apr"]);
    expect(split.currentHeading).toBe("Dit seizoen (2026–2027)");
  });

  it("keeps stale cache older than the current window out of the current list", () => {
    vi.stubEnv("SEASON_START", "01-07-2026");
    vi.stubEnv("SEASON_END", "01-07-2027");
    const now = new Date("2026-11-08T00:27:00.000Z").getTime();
    const split = splitTeamEventsByMatchSeason(
      [
        evt("two-seasons-ago", "2025-11-01T12:00:00.000Z"),
        evt("current", "2026-11-14T18:00:00.000Z"),
      ],
      now,
    );
    expect(split.currentSeason.map((e) => e.id)).toEqual(["current"]);
    expect(split.previousSeason.map((e) => e.id)).toEqual(["two-seasons-ago"]);
  });

  it("reports an empty current season without inventing fixtures", () => {
    vi.stubEnv("SEASON_START", "01-07-2026");
    vi.stubEnv("SEASON_END", "01-07-2027");
    const now = new Date("2026-11-08T00:27:00.000Z").getTime();
    const split = splitTeamEventsByMatchSeason(
      [evt("old", "2026-04-11T12:00:00.000Z")],
      now,
    );
    expect(split.currentSeason).toHaveLength(0);
    expect(split.previousSeason).toHaveLength(1);
  });
});
