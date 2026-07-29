import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { getPgPoolConfig, getPrismaPgAdapterOptions } from "./pgPool";

vi.mock("@sentry/nextjs", () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
}));

describe("getPgPoolConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses max 1 on Vercel when PG_POOL_MAX is unset", () => {
    vi.stubEnv("VERCEL", "1");
    const cfg = getPgPoolConfig("postgresql://u:p@localhost/db");
    expect(cfg.max).toBe(1);
    expect(cfg.connectionTimeoutMillis).toBe(20_000);
    expect(cfg.idleTimeoutMillis).toBe(20_000);
    expect(cfg.allowExitOnIdle).toBe(true);
    expect(cfg.keepAlive).toBe(true);
    expect(cfg.keepAliveInitialDelayMillis).toBe(10_000);
    expect(cfg.maxLifetimeSeconds).toBe(300);
  });

  it("respects PG_POOL_MAX when set", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("PG_POOL_MAX", "12");
    const cfg = getPgPoolConfig("postgresql://u:p@localhost/db");
    expect(cfg.max).toBe(12);
  });

  it("uses a higher default max when not on Vercel", () => {
    vi.stubEnv("VERCEL", undefined);
    const cfg = getPgPoolConfig("postgresql://u:p@localhost/db");
    expect(cfg.max).toBe(20);
    expect(cfg.allowExitOnIdle).toBe(false);
    expect(cfg.maxLifetimeSeconds).toBe(0);
  });

  it("respects PG_POOL_MAX_LIFETIME_SECONDS and PG_KEEPALIVE_INITIAL_DELAY_MS", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("PG_POOL_MAX_LIFETIME_SECONDS", "120");
    vi.stubEnv("PG_KEEPALIVE_INITIAL_DELAY_MS", "5000");
    const cfg = getPgPoolConfig("postgresql://u:p@localhost/db");
    expect(cfg.maxLifetimeSeconds).toBe(120);
    expect(cfg.keepAliveInitialDelayMillis).toBe(5000);
  });

  it("respects PG_CONNECTION_TIMEOUT_MS and PG_IDLE_TIMEOUT_MS", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("PG_CONNECTION_TIMEOUT_MS", "25000");
    vi.stubEnv("PG_IDLE_TIMEOUT_MS", "30000");
    const cfg = getPgPoolConfig("postgresql://u:p@localhost/db");
    expect(cfg.connectionTimeoutMillis).toBe(25_000);
    expect(cfg.idleTimeoutMillis).toBe(30_000);
  });
});

describe("getPrismaPgAdapterOptions onPoolError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds a breadcrumb for idle Connection terminated unexpectedly instead of captureException", () => {
    const { onPoolError } = getPrismaPgAdapterOptions();
    onPoolError(new Error("Connection terminated unexpectedly"));
    expect(vi.mocked(Sentry.addBreadcrumb)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
  });

  it("adds a breadcrumb for Connection terminated due to connection timeout instead of captureException", () => {
    const { onPoolError } = getPrismaPgAdapterOptions();
    onPoolError(
      new Error("Connection terminated due to connection timeout"),
    );
    expect(vi.mocked(Sentry.addBreadcrumb)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
  });

  it("calls captureException for unexpected pool errors", () => {
    const { onPoolError } = getPrismaPgAdapterOptions();
    const err = new Error("password authentication failed for user");
    onPoolError(err);
    expect(vi.mocked(Sentry.addBreadcrumb)).not.toHaveBeenCalled();
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(err, {
      tags: { component: "pg-pool" },
    });
  });
});
