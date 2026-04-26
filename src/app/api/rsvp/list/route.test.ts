import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { GET } from "./route";
import {
  getUserProfiles,
  getUserRsvpStats,
  listEventRsvps,
} from "../../../../lib/kv";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

vi.mock("../../../../lib/kv", () => ({
  getUserProfiles: vi.fn(),
  getUserRsvpStats: vi.fn(),
  listEventRsvps: vi.fn(),
}));

vi.mock("../../../../lib/badges", () => ({
  getBadgeForAttendance: vi.fn(() => ({ label: "test" })),
}));

vi.mock("../../../../lib/dbMetrics", () => ({
  withDbRequestMetrics: vi.fn(
    async (_endpoint: string, fn: () => Promise<unknown>) => fn(),
  ),
}));

describe("GET /api/rsvp/list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeRequest(url: string): NextRequest {
    return new NextRequest(new Request(url));
  }

  it("returns counts without loading profile data when countsOnly is enabled", async () => {
    vi.mocked(listEventRsvps).mockResolvedValue([
      { userId: "u1", status: "yes" },
      { userId: "u2", status: "no" },
      { userId: "u3", status: "maybe" },
      { userId: "u4", status: null },
    ]);

    const response = await GET(
      makeRequest(
        "http://localhost/api/rsvp/list?eventId=wedstrijd-1&countsOnly=1",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      counts: { yes: 1, no: 1, maybe: 1 },
      lists: { yes: [], no: [], maybe: [] },
    });
    expect(vi.mocked(getUserProfiles)).not.toHaveBeenCalled();
    expect(vi.mocked(getUserRsvpStats)).not.toHaveBeenCalled();
  });

  it("keeps RSVP entries visible when a player profile has no display name", async () => {
    vi.mocked(listEventRsvps).mockResolvedValue([
      { userId: "u1", status: "yes" },
      { userId: "u2", status: "maybe" },
    ]);
    vi.mocked(getUserProfiles).mockResolvedValue({
      u1: { firstName: "", lastName: "", email: null },
      u2: { firstName: "Jan", lastName: "Jansen", email: null },
    });
    vi.mocked(getUserRsvpStats).mockResolvedValue({
      u1: { total: 0, yes: 0 },
      u2: { total: 3, yes: 2 },
    });

    const response = await GET(
      makeRequest("http://localhost/api/rsvp/list?eventId=wedstrijd-2"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      counts: { yes: 1, no: 0, maybe: 1 },
      lists: {
        yes: [{ id: "u1", name: "Onbekende speler" }],
        no: [],
        maybe: [{ id: "u2", name: "Jan Jansen" }],
      },
    });
  });

  it("returns a 500 response and reports Sentry when listing RSVPs fails", async () => {
    const error = new Error("db stuk");
    vi.mocked(listEventRsvps).mockRejectedValue(error);

    const response = await GET(
      makeRequest("http://localhost/api/rsvp/list?eventId=wedstrijd-3"),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "list_failed",
      message: "db stuk",
    });
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(error);
  });
});
