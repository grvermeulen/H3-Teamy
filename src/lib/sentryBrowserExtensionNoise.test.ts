import { describe, expect, it } from "vitest";
import { shouldDropBrowserExtensionNoiseEvent } from "./sentryBrowserExtensionNoise";
import type { Event, EventHint } from "@sentry/nextjs";

const baseEvent = {} as Event;

describe("shouldDropBrowserExtensionNoiseEvent", () => {
  it("returns true for Chrome extension runtime.sendMessage tab error", () => {
    const hint: EventHint = {
      originalException: new Error(
        "Invalid call to runtime.sendMessage(). Tab not found.",
      ),
    };
    expect(shouldDropBrowserExtensionNoiseEvent(baseEvent, hint)).toBe(true);
  });

  it("returns false for real application errors", () => {
    const hint: EventHint = {
      originalException: new Error("Network request failed"),
    };
    expect(shouldDropBrowserExtensionNoiseEvent(baseEvent, hint)).toBe(false);
  });

  it("returns false when originalException is missing", () => {
    const hint: EventHint = {};
    expect(shouldDropBrowserExtensionNoiseEvent(baseEvent, hint)).toBe(false);
  });
});
