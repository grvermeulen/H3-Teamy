import { describe, expect, it } from "vitest";
import { splitPastAndFutureByStart } from "./listSplitPast";

describe("splitPastAndFutureByStart", () => {
  const now = new Date("2026-06-15T12:00:00.000Z").getTime();

  it("puts all past in recent when at or below the limit", () => {
    const items = [
      { start: "2026-06-01T10:00:00.000Z", id: "a" },
      { start: "2026-06-10T10:00:00.000Z", id: "b" },
    ];
    const { recentPast, olderPast, future } = splitPastAndFutureByStart(
      items,
      now,
      3,
    );
    expect(recentPast.map((e) => e.id)).toEqual(["a", "b"]);
    expect(olderPast).toHaveLength(0);
    expect(future).toHaveLength(0);
  });

  it("keeps an in-progress match in recentPast even when more than 3 past fixtures", () => {
    const items = [
      {
        start: "2026-11-01T17:50:00.000Z",
        end: "2026-11-01T19:50:00.000Z",
        id: "1",
      },
      {
        start: "2026-11-03T17:50:00.000Z",
        end: "2026-11-03T19:50:00.000Z",
        id: "2",
      },
      {
        start: "2026-11-05T17:50:00.000Z",
        end: "2026-11-05T19:50:00.000Z",
        id: "3",
      },
      {
        start: "2026-11-06T17:50:00.000Z",
        end: "2026-11-06T19:50:00.000Z",
        id: "4",
      },
      {
        start: "2026-11-07T17:50:00.000Z",
        end: "2026-11-07T20:30:00.000Z",
        id: "today-live",
      },
    ];
    const now = new Date("2026-11-07T19:00:00.000Z").getTime();
    const { recentPast, olderPast } = splitPastAndFutureByStart(items, now, 3);
    expect(recentPast.map((e) => e.id)).toContain("today-live");
    expect(olderPast.map((e) => e.id)).not.toContain("today-live");
  });

  it("classifies finished Amsterdam Saturday matches as past after kickoff", () => {
    const items = [
      { start: "2026-10-31T17:50:00.000Z", id: "w1" },
      { start: "2026-11-01T17:50:00.000Z", id: "w2" },
      { start: "2026-11-07T17:50:00.000Z", id: "today" },
      { start: "2026-11-14T17:00:00.000Z", id: "next" },
    ];
    const now = new Date("2026-11-07T20:59:00.000Z").getTime();
    const { recentPast, future } = splitPastAndFutureByStart(items, now, 3);
    expect(recentPast.map((e) => e.id)).toEqual(["w1", "w2", "today"]);
    expect(future.map((e) => e.id)).toEqual(["next"]);
  });

  it("keeps last 3 past and groups the rest as olderPast", () => {
    const items = [
      { start: "2026-05-01T10:00:00.000Z", id: "1" },
      { start: "2026-05-08T10:00:00.000Z", id: "2" },
      { start: "2026-06-01T10:00:00.000Z", id: "3" },
      { start: "2026-06-10T10:00:00.000Z", id: "4" },
      { start: "2026-06-14T10:00:00.000Z", id: "5" },
      { start: "2026-06-20T10:00:00.000Z", id: "6" },
    ];
    const { recentPast, olderPast, future } = splitPastAndFutureByStart(
      items,
      now,
      3,
    );
    expect(olderPast.map((e) => e.id)).toEqual(["1", "2"]);
    expect(recentPast.map((e) => e.id)).toEqual(["3", "4", "5"]);
    expect(future.map((e) => e.id)).toEqual(["6"]);
  });
});
