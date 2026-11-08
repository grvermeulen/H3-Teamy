import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { reportWaapiNotificationToSentry } from "./waapiNotificationSentry";

vi.mock("@sentry/nextjs", () => ({
  setTag: vi.fn(),
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
}));

describe("reportWaapiNotificationToSentry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not capture when WaAPI token is rejected (api_unauthenticated)", () => {
    reportWaapiNotificationToSentry({
      sent: false,
      reason: "api_unauthenticated",
      details: "token ongeldig",
    });

    expect(vi.mocked(Sentry.setTag)).toHaveBeenCalledWith(
      "waapi_notification_reason",
      "api_unauthenticated",
    );
    expect(vi.mocked(Sentry.addBreadcrumb)).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "waapi",
        level: "warning",
      }),
    );
    expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
  });

  it("captures unexpected upstream_error notifications", () => {
    reportWaapiNotificationToSentry({
      sent: false,
      reason: "upstream_error",
      details: "HTTP 502",
    });

    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("upstream_error"),
      }),
    );
  });

  it("ignores successful sends", () => {
    reportWaapiNotificationToSentry({ sent: true });
    expect(vi.mocked(Sentry.setTag)).not.toHaveBeenCalled();
  });
});
