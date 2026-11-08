import { describe, expect, it } from "vitest";
import { shouldCaptureReportExtractProviderForSentry } from "./reportExtractSentryCapture";

describe("shouldCaptureReportExtractProviderForSentry", () => {
  it("skips operational openai_failed traces", () => {
    expect(
      shouldCaptureReportExtractProviderForSentry(
        "openai_failed",
        "provider_timeout",
      ),
    ).toBe(false);
  });

  it("captures misconfiguration", () => {
    expect(
      shouldCaptureReportExtractProviderForSentry(
        "extract_provider_config_invalid",
        "provider_request_failed",
      ),
    ).toBe(true);
  });

  it("captures unexpected failures", () => {
    expect(
      shouldCaptureReportExtractProviderForSentry("failed", "unexpected"),
    ).toBe(true);
  });
});
