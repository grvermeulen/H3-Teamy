import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

describe("kvGetJson cache resilience", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns null instead of throwing when Redis get fails", async () => {
    vi.stubEnv("REDIS_URL", "redis://127.0.0.1:6379");
    vi.doMock("ioredis", () => ({
      default: vi.fn().mockImplementation(() => ({
        connect: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockRejectedValue(new Error("Redis down")),
        disconnect: vi.fn(),
      })),
    }));

    const { kvGetJson } = await import("./kv");
    const result = await kvGetJson("calendar:events:v1");

    expect(result).toBeNull();
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalled();
  });

  it("returns null instead of throwing when KV REST fetch fails", async () => {
    vi.stubEnv("KV_REST_API_URL", "https://kv.example.com");
    vi.stubEnv("KV_REST_API_TOKEN", "token");
    vi.spyOn(global, "fetch").mockRejectedValue(new TypeError("fetch failed"));

    const { kvGetJson } = await import("./kv");
    const result = await kvGetJson("calendar:events:v1");

    expect(result).toBeNull();
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalled();
  });
});
