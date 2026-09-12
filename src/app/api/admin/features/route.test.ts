import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { GET, PATCH } from "./route";
import { isAdminUser } from "@/lib/trainer";
import { getAllFeatureFlags, setFeatureFlag } from "@/lib/featureFlags";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

vi.mock("@/lib/trainer", () => ({
  isAdminUser: vi.fn(),
}));

vi.mock("@/lib/featureFlags", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/featureFlags")>();
  return {
    ...actual,
    getAllFeatureFlags: vi.fn(),
    setFeatureFlag: vi.fn(),
  };
});

const ADMIN = { isAdmin: true, me: { id: "admin-1", name: "Admin" } };
const NON_ADMIN = { isAdmin: false, me: { id: "", name: "" } };

function makeRequest(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new Request(url, init));
}

function patchRequest(body: unknown): NextRequest {
  return makeRequest("http://localhost/api/admin/features", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("admin features route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET", () => {
    it("returns 403 for a non-admin", async () => {
      vi.mocked(isAdminUser).mockResolvedValue(NON_ADMIN);

      const response = await GET(
        makeRequest("http://localhost/api/admin/features"),
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ error: "forbidden" });
      expect(vi.mocked(getAllFeatureFlags)).not.toHaveBeenCalled();
    });

    it("returns the flags for an admin", async () => {
      vi.mocked(isAdminUser).mockResolvedValue(ADMIN);
      vi.mocked(getAllFeatureFlags).mockResolvedValue({
        gtaH3Launcher: false,
      });

      const response = await GET(
        makeRequest("http://localhost/api/admin/features"),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        flags: { gtaH3Launcher: false },
      });
    });
  });

  describe("PATCH", () => {
    it("returns 403 for a non-admin", async () => {
      vi.mocked(isAdminUser).mockResolvedValue(NON_ADMIN);

      const response = await PATCH(
        patchRequest({ key: "gtaH3Launcher", enabled: true }),
      );

      expect(response.status).toBe(403);
      expect(vi.mocked(setFeatureFlag)).not.toHaveBeenCalled();
    });

    it("sets the flag and returns the updated flags", async () => {
      vi.mocked(isAdminUser).mockResolvedValue(ADMIN);
      vi.mocked(setFeatureFlag).mockResolvedValue(undefined);
      vi.mocked(getAllFeatureFlags).mockResolvedValue({
        gtaH3Launcher: true,
      });

      const response = await PATCH(
        patchRequest({ key: "gtaH3Launcher", enabled: true }),
      );

      expect(vi.mocked(setFeatureFlag)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(setFeatureFlag)).toHaveBeenCalledWith(
        "gtaH3Launcher",
        true,
        "admin-1",
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        flags: { gtaH3Launcher: true },
      });
    });

    it("returns 400 on an unknown flag key", async () => {
      vi.mocked(isAdminUser).mockResolvedValue(ADMIN);

      const response = await PATCH(
        patchRequest({ key: "not-a-real-flag", enabled: true }),
      );

      expect(response.status).toBe(400);
      expect(vi.mocked(setFeatureFlag)).not.toHaveBeenCalled();
    });

    it("returns 400 when enabled is not a boolean", async () => {
      vi.mocked(isAdminUser).mockResolvedValue(ADMIN);

      const response = await PATCH(
        patchRequest({ key: "gtaH3Launcher", enabled: "yes" }),
      );

      expect(response.status).toBe(400);
      expect(vi.mocked(setFeatureFlag)).not.toHaveBeenCalled();
    });

    it("returns 500 and reports to Sentry when the write throws", async () => {
      vi.mocked(isAdminUser).mockResolvedValue(ADMIN);
      const error = new Error("kv down");
      vi.mocked(setFeatureFlag).mockRejectedValue(error);

      const response = await PATCH(
        patchRequest({ key: "gtaH3Launcher", enabled: true }),
      );

      expect(response.status).toBe(500);
      expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          tags: { area: "admin", kind: "feature-flag-write" },
        }),
      );
    });
  });
});
