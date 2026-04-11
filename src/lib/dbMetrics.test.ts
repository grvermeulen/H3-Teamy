import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isDbMetricsEnabled,
  recordPrismaQuery,
  withDbRequestMetrics,
} from "./dbMetrics";

describe("dbMetrics", () => {
  const original = process.env.DB_METRICS_ENABLED;

  afterEach(() => {
    if (original === undefined) delete process.env.DB_METRICS_ENABLED;
    else process.env.DB_METRICS_ENABLED = original;
    vi.restoreAllMocks();
  });

  it("isDbMetricsEnabled is true tenzij DB_METRICS_ENABLED=0", () => {
    delete process.env.DB_METRICS_ENABLED;
    expect(isDbMetricsEnabled()).toBe(true);
    process.env.DB_METRICS_ENABLED = "0";
    expect(isDbMetricsEnabled()).toBe(false);
  });

  it("recordPrismaQuery doet niets zonder metrics of zonder async context", () => {
    process.env.DB_METRICS_ENABLED = "0";
    expect(() => recordPrismaQuery(10, "SELECT 1")).not.toThrow();
    process.env.DB_METRICS_ENABLED = "1";
    expect(() => recordPrismaQuery(10, "SELECT 1")).not.toThrow();
  });

  it("withDbRequestMetrics voert fn direct uit als metrics uit staan", async () => {
    process.env.DB_METRICS_ENABLED = "0";
    const r = await withDbRequestMetrics("/test", async () => 42);
    expect(r).toBe(42);
  });

  it("withDbRequestMetrics logt bij aan metrics", async () => {
    process.env.DB_METRICS_ENABLED = "1";
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const result = await withDbRequestMetrics("/api/x", async () => ({
      status: 200,
    }));
    expect(result).toEqual({ status: 200 });
    expect(info).toHaveBeenCalled();
  });

  it("withDbRequestMetrics logt fout bij throw", async () => {
    process.env.DB_METRICS_ENABLED = "1";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      withDbRequestMetrics("/api/y", async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow("fail");
    expect(warn).toHaveBeenCalled();
  });
});
