import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";

const persistTeamEventsToDb = vi.fn().mockResolvedValue(2);
const fetchTeamEventsFromDb = vi.fn().mockResolvedValue([
  {
    id: "20261024--db-past",
    title: "Wedstrijd uit Postgres",
    start: "2026-10-24T17:50:00.000Z",
  },
]);

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

vi.mock("./kv", () => ({
  kvGetJson: vi.fn(),
  kvSetJson: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./db", () => ({
  prisma: { event: {} },
}));

vi.mock("./services/teamEventPersistenceService", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("./services/teamEventPersistenceService")
    >();
  return {
    ...actual,
    fetchTeamEventsFromDb,
    persistTeamEventsToDb,
  };
});

const futureIso = "20261114T180000Z";
const futureEnd = "20261114T200000Z";
const mockIcs = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:future-1
DTSTART:${futureIso}
DTEND:${futureEnd}
SUMMARY:Volgende wedstrijd
END:VEVENT
END:VCALENDAR`;

describe("fetchTeamEvents Postgres persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SPORTLINK_ICAL_URL", "http://example.com/calendar.ics");
    vi.stubEnv("DATABASE_URL", "postgresql://127.0.0.1:5432/h3teamy");
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("awaits a full persist after a successful Sportlink parse", async () => {
    const { kvGetJson } = await import("./kv");
    vi.mocked(kvGetJson).mockResolvedValue([]);
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(mockIcs),
    } as Response);

    const { fetchTeamEvents } = await import("./ical");
    const events = await fetchTeamEvents();

    expect(events.length).toBeGreaterThan(0);
    expect(persistTeamEventsToDb).toHaveBeenCalledTimes(1);
    expect(vi.mocked(persistTeamEventsToDb).mock.calls[0][1].length).toBe(
      events.length,
    );
  });

  it("backfills cache-only past fixtures when the feed fetch fails", async () => {
    const { kvGetJson } = await import("./kv");
    vi.mocked(kvGetJson).mockResolvedValue([
      {
        id: "20261107--today",
        title: "Wedstrijd vandaag",
        start: "2026-11-07T17:50:00.000Z",
        end: "2026-11-07T19:50:00.000Z",
      },
    ]);
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("fetch failed"));

    const { fetchTeamEvents } = await import("./ical");
    const events = await fetchTeamEvents();

    expect(events.some((e) => e.id === "20261107--today")).toBe(true);
    expect(persistTeamEventsToDb).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(persistTeamEventsToDb).mock.calls[0][1].map((e) => e.id),
    ).toEqual(["20261107--today"]);
    expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
  });

  it("serves Postgres history on cache miss when Sportlink is unavailable", async () => {
    const { kvGetJson } = await import("./kv");
    vi.mocked(kvGetJson).mockResolvedValue(null);
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("fetch failed"));

    const { fetchTeamEvents } = await import("./ical");
    const events = await fetchTeamEvents();

    expect(events.map((e) => e.id)).toEqual(["20261024--db-past"]);
    expect(fetchTeamEventsFromDb).toHaveBeenCalled();
  });
});
