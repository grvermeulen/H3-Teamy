import { describe, expect, it, afterEach, vi } from "vitest";
import { Prisma } from "@prisma/client";
import type { ErrorEvent, EventHint } from "@sentry/core";
import { shouldDropDevLocalhostDbNoiseForSentry } from "./sentryDevDbNoise";

describe("shouldDropDevLocalhostDbNoiseForSentry", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("drops development P1001 Prisma errors without request URL (NextAuth authorize)", () => {
    vi.stubEnv("NODE_ENV", "development");
    const err = new Prisma.PrismaClientKnownRequestError("unreachable", {
      code: "P1001",
      clientVersion: "7",
    });
    const event: ErrorEvent = {
      environment: "development",
      exception: { values: [{ value: err.message }] },
    };
    const hint: EventHint = { originalException: err };

    expect(shouldDropDevLocalhostDbNoiseForSentry(event, hint)).toBe(true);
  });

  it("does not drop in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const err = new Prisma.PrismaClientKnownRequestError("unreachable", {
      code: "P1001",
      clientVersion: "7",
    });
    const event: ErrorEvent = {
      environment: "development",
      exception: { values: [{ value: err.message }] },
    };
    const hint: EventHint = { originalException: err };

    expect(shouldDropDevLocalhostDbNoiseForSentry(event, hint)).toBe(false);
  });

  it("does not drop P2022 schema errors in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    const err = new Prisma.PrismaClientKnownRequestError("column", {
      code: "P2022",
      clientVersion: "7",
    });
    const event: ErrorEvent = {
      environment: "development",
      exception: { values: [{ value: err.message }] },
    };
    const hint: EventHint = { originalException: err };

    expect(shouldDropDevLocalhostDbNoiseForSentry(event, hint)).toBe(false);
  });

  it("drops message-only P1001-like errors when URL is localhost", () => {
    vi.stubEnv("NODE_ENV", "development");
    const event: ErrorEvent = {
      tags: { environment: "development", url: "http://localhost:3000/api/x" },
      exception: {
        values: [{ value: "Can't reach database server at 127.0.0.1:5432" }],
      },
    };
    const hint: EventHint = { originalException: new Error("x") };

    expect(shouldDropDevLocalhostDbNoiseForSentry(event, hint)).toBe(true);
  });
});
