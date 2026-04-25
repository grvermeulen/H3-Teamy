import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { getActiveUsers } from "./userService";
import { prisma } from "../db";
import { kvGetJson, kvSetJson } from "../kv";
import { withPgConnectRetry } from "../prismaConnectRetry";
import { DbUnavailableError } from "../dbUnavailableError";

vi.mock("../db", () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("../kv", () => ({
  kvGetJson: vi.fn(),
  kvSetJson: vi.fn(),
}));

vi.mock("../prismaConnectRetry", () => ({
  withPgConnectRetry: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

describe("userService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(withPgConnectRetry).mockImplementation((_name, fn) => fn());
  });

  describe("getActiveUsers", () => {
    it("returns cached users if available and not refreshing", async () => {
      const cachedUsers = [{ id: "1", name: "Cached User" }];
      vi.mocked(kvGetJson).mockResolvedValue(cachedUsers);

      const result = await getActiveUsers(false);

      expect(result).toEqual(cachedUsers);
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it("fetches from DB if cache is empty", async () => {
      vi.mocked(kvGetJson).mockResolvedValue(null);
      vi.mocked(prisma.user.findMany).mockResolvedValue([
        { id: "1", firstName: "John", lastName: "Doe", email: "j@d.com" },
        { id: "2", firstName: "Jane", lastName: "Doe", email: "j2@d.com" },
      ]);

      const result = await getActiveUsers(false);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("Jane Doe");
      expect(result[1].name).toBe("John Doe");
      expect(kvSetJson).toHaveBeenCalled();
    });

    it("fetches from DB if refresh is true", async () => {
      vi.mocked(kvGetJson).mockResolvedValue([{ id: "1", name: "Cached" }]);
      vi.mocked(prisma.user.findMany).mockResolvedValue([
        { id: "1", firstName: "Fresh", lastName: "User", email: "f@u.com" },
      ]);

      const result = await getActiveUsers(true);

      expect(result[0].name).toBe("Fresh User");
      expect(prisma.user.findMany).toHaveBeenCalled();
    });

    it("deduplicates users by name", async () => {
      vi.mocked(kvGetJson).mockResolvedValue(null);
      vi.mocked(prisma.user.findMany).mockResolvedValue([
        { id: "1", firstName: "John", lastName: "Doe", email: "j@d.com" },
        {
          id: "2",
          firstName: "John",
          lastName: "Doe",
          email: "duplicate@d.com",
        },
      ]);

      const result = await getActiveUsers(false);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("John Doe");
    });

    it("handles DB errors", async () => {
      vi.mocked(kvGetJson).mockResolvedValue(null);
      vi.mocked(prisma.user.findMany).mockRejectedValue(new Error("DB Error"));

      await expect(getActiveUsers(false)).rejects.toThrow("DB Error");
      expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
        expect.any(Error),
      );
    });

    it("does not duplicate Sentry capture for exhausted connect retries", async () => {
      vi.mocked(kvGetJson).mockResolvedValue(null);
      vi.mocked(withPgConnectRetry).mockRejectedValue(new DbUnavailableError());

      await expect(getActiveUsers(false)).rejects.toThrow(DbUnavailableError);
      expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
    });
  });
});
