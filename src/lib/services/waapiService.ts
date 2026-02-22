import * as Sentry from "@sentry/nextjs";

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

function getWaapiConfig(): WaapiConfig | null {
  const baseUrl = (
    process.env.WAAPI_BASE_URL || "https://waapi.app/api/v1"
  ).trim();
  const instanceId = (process.env.WAAPI_INSTANCE_ID || "").trim();
  const apiToken = (process.env.WAAPI_API_TOKEN || "").trim();
  const groupChatId = (process.env.WAAPI_GROUP_CHAT_ID || "").trim();
  const appUrl = (process.env.APP_URL || "").trim().replace(/\/$/, "");
  const enabled = process.env.WAAPI_NOTIFICATIONS_ENABLED === "true";

  if (!enabled) return null;
  if (!instanceId || !apiToken || !groupChatId || !appUrl) return null;

  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    instanceId,
    apiToken,
    groupChatId,
    appUrl,
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
 * @param input - Match metadata used to build a user-friendly WhatsApp message and report deep link.
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
    });

    if (!response.ok) {
      const details = await response.text();
      Sentry.captureException(
        new Error(`WaAPI send-message failed: ${response.status} ${details}`),
      );
      return { sent: false, reason: "upstream_error", details };
    }

    return { sent: true };
  } catch (error: unknown) {
    Sentry.captureException(error);
    return { sent: false, reason: "request_failed" };
  }
}
