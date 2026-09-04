import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";

const mockRsvpFindMany = vi.fn();

vi.mock("@sentry/nextjs", () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
  vi.stubEnv("REDIS_URL", "redis://127.0.0.1:6379");
  vi.doMock("ioredis", () => ({
    default: class MockRedis {
      connect = vi.fn().mockResolvedValue(undefined);
      keys = vi.fn().mockResolvedValue(["rsvp:user-1:evt-preview"]);
      mget = vi.fn().mockResolvedValue(["yes"]);
    },
  }));
  vi.doMock("./db", () => ({
    prisma: {
      rsvp: { findMany: mockRsvpFindMany },
    },
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("listEventRsvps Prisma fallback", () => {
  it("falls back to Redis when Prisma credentials are invalid", async () => {
    mockRsvpFindMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("auth failed", {
        code: "P1000",
        clientVersion: "test",
      }),
    );

    const { listEventRsvps } = await import("./kv");
    const items = await listEventRsvps("evt-preview");

    expect(items).toEqual([{ userId: "user-1", status: "yes" }]);
    expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
    expect(vi.mocked(Sentry.addBreadcrumb)).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "postgres",
        data: expect.objectContaining({ operationName: "listEventRsvps" }),
      }),
    );
  });

  it("rethrows non-fallback Prisma errors", async () => {
    mockRsvpFindMany.mockRejectedValue(new Error("unexpected schema error"));

    const { listEventRsvps } = await import("./kv");

    await expect(listEventRsvps("evt-1")).rejects.toThrow(
      "unexpected schema error",
    );
  });
});
