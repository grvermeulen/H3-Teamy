import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DbUnavailableError } from "@/lib/dbUnavailableError";

const { authorize, command } = vi.hoisted(() => ({
  authorize: vi.fn(),
  command: vi.fn(),
}));

vi.mock("@/lib/arenaAuth", () => ({ authorizeArenaRequest: authorize }));
vi.mock("@/lib/services/arenaRoomService", () => ({
  ArenaRoomError: class ArenaRoomError extends Error {
    constructor(
      public readonly reason: string,
      public readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
  commandArenaRoom: command,
}));
vi.mock("@/lib/rateLimit", () => ({
  ARENA_LIMITS: { join: { key: "arena-join", limit: 10, windowSec: 60 } },
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  rateLimited: vi.fn(),
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { POST } from "./route";

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/arena/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Arena-Protocol": "3",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/arena/session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorize.mockResolvedValue({ userId: "user-1", displayName: "Guido" });
  });

  it("returns 503 without Sentry when arena schema is missing", async () => {
    command.mockRejectedValue(new DbUnavailableError());

    const response = await POST(
      request({
        action: "create",
        zone: "campus",
        joinNonce: randomUUID(),
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Database tijdelijk niet beschikbaar. Probeer het later opnieuw.",
    });
    expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
  });
});
