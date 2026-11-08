import { describe, expect, it } from "vitest";
import type { ErrorEvent, EventHint } from "@sentry/nextjs";
import {
  isWaapiApiUnauthenticatedSentryIssueTitle,
  shouldDropWaapiNotificationNoiseForSentry,
} from "./waapiNotificationSentry";

describe("shouldDropWaapiNotificationNoiseForSentry", () => {
  const baseEvent = {} as ErrorEvent;
  const baseHint = {} as EventHint;

  it("drops events tagged with api_unauthenticated", () => {
    const event = {
      ...baseEvent,
      tags: { waapi_notification_reason: "api_unauthenticated" },
    } as ErrorEvent;
    expect(shouldDropWaapiNotificationNoiseForSentry(event, baseHint)).toBe(
      true,
    );
  });

  it("drops events whose exception message matches api_unauthenticated", () => {
    const hint: EventHint = {
      originalException: new Error(
        "WaAPI notification not sent (api_unauthenticated): token",
      ),
    };
    expect(shouldDropWaapiNotificationNoiseForSentry(baseEvent, hint)).toBe(
      true,
    );
  });

  it("keeps upstream_error WaAPI notification failures", () => {
    const hint: EventHint = {
      originalException: new Error(
        "WaAPI notification not sent (upstream_error): timeout",
      ),
    };
    expect(shouldDropWaapiNotificationNoiseForSentry(baseEvent, hint)).toBe(
      false,
    );
  });
});

describe("isWaapiApiUnauthenticatedSentryIssueTitle", () => {
  it("matches JAVASCRIPT-NEXTJS-5K style titles", () => {
    expect(
      isWaapiApiUnauthenticatedSentryIssueTitle(
        "Error: WaAPI notification not sent (api_unauthenticated): WaAPI API-token is ongeldig",
      ),
    ).toBe(true);
  });

  it("does not match upstream errors", () => {
    expect(
      isWaapiApiUnauthenticatedSentryIssueTitle(
        "Error: WaAPI notification not sent (upstream_error)",
      ),
    ).toBe(false);
  });
});
