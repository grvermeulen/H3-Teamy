import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import {
  isPrismaCredentialError,
  isTransientPostgresConnectError,
  shouldFallbackFromPrismaToKv,
  withPgConnectRetry,
} from "./prismaConnectRetry";
import { DbUnavailableError } from "./dbUnavailableError";

vi.mock("@sentry/nextjs", () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
}));

describe("isTransientPostgresConnectError", () => {
  it("returns true for Prisma P1001", () => {
    const err = new Prisma.PrismaClientKnownRequestError("x", {
      code: "P1001",
      clientVersion: "test",
    });
    expect(isTransientPostgresConnectError(err)).toBe(true);
  });

  it("returns true for pg-style timeout message", () => {
    expect(
      isTransientPostgresConnectError(
        new Error("timeout exceeded when trying to connect"),
      ),
    ).toBe(true);
  });

  it("returns true for Prisma/pg connection terminated message", () => {
    expect(
      isTransientPostgresConnectError(
        new Error("Connection terminated unexpectedly"),
      ),
    ).toBe(true);
  });

  it("returns true for Prisma adapter upstream database message (JAVASCRIPT-NEXTJS-1M)", () => {
    expect(
      isTransientPostgresConnectError(
        new Error(
          "Failed to connect to upstream database. Please contact Prisma support if the problem persists.",
        ),
      ),
    ).toBe(true);
  });

  it("returns true for Prisma Postgres proxy auth handshake noise (JAVASCRIPT-NEXTJS-3A)", () => {
    expect(
      isTransientPostgresConnectError(
        new Error("Error while reading client PasswordMessage"),
      ),
    ).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isTransientPostgresConnectError(new Error("unique violation"))).toBe(
      false,
    );
  });
});

describe("isPrismaCredentialError", () => {
  it("returns true for Prisma P1000", () => {
    const err = new Prisma.PrismaClientKnownRequestError("auth failed", {
      code: "P1000",
      clientVersion: "test",
    });
    expect(isPrismaCredentialError(err)).toBe(true);
  });

  it("returns true for authentication failed message", () => {
    expect(
      isPrismaCredentialError(
        new Error(
          "Authentication failed against the database server, the provided database credentials for `(not available)` are not valid",
        ),
      ),
    ).toBe(true);
  });
});

describe("shouldFallbackFromPrismaToKv", () => {
  it("returns true for credential, transient, and DbUnavailable errors", () => {
    expect(
      shouldFallbackFromPrismaToKv(
        new Prisma.PrismaClientKnownRequestError("x", {
          code: "P1000",
          clientVersion: "test",
        }),
      ),
    ).toBe(true);
    expect(
      shouldFallbackFromPrismaToKv(
        new Prisma.PrismaClientKnownRequestError("x", {
          code: "P1001",
          clientVersion: "test",
        }),
      ),
    ).toBe(true);
    expect(shouldFallbackFromPrismaToKv(new DbUnavailableError())).toBe(true);
    expect(shouldFallbackFromPrismaToKv(new Error("unique violation"))).toBe(
      false,
    );
  });
});

describe("withPgConnectRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("returns immediately on success", async () => {
    const fn = vi.fn().mockResolvedValue(42);
    await expect(withPgConnectRetry("op", fn)).resolves.toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Sentry.addBreadcrumb)).not.toHaveBeenCalled();
  });

  it("retries on transient connection errors then succeeds", async () => {
    let attempt = 0;
    const fn = vi.fn().mockImplementation(() => {
      attempt += 1;
      if (attempt < 4) {
        return Promise.reject(
          new Error("timeout exceeded when trying to connect"),
        );
      }
      return Promise.resolve("ok");
    });
    const promise = withPgConnectRetry("listEventRsvps", fn);
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(4);
    expect(vi.mocked(Sentry.addBreadcrumb)).toHaveBeenCalled();
  });

  it("does not retry on non-transient errors", async () => {
    const err = new Error("permanent");
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withPgConnectRetry("op", fn)).rejects.toThrow("permanent");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("after max attempts on P1001 adds breadcrumb and throws DbUnavailableError", async () => {
    const prismaErr = new Prisma.PrismaClientKnownRequestError("unreachable", {
      code: "P1001",
      clientVersion: "test",
    });
    const fn = vi.fn().mockRejectedValue(prismaErr);
    const settled = withPgConnectRetry("getActiveUser", fn).then(
      () => ({ ok: true as const }),
      (e: unknown) => ({ ok: false as const, e }),
    );
    await vi.runAllTimersAsync();
    const out = await settled;
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.e).toBeInstanceOf(DbUnavailableError);
    expect(fn).toHaveBeenCalledTimes(4);
    expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
    expect(vi.mocked(Sentry.addBreadcrumb)).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "postgres",
        data: expect.objectContaining({
          operationName: "getActiveUser",
          exhaustedRetries: true,
        }),
      }),
    );
  });
});
