import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { isTrainer, isAdminUser } from "./trainer";
import { prisma } from "./db";
import { getActiveUser } from "./activeUser";
import { getUserRoles } from "./kv";
import { USER_CORE_SELECT } from "./userPrismaSelect";
import { NextRequest } from "next/server";
import { DbUnavailableError } from "./dbUnavailableError";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

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
      expect(vi.mocked(prisma.user.findUnique)).toHaveBeenCalledWith({
        where: { id: "1" },
        select: USER_CORE_SELECT,
      });
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
      expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          tags: { component: "trainer" },
          extra: expect.objectContaining({ context: "isTrainer", userId: "5" }),
        }),
      );
    });

    it("returns false if getActiveUser fails (e.g. DB connect timeout)", async () => {
      const connectErr = new Error("timeout exceeded when trying to connect");
      vi.mocked(getActiveUser).mockRejectedValueOnce(connectErr);

      const result = await isTrainer(mockReq);
      expect(result.isTrainer).toBe(false);
      expect(result.me).toEqual({ id: "", name: "" });
      expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
        connectErr,
        expect.objectContaining({
          tags: { component: "trainer" },
          extra: expect.objectContaining({ context: "getActiveUser_isTrainer" }),
        }),
      );
    });

    it("does not double-report Sentry when getActiveUser throws DbUnavailableError", async () => {
      vi.mocked(getActiveUser).mockRejectedValueOnce(new DbUnavailableError());
      const result = await isTrainer(mockReq);
      expect(result.isTrainer).toBe(false);
      expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
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
      expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          tags: { component: "trainer" },
          extra: expect.objectContaining({
            context: "isAdminUser",
            userId: "5",
          }),
        }),
      );
    });

    it("returns false if getActiveUser fails (e.g. DB connect timeout)", async () => {
      const connectErr = new Error("timeout exceeded when trying to connect");
      vi.mocked(getActiveUser).mockRejectedValueOnce(connectErr);

      const result = await isAdminUser(mockReq);
      expect(result.isAdmin).toBe(false);
      expect(result.me).toEqual({ id: "", name: "" });
      expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
        connectErr,
        expect.objectContaining({
          tags: { component: "trainer" },
          extra: expect.objectContaining({ context: "getActiveUser_isAdminUser" }),
        }),
      );
    });

    it("does not double-report Sentry when getActiveUser throws DbUnavailableError", async () => {
      vi.mocked(getActiveUser).mockRejectedValueOnce(new DbUnavailableError());
      const result = await isAdminUser(mockReq);
      expect(result.isAdmin).toBe(false);
      expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
    });
  });
});
