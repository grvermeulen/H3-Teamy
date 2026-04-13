import { afterEach, describe, expect, it, vi } from "vitest";
import { getPgPoolConfig } from "./pgPool";

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
