import type { ErrorEvent, EventHint } from "@sentry/nextjs";

const EXPECTED_EXTRACT_ERROR_TITLE = "Error: OpenAI request failed";

function isExtractProviderOpenAiFailed(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message === "OpenAI request failed";
}

/**
 * Report-extract provider failures are surfaced to users as HTTP 502 and
 * traced via `report_extract_trace`; they should not open Sentry issues
 * (JAVASCRIPT-NEXTJS-5J).
 */
export function shouldDropReportExtractProviderNoiseForSentry(
  event: ErrorEvent,
  hint: EventHint,
): boolean {
  const moduleTag = event.tags?.module;
  if (moduleTag !== "report_extract") {
    return false;
  }
  if (isExtractProviderOpenAiFailed(hint.originalException)) {
    return true;
  }
  return (
    event.exception?.values?.some(
      (v) => v.type === "Error" && v.value === "OpenAI request failed",
    ) ?? false
  );
}

export function isReportExtractOpenAiFailedSentryIssueTitle(
  title: string,
): boolean {
  return title.trim() === EXPECTED_EXTRACT_ERROR_TITLE;
}
