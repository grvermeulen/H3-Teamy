import { describe, it, expect, vi, beforeEach } from "vitest";
import { isTrainer, isAdminUser } from "./trainer";
import { prisma } from "./db";
import { getActiveUser } from "./activeUser";
import { getUserRoles } from "./kv";
import { NextRequest } from "next/server";

// Mock dependencies
vi.mock("./db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("./activeUser", () => ({
  getActiveUser: vi.fn(),
}));

vi.mock("./kv", () => ({
  getUserRoles: vi.fn(),
}));

describe("trainer permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_FULL_NAME = "Super Admin";
    process.env.TRAINER_FULL_NAMES = "Trainer One,Trainer Two";
  });

  const mockReq = {} as NextRequest;

  describe("isTrainer", () => {
    it("returns true if user is listed in TRAINER_FULL_NAMES", async () => {
      (getActiveUser as any).mockResolvedValue({ userId: "1" });
      (prisma.user.findUnique as any).mockResolvedValue({
        firstName: "Trainer",
        lastName: "One",
      });
      (getUserRoles as any).mockResolvedValue({});

      const result = await isTrainer(mockReq);
      expect(result.isTrainer).toBe(true);
    });

    it("returns true if user is Admin", async () => {
      (getActiveUser as any).mockResolvedValue({ userId: "2" });
      (prisma.user.findUnique as any).mockResolvedValue({
        firstName: "Super",
        lastName: "Admin",
      });
      (getUserRoles as any).mockResolvedValue({});

      const result = await isTrainer(mockReq);
      expect(result.isTrainer).toBe(true);
    });

    it("returns true if user has trainer role", async () => {
      (getActiveUser as any).mockResolvedValue({ userId: "3" });
      (prisma.user.findUnique as any).mockResolvedValue({
        firstName: "Random",
        lastName: "Guy",
      });
      (getUserRoles as any).mockResolvedValue({ trainer: true });

      const result = await isTrainer(mockReq);
      expect(result.isTrainer).toBe(true);
    });

    it("returns false for regular users", async () => {
      (getActiveUser as any).mockResolvedValue({ userId: "4" });
      (prisma.user.findUnique as any).mockResolvedValue({
        firstName: "Regular",
        lastName: "Joe",
      });
      (getUserRoles as any).mockResolvedValue({});

      const result = await isTrainer(mockReq);
      expect(result.isTrainer).toBe(false);
    });

    it("returns false if DB query fails", async () => {
      (getActiveUser as any).mockResolvedValue({ userId: "5" });
      (prisma.user.findUnique as any).mockRejectedValue(new Error("DB Error"));

      const result = await isTrainer(mockReq);
      expect(result.isTrainer).toBe(false);
      expect(result.me.name).toBe("");
    });
  });

  describe("isAdminUser", () => {
    it("returns true if user matches ADMIN_FULL_NAME", async () => {
      (getActiveUser as any).mockResolvedValue({ userId: "1" });
      (prisma.user.findUnique as any).mockResolvedValue({
        firstName: "Super",
        lastName: "Admin",
      });
      (getUserRoles as any).mockResolvedValue({});

      const result = await isAdminUser(mockReq);
      expect(result.isAdmin).toBe(true);
    });

    it("returns true if user has admin role", async () => {
      (getActiveUser as any).mockResolvedValue({ userId: "2" });
      (prisma.user.findUnique as any).mockResolvedValue({
        firstName: "Role",
        lastName: "Admin",
      });
      (getUserRoles as any).mockResolvedValue({ admin: true });

      const result = await isAdminUser(mockReq);
      expect(result.isAdmin).toBe(true);
    });

    it("returns false if only trainer", async () => {
      (getActiveUser as any).mockResolvedValue({ userId: "3" });
      (prisma.user.findUnique as any).mockResolvedValue({
        firstName: "Trainer",
        lastName: "One",
      });
      (getUserRoles as any).mockResolvedValue({ trainer: true }); // Trainer but not admin

      const result = await isAdminUser(mockReq);
      expect(result.isAdmin).toBe(false);
    });

    it("returns false if DB query fails", async () => {
      (getActiveUser as any).mockResolvedValue({ userId: "5" });
      (prisma.user.findUnique as any).mockRejectedValue(new Error("DB Error"));

      const result = await isAdminUser(mockReq);
      expect(result.isAdmin).toBe(false);
      expect(result.me.name).toBe("");
    });
  });
});
