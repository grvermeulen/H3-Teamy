import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isDbMetricsEnabled,
  recordPrismaQuery,
  withDbRequestMetrics,
} from "./dbMetrics";

describe("dbMetrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("isDbMetricsEnabled is true tenzij DB_METRICS_ENABLED=0", () => {
    vi.unstubAllEnvs();
    expect(isDbMetricsEnabled()).toBe(true);
    vi.stubEnv("DB_METRICS_ENABLED", "0");
    expect(isDbMetricsEnabled()).toBe(false);
  });

  it("recordPrismaQuery doet niets zonder metrics of zonder async context", () => {
    vi.stubEnv("DB_METRICS_ENABLED", "0");
    expect(() => recordPrismaQuery(10, "SELECT 1")).not.toThrow();
    vi.stubEnv("DB_METRICS_ENABLED", "1");
    expect(() => recordPrismaQuery(10, "SELECT 1")).not.toThrow();
  });

  it("withDbRequestMetrics voert fn direct uit als metrics uit staan", async () => {
    vi.stubEnv("DB_METRICS_ENABLED", "0");
    const r = await withDbRequestMetrics("/test", async () => 42);
    expect(r).toBe(42);
  });

  it("withDbRequestMetrics logt bij aan metrics", async () => {
    vi.stubEnv("DB_METRICS_ENABLED", "1");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const result = await withDbRequestMetrics("/api/x", async () => ({
      status: 200,
    }));
    expect(result).toEqual({ status: 200 });
    expect(info).toHaveBeenCalledTimes(1);
  });

  it("withDbRequestMetrics logt fout bij throw", async () => {
    vi.stubEnv("DB_METRICS_ENABLED", "1");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      withDbRequestMetrics("/api/y", async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow("fail");
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
