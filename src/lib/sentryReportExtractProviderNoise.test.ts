import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";
import {
  isReportExtractOpenAiFailedSentryIssueTitle,
  shouldDropReportExtractProviderNoiseForSentry,
} from "./sentryReportExtractProviderNoise";

describe("shouldDropReportExtractProviderNoiseForSentry", () => {
  it("drops JAVASCRIPT-NEXTJS-5J OpenAI extract provider events", () => {
    const error = new Error("OpenAI request failed");
    const event = {
      tags: { module: "report_extract" },
    } as ErrorEvent;
    expect(
      shouldDropReportExtractProviderNoiseForSentry(event, {
        originalException: error,
      }),
    ).toBe(true);
  });

  it("keeps unrelated OpenAI errors", () => {
    const event = {
      tags: { module: "report_generate" },
    } as ErrorEvent;
    expect(
      shouldDropReportExtractProviderNoiseForSentry(event, {
        originalException: new Error("OpenAI request failed"),
      }),
    ).toBe(false);
  });
});

describe("isReportExtractOpenAiFailedSentryIssueTitle", () => {
  it("matches grouped issue title", () => {
    expect(
      isReportExtractOpenAiFailedSentryIssueTitle(
        "Error: OpenAI request failed",
      ),
    ).toBe(true);
  });
});
