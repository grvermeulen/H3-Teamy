import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DbUnavailableError } from "@/lib/dbUnavailableError";

const { authorize, command, capture } = vi.hoisted(() => ({
  authorize: vi.fn(),
  command: vi.fn(),
  capture: vi.fn(),
}));

vi.mock("@/lib/arenaAuth", () => ({ authorizeArenaRequest: authorize }));
vi.mock("@/lib/services/arenaRoomService", () => ({
  commandArenaRoom: command,
  ArenaRoomError: class ArenaRoomError extends Error {
    constructor(
      public readonly reason: string,
      public readonly status: number,
      message: string,
    ) {
      super(message);
      this.name = "ArenaRoomError";
    }
  },
}));
vi.mock("@/lib/rateLimit", async (original) => ({
  ...(await original<typeof import("@/lib/rateLimit")>()),
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));
vi.mock("@sentry/nextjs", () => ({ captureException: capture }));

import { POST } from "./route";

const request = (body: unknown) =>
  new NextRequest("http://localhost/api/arena/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Arena-Protocol": "3",
    },
    body: JSON.stringify(body),
  });

describe("POST /api/arena/session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorize.mockResolvedValue({ userId: "account", displayName: "Guido" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 503 without Sentry when arena tables are missing", async () => {
    command.mockRejectedValueOnce(new DbUnavailableError());
    const response = await POST(
      request({ action: "create", zone: "campus", joinNonce: crypto.randomUUID() }),
    );
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe(
      "Database tijdelijk niet beschikbaar. Probeer het later opnieuw.",
    );
    expect(capture).not.toHaveBeenCalled();
  });
});
