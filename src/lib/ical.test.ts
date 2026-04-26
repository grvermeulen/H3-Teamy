import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { fetchTeamEvents } from "./ical";
import { kvGetJson, kvSetJson } from "./kv";

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

function buildMockICS(dtStart: string, dtEnd: string, summary = "Match 1") {
  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Sportlink//NONSGML//NL
BEGIN:VEVENT
UID:12345
DTSTART:${dtStart}
DTEND:${dtEnd}
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
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("fetches and parses ical data", async () => {
    vi.mocked(kvGetJson).mockResolvedValue([]);

    const events = await fetchTeamEvents();

    expect(events).toHaveLength(1);
    expect(events[0].title).toBe("Match 1");
    expect(events[0].location).toBe("Pool A");
    expect(kvSetJson).toHaveBeenCalled();
  });

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
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { source: "sportlink_ical" },
        fingerprint: ["sportlink-ical-fetch"],
      }),
    );
  });

  it("reports to Sentry when HTTP response is not ok", async () => {
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
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { source: "sportlink_ical" },
        fingerprint: ["sportlink-ical-fetch"],
      }),
    );
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
