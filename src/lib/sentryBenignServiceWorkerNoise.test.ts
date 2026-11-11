import type { Event, EventHint } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import {
  isBenignServiceWorkerSentryIssueTitle,
  shouldDropBenignServiceWorkerNoiseEvent,
} from "./sentryBenignServiceWorkerNoise";

describe("shouldDropBenignServiceWorkerNoiseEvent", () => {
  const baseEvent = { exception: { values: [{ value: "" }] } } as Event;

  it("drops WebKit sw.js load failed events", () => {
    const error = new TypeError(
      "Script https://heren-3-de-rijn.com/sw.js load failed",
    );
    const hint: EventHint = { originalException: error };
    expect(shouldDropBenignServiceWorkerNoiseEvent(baseEvent, hint)).toBe(true);
  });

  it("keeps unrelated errors", () => {
    const hint: EventHint = {
      originalException: new Error("registration blocked"),
    };
    expect(shouldDropBenignServiceWorkerNoiseEvent(baseEvent, hint)).toBe(
      false,
    );
  });
});

describe("isBenignServiceWorkerSentryIssueTitle", () => {
  it("matches JAVASCRIPT-NEXTJS-5N title", () => {
    expect(
      isBenignServiceWorkerSentryIssueTitle(
        "TypeError: Script https://heren-3-de-rijn.com/sw.js load failed",
      ),
    ).toBe(true);
  });
});
