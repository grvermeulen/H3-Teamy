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

  it("returns true when only event.exception value is set (console logging)", () => {
    const event = {
      exception: { values: [{ value: "Load failed", type: "TypeError" }] },
    } as Event;
    expect(shouldDropBenignClientFetchNoiseEvent(event, {})).toBe(true);
  });

  it("returns true when only event.message is set", () => {
    const event = {
      message: "TypeError: Load failed (heren-3-de-rijn.com)",
    } as Event;
    expect(shouldDropBenignClientFetchNoiseEvent(event, {})).toBe(true);
  });

  it("returns false for real application errors", () => {
    const hint: EventHint = {
      originalException: new Error("feedback POST failed: 500"),
    };
    expect(shouldDropBenignClientFetchNoiseEvent(baseEvent, hint)).toBe(false);
  });

  it("returns false when no fetch noise signals are present", () => {
    const hint: EventHint = {};
    expect(shouldDropBenignClientFetchNoiseEvent(baseEvent, hint)).toBe(false);
  });
});
