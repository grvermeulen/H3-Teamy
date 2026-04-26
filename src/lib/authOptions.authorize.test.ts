import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "./db";
import { authOptions } from "./authOptions";
import { USER_CORE_SELECT, type UserCoreRow } from "./userPrismaSelect";

vi.mock("./db", () => ({
  prisma: {
    user: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("bcryptjs", () => ({
  default: {
    compare: vi.fn(),
  },
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

describe("Credentials authorize", () => {
  const credentialsProvider = authOptions.providers.find(
    (p) => p.id === "credentials",
  );
  const authorize = credentialsProvider?.options?.authorize;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null on Prisma timeout and reports to Sentry", async () => {
    const err = new Prisma.PrismaClientKnownRequestError("timeout", {
      code: "ETIMEDOUT",
      clientVersion: "7",
    });
    vi.mocked(prisma.user.findFirst).mockRejectedValueOnce(err);

    const result = await authorize?.({
      email: "a@b.nl",
      password: "secret",
    });

    expect(result).toBeNull();
    expect(Sentry.captureException).toHaveBeenCalledWith(err, {
      tags: { context: "credentials_authorize" },
      extra: { prismaCode: "ETIMEDOUT" },
    });
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { email: "a@b.nl" },
      select: USER_CORE_SELECT,
    });
  });

  it("returns user on success", async () => {
    const row: UserCoreRow = {
      id: "u1",
      email: "a@b.nl",
      passwordHash: "$2a$10$hashed",
      firstName: "A",
      lastName: "B",
    };
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(row);

    const bcrypt = await import("bcryptjs");
    vi.mocked(bcrypt.default.compare).mockResolvedValueOnce(true);

    const result = await authorize?.({
      email: "a@b.nl",
      password: "secret",
    });

    expect(result).toEqual({
      id: "u1",
      name: "A B",
      email: "a@b.nl",
    });
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { email: "a@b.nl" },
      select: USER_CORE_SELECT,
    });
  });

  it("returns null on P2022 schema drift and reports to Sentry", async () => {
    const err = new Prisma.PrismaClientKnownRequestError("column missing", {
      code: "P2022",
      clientVersion: "7",
    });
    vi.mocked(prisma.user.findFirst).mockRejectedValueOnce(err);

    const result = await authorize?.({
      email: "a@b.nl",
      password: "secret",
    });

    expect(result).toBeNull();
    expect(Sentry.captureException).toHaveBeenCalledWith(err, {
      tags: { context: "credentials_authorize" },
      extra: { prismaCode: "P2022" },
    });
  });
});
