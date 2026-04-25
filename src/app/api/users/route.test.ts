import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { GET } from "./route";
import { getActiveUsers } from "@/lib/services/userService";
import { DbUnavailableError } from "@/lib/dbUnavailableError";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

vi.mock("@/lib/services/userService", () => ({
  getActiveUsers: vi.fn(),
}));

describe("GET /api/users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeRequest(url: string): NextRequest {
    return new NextRequest(new Request(url));
  }

  it("returns users on success", async () => {
    vi.mocked(getActiveUsers).mockResolvedValue([
      { id: "u1", name: "Jan Jansen" },
    ]);

    const response = await GET(makeRequest("http://localhost/api/users"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      users: [{ id: "u1", name: "Jan Jansen" }],
    });
    expect(vi.mocked(getActiveUsers)).toHaveBeenCalledWith(false);
  });

  it("passes refresh=1 to the service", async () => {
    vi.mocked(getActiveUsers).mockResolvedValue([]);

    await GET(makeRequest("http://localhost/api/users?refresh=1"));

    expect(vi.mocked(getActiveUsers)).toHaveBeenCalledWith(true);
  });

  it("returns 503 without Sentry when database is unavailable", async () => {
    vi.mocked(getActiveUsers).mockRejectedValue(new DbUnavailableError());

    const response = await GET(makeRequest("http://localhost/api/users"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error:
        "Database tijdelijk niet beschikbaar. Probeer het later opnieuw.",
    });
    expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
  });

  it("returns 500 and reports to Sentry on other errors", async () => {
    vi.mocked(getActiveUsers).mockRejectedValue(new Error("boom"));

    const response = await GET(makeRequest("http://localhost/api/users"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Er ging iets mis bij het ophalen van gebruikers.",
    });
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.any(Error),
    );
  });
});
