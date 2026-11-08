import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  isTransientPrismaConnectSentryIssueTitle,
  isTransientPrismaConnectSentryNoise,
  shouldDropTransientPrismaConnectNoiseForSentry,
} from "./sentryTransientPrismaConnectNoise";

describe("isTransientPrismaConnectSentryNoise", () => {
  it("returns true for Prisma P1001 (JAVASCRIPT-NEXTJS-58 shape)", () => {
    const err = new Prisma.PrismaClientKnownRequestError("", {
      code: "P1001",
      clientVersion: "7.10.1",
    });
    expect(isTransientPrismaConnectSentryNoise(err)).toBe(true);
  });

  it("returns true for empty-message P1017 (JAVASCRIPT-NEXTJS-55)", () => {
    const err = new Prisma.PrismaClientKnownRequestError("", {
      code: "P1017",
      clientVersion: "7.10.1",
    });
    expect(isTransientPrismaConnectSentryNoise(err)).toBe(true);
  });

  it("returns true for plain-object P1001 (JAVASCRIPT-NEXTJS-59)", () => {
    expect(
      isTransientPrismaConnectSentryNoise({
        name: "PrismaClientKnownRequestError",
        code: "P1001",
      }),
    ).toBe(true);
  });

  it("returns true for connect timeout message errors", () => {
    expect(
      isTransientPrismaConnectSentryNoise(
        new Error("timeout exceeded when trying to connect"),
      ),
    ).toBe(true);
  });

  it("returns false for unrelated Prisma errors", () => {
    const err = new Prisma.PrismaClientKnownRequestError("Unique constraint", {
      code: "P2002",
      clientVersion: "7.10.1",
    });
    expect(isTransientPrismaConnectSentryNoise(err)).toBe(false);
  });
});

describe("shouldDropTransientPrismaConnectNoiseForSentry", () => {
  const baseEvent = { event_id: "test" } as Parameters<
    typeof shouldDropTransientPrismaConnectNoiseForSentry
  >[0];

  it("drops empty-value PrismaClientKnownRequestError when hint has P1001", () => {
    const err = new Prisma.PrismaClientKnownRequestError("", {
      code: "P1001",
      clientVersion: "7.10.1",
    });
    const event = {
      ...baseEvent,
      exception: {
        values: [{ type: "PrismaClientKnownRequestError", value: "" }],
      },
    } as typeof baseEvent;
    expect(
      shouldDropTransientPrismaConnectNoiseForSentry(event, {
        originalException: err,
      }),
    ).toBe(true);
  });

  it("keeps unique constraint violations", () => {
    const err = new Prisma.PrismaClientKnownRequestError("Unique", {
      code: "P2002",
      clientVersion: "7.10.1",
    });
    expect(
      shouldDropTransientPrismaConnectNoiseForSentry(baseEvent, {
        originalException: err,
      }),
    ).toBe(false);
  });

  it("drops serialized empty Prisma error without hint (JAVASCRIPT-NEXTJS-5M)", () => {
    const event = {
      ...baseEvent,
      exception: {
        values: [{ type: "PrismaClientKnownRequestError", value: "" }],
      },
    } as typeof baseEvent;
    expect(shouldDropTransientPrismaConnectNoiseForSentry(event, {})).toBe(
      true,
    );
  });

  it("drops serialized empty Prisma error when extra prismaCode is P1017 (JAVASCRIPT-NEXTJS-59)", () => {
    const event = {
      ...baseEvent,
      extra: { prismaCode: "P1017" },
      exception: {
        values: [{ type: "PrismaClientKnownRequestError", value: "" }],
      },
    } as typeof baseEvent;
    expect(shouldDropTransientPrismaConnectNoiseForSentry(event, {})).toBe(
      true,
    );
  });
});

describe("isTransientPrismaConnectSentryIssueTitle", () => {
  it("matches empty PrismaClientKnownRequestError titles", () => {
    expect(
      isTransientPrismaConnectSentryIssueTitle(
        "PrismaClientKnownRequestError:",
      ),
    ).toBe(true);
  });
});
