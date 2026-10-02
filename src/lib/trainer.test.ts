import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

vi.mock("./db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("./prismaConnectRetry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./prismaConnectRetry")>();
  return {
    ...actual,
    withPgConnectRetry: async <T>(
      _operationName: string,
      fn: () => Promise<T>,
    ): Promise<T> => fn(),
  };
});

vi.mock("./activeUser", () => ({
  getActiveUser: vi.fn(),
}));

vi.mock("./kv", () => ({
  getUserRoles: vi.fn(),
}));

describe("trainer permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ADMIN_USER_IDS", "admin-user");
    vi.stubEnv("TRAINER_USER_IDS", "trainer-user");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const mockReq = {} as NextRequest;

  describe("isTrainer", () => {
    it("returns true if user is listed in TRAINER_USER_IDS", async () => {
      vi.mocked(getActiveUser).mockResolvedValue({ userId: "trainer-user" });
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        firstName: "Trainer",
        lastName: "One",
      });
      vi.mocked(getUserRoles).mockResolvedValue({});

      const result = await isTrainer(mockReq);
      expect(result.isTrainer).toBe(true);
      expect(vi.mocked(prisma.user.findUnique)).toHaveBeenCalledWith({
        where: { id: "trainer-user" },
        select: USER_CORE_SELECT,
      });
    });

    it("returns true for bootstrap admin user ids", async () => {
      vi.mocked(getActiveUser).mockResolvedValue({ userId: "admin-user" });
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        firstName: "Super",
        lastName: "Admin",
      });
      vi.mocked(getUserRoles).mockResolvedValue({});

      const result = await isTrainer(mockReq);
      expect(result.isTrainer).toBe(true);
    });

    it("returns true if user has trainer role in KV", async () => {
      vi.mocked(getActiveUser).mockResolvedValue({ userId: "3" });
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        firstName: "Random",
        lastName: "Guy",
      });
      vi.mocked(getUserRoles).mockResolvedValue({ trainer: true });

      const result = await isTrainer(mockReq);
      expect(result.isTrainer).toBe(true);
    });

    it("returns false for regular users", async () => {
      vi.mocked(getActiveUser).mockResolvedValue({ userId: "4" });
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        firstName: "Regular",
        lastName: "Joe",
      });
      vi.mocked(getUserRoles).mockResolvedValue({});

      const result = await isTrainer(mockReq);
      expect(result.isTrainer).toBe(false);
    });

    it("returns false if DB query fails", async () => {
      vi.mocked(getActiveUser).mockResolvedValue({ userId: "5" });
      vi.mocked(prisma.user.findUnique).mockRejectedValue(
        new Error("DB Error"),
      );

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

    it("returns false if getActiveUser fails with unexpected error (reports Sentry)", async () => {
      const err = new Error("onverwachte fout bij sessie");
      vi.mocked(getActiveUser).mockRejectedValueOnce(err);

      const result = await isTrainer(mockReq);
      expect(result.isTrainer).toBe(false);
      expect(result.me).toEqual({ id: "", name: "" });
      expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
        err,
        expect.objectContaining({
          tags: { component: "trainer" },
          extra: expect.objectContaining({
            context: "getActiveUser_isTrainer",
          }),
        }),
      );
    });

    it("returns false if getActiveUser fails with transient DB error without Sentry noise", async () => {
      const connectErr = new Error("timeout exceeded when trying to connect");
      vi.mocked(getActiveUser).mockRejectedValueOnce(connectErr);

      const result = await isTrainer(mockReq);
      expect(result.isTrainer).toBe(false);
      expect(result.me).toEqual({ id: "", name: "" });
      expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
    });

    it("returns false if getActiveUser fails with Prisma upstream message without Sentry noise", async () => {
      vi.mocked(getActiveUser).mockRejectedValueOnce(
        new Error(
          "Failed to connect to upstream database. Please contact Prisma support if the problem persists.",
        ),
      );

      const result = await isTrainer(mockReq);
      expect(result.isTrainer).toBe(false);
      expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
    });

    it("returns false if user load fails with upstream DB error without Sentry noise", async () => {
      vi.mocked(getActiveUser).mockResolvedValue({ userId: "9" });
      vi.mocked(prisma.user.findUnique).mockRejectedValue(
        new Error(
          "Failed to connect to upstream database. Please contact Prisma support if the problem persists.",
        ),
      );

      const result = await isTrainer(mockReq);
      expect(result.isTrainer).toBe(false);
      expect(result.me).toEqual({ id: "9", name: "" });
      expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
    });

    it("does not double-report Sentry when getActiveUser throws DbUnavailableError", async () => {
      vi.mocked(getActiveUser).mockRejectedValueOnce(new DbUnavailableError());
      const result = await isTrainer(mockReq);
      expect(result.isTrainer).toBe(false);
      expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
    });
  });

  describe("isAdminUser", () => {
    it("returns true if user is listed in ADMIN_USER_IDS", async () => {
      vi.mocked(getActiveUser).mockResolvedValue({ userId: "admin-user" });
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        firstName: "Super",
        lastName: "Admin",
      });
      vi.mocked(getUserRoles).mockResolvedValue({});

      const result = await isAdminUser(mockReq);
      expect(result.isAdmin).toBe(true);
    });

    it("returns true if user has admin role in KV", async () => {
      vi.mocked(getActiveUser).mockResolvedValue({ userId: "2" });
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        firstName: "Role",
        lastName: "Admin",
      });
      vi.mocked(getUserRoles).mockResolvedValue({ admin: true });

      const result = await isAdminUser(mockReq);
      expect(result.isAdmin).toBe(true);
    });

    it("returns false if only trainer", async () => {
      vi.mocked(getActiveUser).mockResolvedValue({ userId: "trainer-user" });
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        firstName: "Trainer",
        lastName: "One",
      });
      vi.mocked(getUserRoles).mockResolvedValue({ trainer: true });

      const result = await isAdminUser(mockReq);
      expect(result.isAdmin).toBe(false);
    });

    it("returns false if DB query fails", async () => {
      vi.mocked(getActiveUser).mockResolvedValue({ userId: "5" });
      vi.mocked(prisma.user.findUnique).mockRejectedValue(
        new Error("DB Error"),
      );

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

    it("returns false if getActiveUser fails with unexpected error (reports Sentry)", async () => {
      const err = new Error("onverwachte fout bij sessie");
      vi.mocked(getActiveUser).mockRejectedValueOnce(err);

      const result = await isAdminUser(mockReq);
      expect(result.isAdmin).toBe(false);
      expect(result.me).toEqual({ id: "", name: "" });
      expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
        err,
        expect.objectContaining({
          tags: { component: "trainer" },
          extra: expect.objectContaining({
            context: "getActiveUser_isAdminUser",
          }),
        }),
      );
    });

    it("returns false if getActiveUser fails with transient DB error without Sentry noise", async () => {
      const connectErr = new Error("timeout exceeded when trying to connect");
      vi.mocked(getActiveUser).mockRejectedValueOnce(connectErr);

      const result = await isAdminUser(mockReq);
      expect(result.isAdmin).toBe(false);
      expect(result.me).toEqual({ id: "", name: "" });
      expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
    });

    it("returns false if getActiveUser fails with Prisma upstream message without Sentry noise", async () => {
      vi.mocked(getActiveUser).mockRejectedValueOnce(
        new Error(
          "Failed to connect to upstream database. Please contact Prisma support if the problem persists.",
        ),
      );

      const result = await isAdminUser(mockReq);
      expect(result.isAdmin).toBe(false);
      expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
    });

    it("does not double-report Sentry when getActiveUser throws DbUnavailableError", async () => {
      vi.mocked(getActiveUser).mockRejectedValueOnce(new DbUnavailableError());
      const result = await isAdminUser(mockReq);
      expect(result.isAdmin).toBe(false);
      expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
    });
  });
});
