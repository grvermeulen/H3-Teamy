import { describe, it, expect, vi, beforeEach } from "vitest";
import { getActiveUsers } from "./userService";
import { prisma } from "../db";
import { kvGetJson, kvSetJson } from "../kv";

// Mock dependencies
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

// Mock Sentry
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

describe("userService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getActiveUsers", () => {
    it("returns cached users if available and not refreshing", async () => {
      const cachedUsers = [{ id: "1", name: "Cached User" }];
      (kvGetJson as any).mockResolvedValue(cachedUsers);

      const result = await getActiveUsers(false);

      expect(result).toEqual(cachedUsers);
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it("fetches from DB if cache is empty", async () => {
      (kvGetJson as any).mockResolvedValue(null);
      (prisma.user.findMany as any).mockResolvedValue([
        { id: "1", firstName: "John", lastName: "Doe", email: "j@d.com" },
        { id: "2", firstName: "Jane", lastName: "Doe", email: "j2@d.com" },
      ]);

      const result = await getActiveUsers(false);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("Jane Doe"); // Sorted alphabetically
      expect(result[1].name).toBe("John Doe");
      expect(kvSetJson).toHaveBeenCalled();
    });

    it("fetches from DB if refresh is true", async () => {
      (kvGetJson as any).mockResolvedValue([{ id: "1", name: "Cached" }]);
      (prisma.user.findMany as any).mockResolvedValue([
        { id: "1", firstName: "Fresh", lastName: "User", email: "f@u.com" },
      ]);

      const result = await getActiveUsers(true);

      expect(result[0].name).toBe("Fresh User");
      expect(prisma.user.findMany).toHaveBeenCalled();
    });

    it("deduplicates users by name", async () => {
      (kvGetJson as any).mockResolvedValue(null);
      (prisma.user.findMany as any).mockResolvedValue([
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
      (kvGetJson as any).mockResolvedValue(null);
      (prisma.user.findMany as any).mockRejectedValue(new Error("DB Error"));

      await expect(getActiveUsers(false)).rejects.toThrow("DB Error");
    });
  });
});
