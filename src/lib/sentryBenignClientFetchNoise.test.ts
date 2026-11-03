import { describe, expect, it } from "vitest";
import type { Event, EventHint } from "@sentry/nextjs";
import {
  BENIGN_TRANSIENT_CLIENT_FETCH_IGNORE_RE,
  isBenignTransientClientFetchSentryIssueTitle,
  shouldDropBenignClientFetchNoiseEvent,
  shouldDropBenignClientFetchNoiseLog,
} from "./sentryBenignClientFetchNoise";

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

  it("returns true for JAVASCRIPT-NEXTJS-57 preview Failed to fetch title", () => {
    const title =
      "TypeError: Failed to fetch (h3-teamy-85466ns8m-guido-vermeulens-projects.vercel.app)";
    expect(isBenignTransientClientFetchSentryIssueTitle(title)).toBe(true);
    expect(BENIGN_TRANSIENT_CLIENT_FETCH_IGNORE_RE.test(title)).toBe(true);
    expect(
      shouldDropBenignClientFetchNoiseEvent({ message: title } as Event, {}),
    ).toBe(true);
  });

  it("returns true for JAVASCRIPT-NEXTJS-5A preview Failed to fetch title", () => {
    const title =
      "TypeError: Failed to fetch (h3-teamy-mi5xi63um-guido-vermeulens-projects.vercel.app)";
    expect(isBenignTransientClientFetchSentryIssueTitle(title)).toBe(true);
    expect(
      shouldDropBenignClientFetchNoiseEvent({ message: title } as Event, {}),
    ).toBe(true);
  });
});

describe("shouldDropBenignClientFetchNoiseLog", () => {
  it("returns true for console error log with Failed to fetch preview host", () => {
    expect(
      shouldDropBenignClientFetchNoiseLog({
        level: "error",
        message:
          "TypeError: Failed to fetch (h3-teamy-mi5xi63um-guido-vermeulens-projects.vercel.app)",
      }),
    ).toBe(true);
  });

  it("returns false for unrelated application log messages", () => {
    expect(
      shouldDropBenignClientFetchNoiseLog({
        level: "error",
        message: "feedback POST failed: 500",
      }),
    ).toBe(false);
  });
});
