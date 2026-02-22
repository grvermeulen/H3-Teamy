import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

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
        | "upstream_error"
        | "request_failed";
      details?: string;
    };

type WaapiConfig = {
  baseUrl: string;
  instanceId: string;
  apiToken: string;
  groupChatId: string;
  appUrl: string;
};

const WaapiConfigSchema = z.object({
  WAAPI_BASE_URL: z.string().trim().url().default("https://waapi.app/api/v1"),
  WAAPI_INSTANCE_ID: z.string().trim().min(1),
  WAAPI_API_TOKEN: z.string().trim().min(1),
  WAAPI_GROUP_CHAT_ID: z.string().trim().min(1),
  APP_URL: z.string().trim().url(),
});

function getWaapiConfig(): WaapiConfig | null {
  const parsed = WaapiConfigSchema.safeParse(process.env);
  if (!parsed.success) return null;
  const env = parsed.data;

  return {
    baseUrl: env.WAAPI_BASE_URL.replace(/\/$/, ""),
    instanceId: env.WAAPI_INSTANCE_ID,
    apiToken: env.WAAPI_API_TOKEN,
    groupChatId: env.WAAPI_GROUP_CHAT_ID,
    appUrl: env.APP_URL.replace(/\/$/, ""),
  };
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

  const config = getWaapiConfig();
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
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${config.apiToken}`,
      },
      body: JSON.stringify({
        chatId: config.groupChatId,
        message,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const details = await response.text();
      Sentry.captureException(
        new Error(`WaAPI send-message failed: ${response.status} ${details}`),
      );
      return { sent: false, reason: "upstream_error", details };
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
