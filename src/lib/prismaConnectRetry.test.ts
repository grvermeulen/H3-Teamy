import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import {
  isTransientPostgresConnectError,
  withPgConnectRetry,
} from "./prismaConnectRetry";

vi.mock("@sentry/nextjs", () => ({
  addBreadcrumb: vi.fn(),
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

  it("returns false for unrelated errors", () => {
    expect(isTransientPostgresConnectError(new Error("unique violation"))).toBe(
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
});
