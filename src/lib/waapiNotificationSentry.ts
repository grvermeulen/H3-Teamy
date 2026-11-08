import * as Sentry from "@sentry/nextjs";
import type { ErrorEvent, EventHint } from "@sentry/nextjs";
import type { NotificationResult } from "@/lib/services/waapiService";

const WAAPI_AUTH_ISSUE_TITLE =
  "Error: WaAPI notification not sent (api_unauthenticated)";

type WaapiNotificationFailureReason =
  | "disabled"
  | "missing_config"
  | "invalid_event_id"
  | "api_unauthenticated"
  | "upstream_error"
  | "request_failed";

function shouldSkipWaapiNotificationSentry(
  reason: WaapiNotificationFailureReason,
): boolean {
  return (
    reason === "disabled" ||
    reason === "missing_config" ||
    reason === "invalid_event_id" ||
    reason === "api_unauthenticated"
  );
}

/**
 * Reports a failed WhatsApp match-report notification to Sentry when it indicates
 * an unexpected failure. Operational outcomes (disabled config, invalid token)
 * are breadcrumb-only so admins rely on the API response instead of new issues.
 */
export function reportWaapiNotificationToSentry(
  result: NotificationResult,
): void {
  if (result.sent) return;

  Sentry.setTag("waapi_notification_reason", result.reason);

  if (shouldSkipWaapiNotificationSentry(result.reason)) {
    if (result.reason === "api_unauthenticated") {
      Sentry.addBreadcrumb({
        category: "waapi",
        level: "warning",
        message: "WaAPI notification not sent (api_unauthenticated)",
        data: result.details ? { details: result.details } : undefined,
      });
    }
    return;
  }

  const details = result.details ? `: ${result.details}` : "";
  Sentry.captureException(
    new Error(`WaAPI notification not sent (${result.reason})${details}`),
  );
}

function isWaapiApiUnauthenticatedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.startsWith(
    "WaAPI notification not sent (api_unauthenticated)",
  );
}

/**
 * Drops legacy/pre-fix events for invalid WaAPI tokens (ops: rotate `WAAPI_API_TOKEN`).
 */
export function shouldDropWaapiNotificationNoiseForSentry(
  event: ErrorEvent,
  hint: EventHint,
): boolean {
  if (event.tags?.waapi_notification_reason === "api_unauthenticated") {
    return true;
  }
  if (isWaapiApiUnauthenticatedError(hint.originalException)) {
    return true;
  }
  return (
    event.exception?.values?.some(
      (v) =>
        v.type === "Error" &&
        typeof v.value === "string" &&
        v.value.startsWith("WaAPI notification not sent (api_unauthenticated)"),
    ) ?? false
  );
}

export function isWaapiApiUnauthenticatedSentryIssueTitle(
  title: string,
): boolean {
  const trimmed = title.trim();
  return (
    trimmed === WAAPI_AUTH_ISSUE_TITLE ||
    trimmed.includes("(api_unauthenticated)")
  );
}
