import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";

const { kvGetJson, kvSetJson } = vi.hoisted(() => ({
  kvGetJson: vi.fn(),
  kvSetJson: vi.fn(),
}));

vi.mock("./kv", () => ({ kvGetJson, kvSetJson }));

import {
  FEATURE_FLAGS,
  FEATURE_FLAG_DEFAULTS,
  getAllFeatureFlags,
  getFeatureFlag,
  setFeatureFlag,
} from "./featureFlags";

describe("featureFlags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getFeatureFlag", () => {
    it("returns the default when nothing is stored", async () => {
      kvGetJson.mockResolvedValue(null);

      await expect(getFeatureFlag("gtaH3Launcher")).resolves.toBe(
        FEATURE_FLAG_DEFAULTS.gtaH3Launcher,
      );
      expect(kvGetJson).toHaveBeenCalledWith(FEATURE_FLAGS.gtaH3Launcher);
      expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
    });

    it("returns true for a stored enabled flag", async () => {
      kvGetJson.mockResolvedValue({
        enabled: true,
        updatedAt: "2026-01-01T00:00:00.000Z",
        updatedBy: "admin-1",
      });

      await expect(getFeatureFlag("gtaH3Launcher")).resolves.toBe(true);
    });

    it("returns false for a stored disabled flag", async () => {
      kvGetJson.mockResolvedValue({
        enabled: false,
        updatedAt: "2026-01-01T00:00:00.000Z",
        updatedBy: "admin-1",
      });

      await expect(getFeatureFlag("gtaH3Launcher")).resolves.toBe(false);
    });

    it("falls back to the default and reports to Sentry on an invalid stored shape", async () => {
      kvGetJson.mockResolvedValue({ enabled: "yes" });

      await expect(getFeatureFlag("gtaH3Launcher")).resolves.toBe(
        FEATURE_FLAG_DEFAULTS.gtaH3Launcher,
      );
      expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          tags: { area: "admin", kind: "feature-flag-read" },
        }),
      );
    });

    it("falls back to the default and reports to Sentry when the read rejects", async () => {
      const error = new Error("kv down");
      kvGetJson.mockRejectedValue(error);

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
  });

  describe("setFeatureFlag", () => {
    it("writes the flag with enabled/updatedAt/updatedBy", async () => {
      kvSetJson.mockResolvedValue(undefined);

      await setFeatureFlag("gtaH3Launcher", true, "admin-1");

      expect(kvSetJson).toHaveBeenCalledTimes(1);
      const [key, value] = kvSetJson.mock.calls[0] as [string, unknown];
      expect(key).toBe(FEATURE_FLAGS.gtaH3Launcher);
      expect(value).toEqual(
        expect.objectContaining({
          enabled: true,
          updatedBy: "admin-1",
          updatedAt: expect.any(String),
        }),
      );
    });

    it("reports to Sentry and rethrows when the write fails", async () => {
      const error = new Error("kv write failed");
      kvSetJson.mockRejectedValue(error);

      await expect(
        setFeatureFlag("gtaH3Launcher", true, "admin-1"),
      ).rejects.toThrow("kv write failed");
      expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          tags: { area: "admin", kind: "feature-flag-write" },
        }),
      );
    });
  });

  describe("getAllFeatureFlags", () => {
    it("returns the state of every known flag", async () => {
      kvGetJson.mockResolvedValue(null);

      await expect(getAllFeatureFlags()).resolves.toEqual({
        gtaH3Launcher: FEATURE_FLAG_DEFAULTS.gtaH3Launcher,
      });
    });
  });
});
