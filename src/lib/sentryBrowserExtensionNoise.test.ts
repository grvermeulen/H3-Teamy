import { describe, expect, it } from "vitest";
import {
  BROWSER_EXTENSION_RUNTIME_SEND_MESSAGE_IGNORE_RE,
  isBrowserExtensionRuntimeSendMessageNoise,
  shouldDropBrowserExtensionNoiseEvent,
} from "./sentryBrowserExtensionNoise";
import type { Event, EventHint } from "@sentry/nextjs";

const baseEvent = {} as Event;
const extensionMessage =
  "Invalid call to runtime.sendMessage(). Tab not found.";

describe("isBrowserExtensionRuntimeSendMessageNoise", () => {
  it("returns true for Chrome extension runtime.sendMessage tab error", () => {
    expect(isBrowserExtensionRuntimeSendMessageNoise(extensionMessage)).toBe(
      true,
    );
  });

  it("returns false for real application errors", () => {
    expect(isBrowserExtensionRuntimeSendMessageNoise("Network request failed")).toBe(
      false,
    );
  });
});

describe("BROWSER_EXTENSION_RUNTIME_SEND_MESSAGE_IGNORE_RE", () => {
  it("matches the production Sentry error message", () => {
    expect(BROWSER_EXTENSION_RUNTIME_SEND_MESSAGE_IGNORE_RE.test(extensionMessage)).toBe(
      true,
    );
  });
});

describe("shouldDropBrowserExtensionNoiseEvent", () => {
  it("returns true for Chrome extension runtime.sendMessage tab error", () => {
    const hint: EventHint = {
      originalException: new Error(extensionMessage),
    };
    expect(shouldDropBrowserExtensionNoiseEvent(baseEvent, hint)).toBe(true);
  });

  it("returns true when only the Sentry event exception value is set", () => {
    const event = {
      exception: { values: [{ value: extensionMessage }] },
    } as Event;
    const hint: EventHint = {};
    expect(shouldDropBrowserExtensionNoiseEvent(event, hint)).toBe(true);
  });

  it("returns true when only event.message is set", () => {
    const event = { message: extensionMessage } as Event;
    const hint: EventHint = {};
    expect(shouldDropBrowserExtensionNoiseEvent(event, hint)).toBe(true);
  });

  it("returns true for plain-object rejection reasons with a message", () => {
    const hint: EventHint = {
      originalException: { message: extensionMessage },
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
