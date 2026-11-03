import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { DbUnavailableError } from "./dbUnavailableError";
import { shouldCaptureApiRouteException } from "./sentryApiRouteCapture";

describe("shouldCaptureApiRouteException", () => {
  it("returns false for DbUnavailableError", () => {
    expect(shouldCaptureApiRouteException(new DbUnavailableError())).toBe(
      false,
    );
  });

  it("returns false for transient Prisma connect errors", () => {
    const err = new Prisma.PrismaClientKnownRequestError("", {
      code: "P1001",
      clientVersion: "7.10.1",
    });
    expect(shouldCaptureApiRouteException(err)).toBe(false);
  });

  it("returns true for unrelated errors", () => {
    expect(shouldCaptureApiRouteException(new Error("unexpected"))).toBe(true);
  });
});
