import { describe, expect, it } from "vitest";
import type { Event, EventHint } from "@sentry/nextjs";
import { shouldDropBenignClientFetchNoiseEvent } from "./sentryBenignClientFetchNoise";

const baseEvent = {} as Event;

describe("shouldDropBenignClientFetchNoiseEvent", () => {
  it("returns true for DOMException NetworkError", () => {
    const hint: EventHint = {
      originalException: new DOMException(
        "A network error occurred.",
        "NetworkError",
      ),
    };
    expect(shouldDropBenignClientFetchNoiseEvent(baseEvent, hint)).toBe(true);
  });

  it("returns true for Firefox fetch TypeError", () => {
    const hint: EventHint = {
      originalException: new TypeError(
        "NetworkError when attempting to fetch resource.",
      ),
    };
    expect(shouldDropBenignClientFetchNoiseEvent(baseEvent, hint)).toBe(true);
  });

  it("returns false for real application errors", () => {
    const hint: EventHint = {
      originalException: new Error("feedback POST failed: 500"),
    };
    expect(shouldDropBenignClientFetchNoiseEvent(baseEvent, hint)).toBe(false);
  });

  it("returns false when originalException is missing", () => {
    const hint: EventHint = {};
    expect(shouldDropBenignClientFetchNoiseEvent(baseEvent, hint)).toBe(false);
  });
});
