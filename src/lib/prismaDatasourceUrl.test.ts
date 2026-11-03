import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePrismaDatasourceUrl } from "./prismaDatasourceUrl";

describe("resolvePrismaDatasourceUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers SHARED_PREVIEW_DATABASE_URL over per-deploy PREVIEW_* injection", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv(
      "PREVIEW_POSTGRES_PRISMA_URL",
      "postgresql://bad:bad@ep-withered-cell.neon.tech/neondb",
    );
    vi.stubEnv(
      "SHARED_PREVIEW_DATABASE_URL",
      "postgresql://ok:ok@ep-noisy-pond.neon.tech/neondb",
    );
    expect(resolvePrismaDatasourceUrl()).toBe(
      "postgresql://ok:ok@ep-noisy-pond.neon.tech/neondb",
    );
  });

  it("prefers PREVIEW_POSTGRES_PRISMA_URL on Vercel preview over injected PRISMA_DATABASE_URL", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv(
      "PRISMA_DATABASE_URL",
      "postgresql://bad:bad@ep-empty-base.neon.tech/neondb",
    );
    vi.stubEnv(
      "PREVIEW_POSTGRES_PRISMA_URL",
      "postgresql://ok:ok@ep-noisy-pond.neon.tech/neondb",
    );
    expect(resolvePrismaDatasourceUrl()).toBe(
      "postgresql://ok:ok@ep-noisy-pond.neon.tech/neondb",
    );
  });

  it("uses PRISMA_DATABASE_URL on production even when PREVIEW_* is set", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("PRISMA_DATABASE_URL", "postgresql://prod:prod@db.example/prod");
    vi.stubEnv(
      "PREVIEW_POSTGRES_PRISMA_URL",
      "postgresql://ok:ok@ep-noisy-pond.neon.tech/neondb",
    );
    expect(resolvePrismaDatasourceUrl()).toBe(
      "postgresql://prod:prod@db.example/prod",
    );
  });

  it("falls back to DATABASE_URL when no Prisma URL is set", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("PRISMA_DATABASE_URL", "");
    vi.stubEnv("DATABASE_URL", "postgresql://local/db");
    expect(resolvePrismaDatasourceUrl()).toBe("postgresql://local/db");
  });

  it("returns undefined when no database URL is configured", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("PRISMA_DATABASE_URL", "");
    vi.stubEnv("DATABASE_URL", "");
    expect(resolvePrismaDatasourceUrl()).toBeUndefined();
  });
});
