import * as Sentry from "@sentry/nextjs";
import { buildWaapiJsonHeaders, loadWaapiRuntimeConfig } from "@/lib/waapiEnv";
import { classifyWaapiHttpFailure } from "@/lib/waapiUpstreamError";

type MatchReportNotificationInput = {
  eventId: string;
  opponentTeam?: string;
  ourScore?: number;
  opponentScore?: number;
};

type NotificationResult =
  | { sent: true }
  | {
      sent: false;
      reason:
        | "disabled"
        | "missing_config"
        | "invalid_event_id"
        | "api_unauthenticated"
        | "upstream_error"
        | "request_failed";
      details?: string;
    };

/**
 * Normalizes a WhatsApp group JID for WaAPI. Some tools return only the numeric id; WaAPI expects `...@g.us`.
 *
 * @param raw - Value from `WAAPI_GROUP_CHAT_ID`. Empty strings are returned unchanged.
 * @returns Trimmed JID, with `@g.us` appended when the value is digits-only.
 */
export function normalizeWaapiGroupChatId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  if (trimmed.includes("@")) return trimmed;
  if (/^\d+$/.test(trimmed)) return `${trimmed}@g.us`;
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * WaAPI often returns HTTP 200 with a JSON body where `success: false` indicates the message was not sent.
 *
 * @param bodyText - Raw response body from the send-message call.
 * @returns Whether the payload indicates a successful send, or failure details when `success` is explicitly false.
 */
function interpretWaapiSendMessageBody(
  bodyText: string,
): { ok: true } | { ok: false; details: string } {
  const trimmed = bodyText.trim();
  if (!trimmed) return { ok: true };
  try {
    const data = JSON.parse(trimmed) as unknown;
    if (!isRecord(data)) return { ok: true };
    if (data.success === false) {
      const message =
        typeof data.message === "string"
          ? data.message
          : typeof data.error === "string"
            ? data.error
            : trimmed;
      return { ok: false, details: message };
    }
  } catch {
    return { ok: true };
  }
  return { ok: true };
}

function buildMessage(
  input: MatchReportNotificationInput,
  reportUrl: string,
): string {
  const scorePart =
    typeof input.ourScore === "number" &&
    typeof input.opponentScore === "number"
      ? ` (${input.ourScore}-${input.opponentScore})`
      : "";
  const opponentPart = input.opponentTeam ? ` tegen ${input.opponentTeam}` : "";
  return `Wedstrijdverslag van De Rijn Heren 3${opponentPart} staat klaar${scorePart}. Lees het hier: ${reportUrl}`;
}

/**
 * Sends a WhatsApp notification to the configured team group when a match report is generated.
 *
 * @param input - Match metadata used to build a user-friendly WhatsApp message and report deep link. `input.eventId` must be a non-empty non-blank string; otherwise the function immediately returns `{ sent: false, reason: "invalid_event_id" }` and does not send a message.
 * @returns A structured result indicating whether the message was sent or skipped/failed.
 */
export async function sendMatchReportToWhatsAppGroup(
  input: MatchReportNotificationInput,
): Promise<NotificationResult> {
  if (!input.eventId?.trim()) {
    return { sent: false, reason: "invalid_event_id" };
  }

  const enabled = process.env.WAAPI_NOTIFICATIONS_ENABLED === "true";
  if (!enabled) {
    return { sent: false, reason: "disabled" };
  }

  const config = loadWaapiRuntimeConfig();
  if (!config) {
    return { sent: false, reason: "missing_config" };
  }

  const reportUrl = `${config.appUrl}/report/${encodeURIComponent(input.eventId)}`;
  const message = buildMessage(input, reportUrl);
  const endpoint = `${config.baseUrl}/instances/${encodeURIComponent(config.instanceId)}/client/action/send-message`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: buildWaapiJsonHeaders(config.apiToken),
      body: JSON.stringify({
        chatId: normalizeWaapiGroupChatId(config.groupChatId),
        message,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const bodyText = await response.text();
    if (!response.ok) {
      const classified = classifyWaapiHttpFailure(response.status, bodyText);
      return {
        sent: false,
        reason: classified.reason,
        details: classified.details,
      };
    }

    const interpreted = interpretWaapiSendMessageBody(bodyText);
    if (!interpreted.ok) {
      return {
        sent: false,
        reason: "upstream_error",
        details: interpreted.details,
      };
    }

    return { sent: true };
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      const timeoutError = new Error("WaAPI request timed out after 10s");
      Sentry.captureException(timeoutError);
      return {
        sent: false,
        reason: "request_failed",
        details: "timeout",
      };
    }
    Sentry.captureException(error);
    return { sent: false, reason: "request_failed" };
  }
}
