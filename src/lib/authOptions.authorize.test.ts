import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "./db";
import { authOptions, normalizeAuthEnv } from "./authOptions";
import { createPasskeyExchangeToken } from "./passkeyExchangeToken";
import { USER_CORE_SELECT, type UserCoreRow } from "./userPrismaSelect";
import { DbUnavailableError } from "./dbUnavailableError";
import * as prismaConnectRetry from "./prismaConnectRetry";

vi.mock("./db", () => ({
  prisma: {
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("./prismaConnectRetry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./prismaConnectRetry")>();
  return {
    ...actual,
    withPgConnectRetry: vi.fn(
      async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
    ),
  };
});

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
    vi.mocked(prismaConnectRetry.withPgConnectRetry).mockImplementation(
      async (_name, fn) => fn(),
    );
  });

  it("returns null on transient Prisma connect timeout without reporting to Sentry", async () => {
    const err = new Error("timeout exceeded when trying to connect");
    vi.mocked(prisma.user.findFirst).mockRejectedValueOnce(err);

    const result = await authorize?.({
      email: "a@b.nl",
      password: "secret",
    });

    expect(result).toBeNull();
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { email: "a@b.nl" },
      select: USER_CORE_SELECT,
    });
  });

  it("returns null on DbUnavailableError without reporting to Sentry", async () => {
    vi.mocked(prismaConnectRetry.withPgConnectRetry).mockRejectedValueOnce(
      new DbUnavailableError(),
    );

    const result = await authorize?.({
      email: "a@b.nl",
      password: "secret",
    });

    expect(result).toBeNull();
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it("returns null on non-transient Prisma error and reports to Sentry", async () => {
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

  it("normalizes email casing and whitespace before lookup", async () => {
    const row: UserCoreRow = {
      id: "u1",
      email: "pelsarjen@gmail.com",
      passwordHash: "$2a$10$hashed",
      firstName: "Arjen",
      lastName: "Pels",
    };
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(row);

    const bcrypt = await import("bcryptjs");
    vi.mocked(bcrypt.default.compare).mockResolvedValueOnce(true);

    const result = await authorize?.({
      email: "  Pelsarjen@gmail.com  ",
      password: "secret",
    });

    expect(result).toEqual({
      id: "u1",
      name: "Arjen Pels",
      email: "pelsarjen@gmail.com",
    });
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { email: "pelsarjen@gmail.com" },
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

  describe("passkeyExchange credentials", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("returns user when passkey exchange token is valid", async () => {
      vi.stubEnv("NEXTAUTH_SECRET", "unit-test-secret-passkey");
      const token = createPasskeyExchangeToken("u-pass");
      const row: UserCoreRow = {
        id: "u-pass",
        email: "p@b.nl",
        passwordHash: null,
        firstName: "P",
        lastName: "Q",
      };
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(row);

      const result = await authorize?.({
        passkeyExchange: token,
        email: "",
        password: "",
      });

      expect(result).toEqual({
        id: "u-pass",
        name: "P Q",
        email: "p@b.nl",
      });
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: "u-pass" },
        select: USER_CORE_SELECT,
      });
    });

    it("returns null when passkey exchange token is invalid", async () => {
      vi.stubEnv("NEXTAUTH_SECRET", "unit-test-secret-passkey");
      const result = await authorize?.({
        passkeyExchange: "not-a-valid-token",
        email: "",
        password: "",
      });
      expect(result).toBeNull();
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it("returns null on Prisma error during passkey login and reports to Sentry", async () => {
      vi.stubEnv("NEXTAUTH_SECRET", "unit-test-secret-passkey");
      const token = createPasskeyExchangeToken("u-pass");
      const err = new Prisma.PrismaClientKnownRequestError("boom", {
        code: "P2002",
        clientVersion: "7",
      });
      vi.mocked(prisma.user.findUnique).mockRejectedValueOnce(err);

      const result = await authorize?.({
        passkeyExchange: token,
        email: "",
        password: "",
      });

      expect(result).toBeNull();
      expect(Sentry.captureException).toHaveBeenCalledWith(err, {
        tags: { context: "credentials_authorize_passkey" },
        extra: { prismaCode: "P2002" },
      });
    });
  });
});

describe("normalizeAuthEnv", () => {
  it("removes whitespace accidentally stored around OAuth credentials", () => {
    expect(normalizeAuthEnv("  oauth-client-id\n")).toBe("oauth-client-id");
    expect(normalizeAuthEnv("oauth-secret\r\n")).toBe("oauth-secret");
  });

  it("returns an empty value when the variable is missing", () => {
    expect(normalizeAuthEnv(undefined)).toBe("");
  });
});
