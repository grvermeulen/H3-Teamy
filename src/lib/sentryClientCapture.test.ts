import * as Sentry from "@sentry/nextjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureBrowserException } from "./sentryClientCapture";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

describe("captureBrowserException", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not report Chromium Failed to fetch TypeError", () => {
    captureBrowserException(new TypeError("Failed to fetch"), {
      tags: { area: "arena" },
    });
    expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
  });

  it("reports unexpected application errors", () => {
    const error = new Error("leaderboard responded 500");
    captureBrowserException(error, { tags: { area: "arena" } });
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(error, {
      tags: { area: "arena" },
    });
  });
});
