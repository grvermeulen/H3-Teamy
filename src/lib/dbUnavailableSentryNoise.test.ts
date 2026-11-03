import { describe, expect, it } from "vitest";
import { DbUnavailableError } from "./dbUnavailableError";
import {
  isDbUnavailableSentryNoise,
  shouldDropDbUnavailableErrorForSentry,
} from "./dbUnavailableSentryNoise";

describe("isDbUnavailableSentryNoise", () => {
  it("returns true for DbUnavailableError instances", () => {
    expect(isDbUnavailableSentryNoise(new DbUnavailableError())).toBe(true);
  });

  it("returns true for plain errors with the DbUnavailable name", () => {
    const err = new Error("Database tijdelijk niet beschikbaar");
    err.name = "DbUnavailableError";
    expect(isDbUnavailableSentryNoise(err)).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isDbUnavailableSentryNoise(new Error("boom"))).toBe(false);
  });
});

describe("shouldDropDbUnavailableErrorForSentry", () => {
  const baseEvent = { event_id: "test" } as Parameters<
    typeof shouldDropDbUnavailableErrorForSentry
  >[0];

  it("drops events whose hint carries DbUnavailableError", () => {
    expect(
      shouldDropDbUnavailableErrorForSentry(baseEvent, {
        originalException: new DbUnavailableError(),
      }),
    ).toBe(true);
  });

  it("drops events whose exception type is DbUnavailableError", () => {
    expect(
      shouldDropDbUnavailableErrorForSentry(
        {
          ...baseEvent,
          exception: {
            values: [{ type: "DbUnavailableError", value: "x" }],
          },
        },
        { originalException: null },
      ),
    ).toBe(true);
  });

  it("keeps unrelated server errors", () => {
    expect(
      shouldDropDbUnavailableErrorForSentry(baseEvent, {
        originalException: new Error("unexpected"),
      }),
    ).toBe(false);
  });
});
