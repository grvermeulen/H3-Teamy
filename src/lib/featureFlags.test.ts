import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { withPgConnectRetry } from "./prismaConnectRetry";
import {
  FEATURE_FLAGS,
  FEATURE_FLAG_DEFAULTS,
  getAllFeatureFlags,
  getFeatureFlag,
  setFeatureFlag,
} from "./featureFlags";

vi.mock("./db", () => ({
  prisma: {
    featureFlag: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("./prismaConnectRetry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./prismaConnectRetry")>();
  return {
    ...actual,
    withPgConnectRetry: vi.fn(),
  };
});

function flagRow(enabled: boolean, updatedBy = "admin-1") {
  return {
    key: FEATURE_FLAGS.gtaH3Launcher,
    enabled,
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedBy,
  };
}

describe("featureFlags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(withPgConnectRetry).mockImplementation((_name, fn) => fn());
  });

  describe("getFeatureFlag", () => {
    it("returns the default when no row is stored", async () => {
      vi.mocked(prisma.featureFlag.findUnique).mockResolvedValue(null);

      await expect(getFeatureFlag("gtaH3Launcher")).resolves.toBe(
        FEATURE_FLAG_DEFAULTS.gtaH3Launcher,
      );
      expect(prisma.featureFlag.findUnique).toHaveBeenCalledWith({
        where: { key: FEATURE_FLAGS.gtaH3Launcher },
      });
      expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
    });

    it("returns true for a stored enabled row", async () => {
      vi.mocked(prisma.featureFlag.findUnique).mockResolvedValue(flagRow(true));

      await expect(getFeatureFlag("gtaH3Launcher")).resolves.toBe(true);
    });

    it("returns false for a stored disabled row", async () => {
      vi.mocked(prisma.featureFlag.findUnique).mockResolvedValue(
        flagRow(false),
      );

      await expect(getFeatureFlag("gtaH3Launcher")).resolves.toBe(false);
    });

    it("falls back to the default and reports to Sentry when the read fails", async () => {
      const error = new Error("db down");
      vi.mocked(prisma.featureFlag.findUnique).mockRejectedValue(error);

      await expect(getFeatureFlag("gtaH3Launcher")).resolves.toBe(
        FEATURE_FLAG_DEFAULTS.gtaH3Launcher,
      );
      expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          tags: { area: "admin", kind: "feature-flag-read" },
        }),
      );
    });

    it("falls back without Sentry when Postgres credentials are invalid", async () => {
      const error = new Prisma.PrismaClientKnownRequestError(
        "Authentication failed against the database server",
        { code: "P1000", clientVersion: "test" },
      );
      vi.mocked(prisma.featureFlag.findUnique).mockRejectedValue(error);

      await expect(getFeatureFlag("gtaH3Launcher")).resolves.toBe(
        FEATURE_FLAG_DEFAULTS.gtaH3Launcher,
      );
      expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
      expect(vi.mocked(Sentry.addBreadcrumb)).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "postgres",
          level: "warning",
        }),
      );
    });

    it("falls back without Sentry when the FeatureFlag table is missing", async () => {
      const error = new Prisma.PrismaClientKnownRequestError(
        "Table does not exist",
        { code: "P2021", clientVersion: "test" },
      );
      vi.mocked(prisma.featureFlag.findUnique).mockRejectedValue(error);

      await expect(getFeatureFlag("gtaH3Launcher")).resolves.toBe(
        FEATURE_FLAG_DEFAULTS.gtaH3Launcher,
      );
      expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
    });
  });

  describe("setFeatureFlag", () => {
    it("upserts the row with enabled/updatedBy", async () => {
      vi.mocked(prisma.featureFlag.upsert).mockResolvedValue(flagRow(true));

      await setFeatureFlag("gtaH3Launcher", true, "admin-1");

      expect(prisma.featureFlag.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.featureFlag.upsert).toHaveBeenCalledWith({
        where: { key: FEATURE_FLAGS.gtaH3Launcher },
        create: {
          key: FEATURE_FLAGS.gtaH3Launcher,
          enabled: true,
          updatedBy: "admin-1",
        },
        update: { enabled: true, updatedBy: "admin-1" },
      });
    });

    it("reports to Sentry and rethrows when the write fails", async () => {
      const error = new Error("db write failed");
      vi.mocked(prisma.featureFlag.upsert).mockRejectedValue(error);

      await expect(
        setFeatureFlag("gtaH3Launcher", true, "admin-1"),
      ).rejects.toThrow("db write failed");
      expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          tags: { area: "admin", kind: "feature-flag-write" },
        }),
      );
    });

    it("rethrows without Sentry when Postgres credentials are invalid", async () => {
      const error = new Prisma.PrismaClientKnownRequestError(
        "Authentication failed against the database server",
        { code: "P1000", clientVersion: "test" },
      );
      vi.mocked(prisma.featureFlag.upsert).mockRejectedValue(error);

      await expect(
        setFeatureFlag("gtaH3Launcher", true, "admin-1"),
      ).rejects.toThrow(error);
      expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
    });
  });

  describe("getAllFeatureFlags", () => {
    it("returns the default for every known flag when nothing is stored", async () => {
      vi.mocked(prisma.featureFlag.findMany).mockResolvedValue([]);

      await expect(getAllFeatureFlags()).resolves.toEqual({
        gtaH3Launcher: FEATURE_FLAG_DEFAULTS.gtaH3Launcher,
      });
    });

    it("returns the stored state for a known flag", async () => {
      vi.mocked(prisma.featureFlag.findMany).mockResolvedValue([flagRow(true)]);

      await expect(getAllFeatureFlags()).resolves.toEqual({
        gtaH3Launcher: true,
      });
    });

    it("falls back to defaults and reports to Sentry when the read fails", async () => {
      const error = new Error("db down");
      vi.mocked(prisma.featureFlag.findMany).mockRejectedValue(error);

      await expect(getAllFeatureFlags()).resolves.toEqual(
        FEATURE_FLAG_DEFAULTS,
      );
      expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          tags: { area: "admin", kind: "feature-flag-read" },
        }),
      );
    });
  });
});
