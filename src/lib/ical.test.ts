import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { fetchTeamEvents } from "./ical";
import { kvGetJson, kvSetJson } from "./kv";
import { formatEventTime } from "./datetime";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

vi.mock("./kv", () => ({
  kvGetJson: vi.fn(),
  kvSetJson: vi.fn().mockResolvedValue(undefined),
}));

const now = new Date();
const futureDate = new Date(now.getTime() + 1000 * 60 * 60 * 24);
const isoFuture =
  futureDate.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
const isoEnd =
  new Date(futureDate.getTime() + 1000 * 60 * 60)
    .toISOString()
    .replace(/[-:]/g, "")
    .split(".")[0] + "Z";

function buildMockICS(
  dtStart: string,
  dtEnd: string,
  summary = "Match 1",
  timeZone?: string,
) {
  const tzParam = timeZone ? `;TZID=${timeZone}` : "";
  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Sportlink//NONSGML//NL
BEGIN:VEVENT
UID:12345
DTSTART${tzParam}:${dtStart}
DTEND${tzParam}:${dtEnd}
SUMMARY:${summary}
LOCATION:Pool A
END:VEVENT
END:VCALENDAR`;
}

describe("fetchTeamEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SPORTLINK_ICAL_URL", "http://example.com/calendar.ics");
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(buildMockICS(isoFuture, isoEnd)),
    } as Response);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("fetches and parses ical data", async () => {
    vi.mocked(kvGetJson).mockResolvedValue([]);

    const events = await fetchTeamEvents();

    expect(events).toHaveLength(1);
    expect(events[0].title).toBe("Match 1");
    expect(events[0].location).toBe("Pool A");
    expect(events[0].start).toBe(
      futureDate.toISOString().replace(/\.\d{3}Z$/, ".000Z"),
    );
    expect(kvSetJson).toHaveBeenCalled();
  });

  it.each([
    [
      "20261010T184000",
      "20261010T204000",
      "2026-10-10T16:40:00.000Z",
      "2026-10-10T18:40:00.000Z",
      "18:40 – 20:40",
    ],
    [
      "20261107T185000",
      "20261107T205000",
      "2026-11-07T17:50:00.000Z",
      "2026-11-07T19:50:00.000Z",
      "18:50 – 20:50",
    ],
    [
      "20270320T184500",
      "20270320T204500",
      "2027-03-20T17:45:00.000Z",
      "2027-03-20T19:45:00.000Z",
      "18:45 – 20:45",
    ],
    [
      "20270403T173000",
      "20270403T193000",
      "2027-04-03T15:30:00.000Z",
      "2027-04-03T17:30:00.000Z",
      "17:30 – 19:30",
    ],
  ])(
    "honours Amsterdam TZID for %s and replaces the cached time",
    async (start, end, expectedStart, expectedEnd, expectedDisplay) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-17T12:00:00Z"));
      const id = `${start.slice(0, 8)}--match-1`;
      vi.mocked(kvGetJson).mockResolvedValue([
        { id, title: "Match 1", start: expectedEnd },
      ]);
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        text: () =>
          Promise.resolve(
            buildMockICS(start, end, "Match 1", "Europe/Amsterdam"),
          ),
      } as Response);

      const events = await fetchTeamEvents();

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        id,
        start: expectedStart,
        end: expectedEnd,
      });
      expect(formatEventTime(events[0].start, events[0].end)).toBe(
        expectedDisplay,
      );
      expect(kvSetJson).toHaveBeenCalledWith("calendar:events:v1", events);
    },
  );

  it("falls back to cache if fetch fails", async () => {
    vi.useFakeTimers();
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("Network error"));

    vi.mocked(kvGetJson).mockResolvedValue([
      {
        id: "cached-1",
        title: "Cached Match",
        start: new Date().toISOString(),
      },
    ]);

    const p = fetchTeamEvents();
    await vi.advanceTimersByTimeAsync(5000);
    const events = await p;
    vi.useRealTimers();

    expect(events).toHaveLength(1);
    expect(events[0].title).toBe("Cached Match");
    expect(kvSetJson).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("reports to Sentry when fetch fails and no cache or DB fallback exists", async () => {
    vi.useFakeTimers();
    vi.spyOn(global, "fetch").mockRejectedValue(
      new TypeError("fetch failed", {
        cause: new Error("certificate has expired"),
      }),
    );
    vi.mocked(kvGetJson).mockResolvedValue([]);

    const p = fetchTeamEvents();
    await vi.advanceTimersByTimeAsync(5000);
    const events = await p;
    vi.useRealTimers();

    expect(events).toHaveLength(0);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { source: "sportlink_ical" },
        fingerprint: ["sportlink-ical-fetch"],
      }),
    );
  });

  it("does not report to Sentry when HTTP response is not ok but cache has data", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve(""),
    } as Response);
    vi.mocked(kvGetJson).mockResolvedValue([
      {
        id: "cached-1",
        title: "Cached Match",
        start: new Date().toISOString(),
      },
    ]);

    const events = await fetchTeamEvents();

    expect(events).toHaveLength(1);
    expect(events[0].title).toBe("Cached Match");
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("merges new data with cache", async () => {
    const pastDate = new Date(Date.now() - 100000).toISOString();
    const futureDateIso = new Date(
      Date.now() + 1000 * 60 * 60 * 24,
    ).toISOString();

    const d = new Date(futureDateIso);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const id = `${y}${m}${day}--match-1`;

    vi.mocked(kvGetJson).mockResolvedValue([
      { id: "old-1", title: "Old Match", start: pastDate },
      { id, title: "Match 1 (Old)", start: futureDateIso },
    ]);

    const events = await fetchTeamEvents();

    expect(events).toHaveLength(2);

    const updatedMatch = events.find((e) => e.title === "Match 1");
    expect(updatedMatch).toBeDefined();

    expect(events[0].title).toBe("Old Match");
  });

  it("handles invalid ical data gracefully", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve("INVALID ICAL DATA"),
    } as Response);

    vi.mocked(kvGetJson).mockResolvedValue([]);
    const events = await fetchTeamEvents();
    expect(events).toHaveLength(0);
  });

  it("keeps matches more than 365 days in the future (Sportlink season feed)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-26T12:00:00.000Z"));
    const farFuture = new Date("2027-08-15T14:00:00.000Z");
    const isoFar =
      farFuture.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    const isoFarEnd =
      new Date(farFuture.getTime() + 3600000)
        .toISOString()
        .replace(/[-:]/g, "")
        .split(".")[0] + "Z";

    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(buildMockICS(isoFar, isoFarEnd, "Away game")),
    } as Response);
    vi.mocked(kvGetJson).mockResolvedValue([]);

    const events = await fetchTeamEvents();

    expect(events).toHaveLength(1);
    expect(events[0].title).toBe("Away game");
    vi.useRealTimers();
  });
});
