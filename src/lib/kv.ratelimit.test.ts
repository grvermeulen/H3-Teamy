import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

describe("kvIncrementWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("increments on Redis and sets the window's expiry on the first hit only", async () => {
    vi.stubEnv("REDIS_URL", "redis://127.0.0.1:6379");
    const incr = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    const expire = vi.fn().mockResolvedValue(1);
    // A class, not an arrow mock: kv.ts constructs the client with `new`.
    vi.doMock("ioredis", () => ({
      default: class {
        connect = vi.fn().mockResolvedValue(undefined);
        incr = incr;
        expire = expire;
        disconnect = vi.fn();
      },
    }));
    const { kvIncrementWindow } = await import("./kv");
    expect(await kvIncrementWindow("ratelimit:t:u:1", 60)).toBe(1);
    expect(await kvIncrementWindow("ratelimit:t:u:1", 60)).toBe(2);
    expect(incr).toHaveBeenCalledTimes(2);
    expect(expire).toHaveBeenCalledTimes(1);
    expect(expire).toHaveBeenCalledWith("ratelimit:t:u:1", 60);
  });

  it("answers null and reports when Redis fails, so the limiter fails open", async () => {
    vi.stubEnv("REDIS_URL", "redis://127.0.0.1:6379");
    vi.doMock("ioredis", () => ({
      default: class {
        connect = vi.fn().mockResolvedValue(undefined);
        incr = vi.fn().mockRejectedValue(new Error("Redis down"));
        expire = vi.fn();
        disconnect = vi.fn();
      },
    }));
    const { kvIncrementWindow } = await import("./kv");
    expect(await kvIncrementWindow("ratelimit:t:u:1", 60)).toBeNull();
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledTimes(1);
  });

  it("counts in memory when there is no store, and starts over once the window has passed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-09T10:00:00Z"));
    const { kvIncrementWindow } = await import("./kv");
    expect(await kvIncrementWindow("ratelimit:t:u:1", 60)).toBe(1);
    expect(await kvIncrementWindow("ratelimit:t:u:1", 60)).toBe(2);
    expect(await kvIncrementWindow("ratelimit:t:other:1", 60)).toBe(1);
    vi.setSystemTime(new Date("2026-09-09T10:01:01Z"));
    expect(await kvIncrementWindow("ratelimit:t:u:1", 60)).toBe(1);
  });
});
