import { describe, expect, it } from "vitest";
import { DbUnavailableError } from "./dbUnavailableError";
import {
  isDbUnavailableSentryNoise,
  shouldDropDbUnavailableErrorForSentry,
} from "./sentryDbUnavailableNoise";

describe("isDbUnavailableSentryNoise", () => {
  it("returns true for DbUnavailableError instances", () => {
    expect(isDbUnavailableSentryNoise(new DbUnavailableError())).toBe(true);
  });

  it("returns true for the default Dutch unavailable message", () => {
    expect(
      isDbUnavailableSentryNoise(
        new Error("Database tijdelijk niet beschikbaar"),
      ),
    ).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isDbUnavailableSentryNoise(new Error("boom"))).toBe(false);
  });
});

describe("shouldDropDbUnavailableErrorForSentry", () => {
  const baseEvent = { event_id: "test" } as Parameters<
    typeof shouldDropDbUnavailableErrorForSentry
  >[0];

  it("drops JAVASCRIPT-NEXTJS-54 DbUnavailableError events", () => {
    expect(
      shouldDropDbUnavailableErrorForSentry(baseEvent, {
        originalException: new DbUnavailableError(),
      }),
    ).toBe(true);
  });

  it("drops when exception type is DbUnavailableError without hint instance", () => {
    expect(
      shouldDropDbUnavailableErrorForSentry(
        {
          ...baseEvent,
          exception: {
            values: [
              {
                type: "DbUnavailableError",
                value: "Database tijdelijk niet beschikbaar",
              },
            ],
          },
        },
        {},
      ),
    ).toBe(true);
  });

  it("keeps unrelated application errors", () => {
    expect(
      shouldDropDbUnavailableErrorForSentry(baseEvent, {
        originalException: new Error("Prisma schema drift"),
      }),
    ).toBe(false);
  });
});
