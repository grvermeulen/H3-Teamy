import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

vi.mock("./kv", () => ({
  kvGetJson: vi.fn(),
  kvSetJson: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("ical", () => ({
  default: {
    parseICS: vi.fn(() => {
      throw new TypeError("BigInt is not a function");
    }),
  },
}));

import { fetchTeamEvents } from "./ical";
import { kvGetJson, kvSetJson } from "./kv";

describe("fetchTeamEvents when ical.parseICS throws", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SPORTLINK_ICAL_URL", "http://example.com/calendar.ics");
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve("BEGIN:VCALENDAR\nEND:VCALENDAR"),
    } as Response);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("falls back to cache and reports to Sentry", async () => {
    vi.mocked(kvGetJson).mockResolvedValue([
      {
        id: "cached-1",
        title: "Cached Match",
        start: new Date("2026-06-01T12:00:00.000Z").toISOString(),
      },
    ]);

    const events = await fetchTeamEvents();

    expect(events).toHaveLength(1);
    expect(events[0].title).toBe("Cached Match");
    expect(kvSetJson).not.toHaveBeenCalled();
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error));
  });
});
