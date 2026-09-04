import { describe, expect, it } from "vitest";
import type { ErrorEvent, EventHint } from "@sentry/nextjs";
import { shouldDropInvalidMultipartBodyNoiseForSentry } from "./sentryInvalidMultipartBodyNoise";

describe("shouldDropInvalidMultipartBodyNoiseForSentry", () => {
  const baseEvent = {} as ErrorEvent;

  it("drops known invalid multipart body parse errors", () => {
    const hint = {
      originalException: new TypeError("Failed to parse body as FormData."),
    } as EventHint;

    expect(
      shouldDropInvalidMultipartBodyNoiseForSentry(baseEvent, hint),
    ).toBe(true);
  });

  it("keeps unrelated server errors", () => {
    const hint = {
      originalException: new Error("database unavailable"),
    } as EventHint;

    expect(
      shouldDropInvalidMultipartBodyNoiseForSentry(baseEvent, hint),
    ).toBe(false);
  });
});
