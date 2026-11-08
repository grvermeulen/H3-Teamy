import {
  APICallError,
  AISDKError,
  JSONParseError,
  LoadAPIKeyError,
  NoObjectGeneratedError,
  RetryError,
  TypeValidationError,
} from "ai";
import { isGatewayFreeTierAccessError } from "./ai/gatewayModels";

const ALLOWLISTED_REQUEST_ID_HEADERS = [
  "x-request-id",
  "openai-request-id",
  "x-vercel-id",
  "cf-ray",
  "x-amzn-requestid",
] as const;

const MAX_CAUSE_DEPTH = 4;

export type ProviderFailureKind =
  | "auth"
  | "quota"
  | "rate"
  | "timeout"
  | "schema"
  | "parse"
  | "no_object"
  | "transport"
  | "unknown";

export type AllowlistedProviderTelemetry = {
  sdkErrorName: string;
  failureKind: ProviderFailureKind;
  upstreamHttpStatus?: number;
  isRetryable?: boolean;
  providerRequestId?: string;
  causeSdkErrorName?: string;
  finishReason?: string;
  usagePromptTokens?: number;
  usageCompletionTokens?: number;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readProviderRequestId(
  headers: Record<string, string> | undefined,
): string | undefined {
  if (!headers) return undefined;
  for (const key of ALLOWLISTED_REQUEST_ID_HEADERS) {
    const raw = headers[key] ?? headers[key.toLowerCase()];
    if (typeof raw === "string" && raw.length > 0 && raw.length <= 128) {
      return raw;
    }
  }
  return undefined;
}

function boundedTokenCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.min(Math.floor(value), 10_000_000);
}

function failureKindFromStatus(status: number): ProviderFailureKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate";
  if (status === 408 || status === 504) return "timeout";
  if (status === 400 || status === 422) return "schema";
  if (status >= 500) return "transport";
  return "unknown";
}

function classifyErrorInstance(
  error: unknown,
  depth: number,
): AllowlistedProviderTelemetry | null {
  if (depth > MAX_CAUSE_DEPTH || error == null) return null;

  if (isGatewayFreeTierAccessError(error)) {
    return {
      sdkErrorName:
        error instanceof Error ? error.name || "Error" : "GatewayQuotaError",
      failureKind: "quota",
    };
  }

  if (LoadAPIKeyError.isInstance(error)) {
    return {
      sdkErrorName: error.name,
      failureKind: "auth",
      isRetryable: false,
    };
  }

  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    const kind =
      typeof status === "number"
        ? failureKindFromStatus(status)
        : ("unknown" satisfies ProviderFailureKind);
    return {
      sdkErrorName: error.name,
      failureKind: kind,
      upstreamHttpStatus: status,
      isRetryable: error.isRetryable,
      providerRequestId: readProviderRequestId(error.responseHeaders),
    };
  }

  if (NoObjectGeneratedError.isInstance(error)) {
    const usage = error.usage;
    const responseId =
      typeof error.response?.id === "string" && error.response.id.length <= 128
        ? error.response.id
        : undefined;
    return {
      sdkErrorName: error.name,
      failureKind: "no_object",
      finishReason:
        typeof error.finishReason === "string" &&
        error.finishReason.length <= 64
          ? error.finishReason
          : undefined,
      usagePromptTokens: boundedTokenCount(usage?.inputTokens),
      usageCompletionTokens: boundedTokenCount(usage?.outputTokens),
      providerRequestId: responseId,
    };
  }

  if (TypeValidationError.isInstance(error)) {
    return {
      sdkErrorName: error.name,
      failureKind: "schema",
    };
  }

  if (JSONParseError.isInstance(error)) {
    return {
      sdkErrorName: error.name,
      failureKind: "parse",
    };
  }

  if (RetryError.isInstance(error)) {
    const nested = error.errors?.[error.errors.length - 1];
    const fromNested = nested ? classifyErrorInstance(nested, depth + 1) : null;
    if (fromNested) {
      return {
        ...fromNested,
        causeSdkErrorName: error.name,
      };
    }
    return {
      sdkErrorName: error.name,
      failureKind: "transport",
      isRetryable: true,
    };
  }

  if (AISDKError.isInstance(error)) {
    const message = error.message.toLowerCase();
    if (message.includes("time") && message.includes("out")) {
      return { sdkErrorName: error.name, failureKind: "timeout" };
    }
    if (message.includes("unauthenticated")) {
      return { sdkErrorName: error.name, failureKind: "auth" };
    }
    return { sdkErrorName: error.name, failureKind: "unknown" };
  }

  if (error instanceof Error && error.cause != null) {
    const fromCause = classifyErrorInstance(error.cause, depth + 1);
    if (fromCause) {
      return {
        ...fromCause,
        causeSdkErrorName: error.name,
      };
    }
  }

  return null;
}

/**
 * Parseert AI SDK-fouten naar allowlisted telemetrie zonder ruwe berichten of bodies.
 */
export function parseAiSdkFailure(
  error: unknown,
): AllowlistedProviderTelemetry {
  const parsed = classifyErrorInstance(error, 0);
  if (parsed) return parsed;

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes("unauthenticated")) {
      return { sdkErrorName: error.name || "Error", failureKind: "auth" };
    }
    if (message.includes("rate limit")) {
      return { sdkErrorName: error.name || "Error", failureKind: "rate" };
    }
    if (message.includes("timed out") || message.includes("timeout")) {
      return { sdkErrorName: error.name || "Error", failureKind: "timeout" };
    }
    if (message.includes("invalid schema")) {
      return { sdkErrorName: error.name || "Error", failureKind: "schema" };
    }
    return { sdkErrorName: error.name || "Error", failureKind: "unknown" };
  }

  return { sdkErrorName: "UnknownError", failureKind: "unknown" };
}

export function providerTelemetryToErrorClass(
  telemetry: AllowlistedProviderTelemetry,
): string {
  switch (telemetry.failureKind) {
    case "auth":
      return "gateway_unauthenticated";
    case "quota":
      return "gateway_quota_denied";
    case "rate":
      return "provider_rate_limited";
    case "timeout":
      return "provider_timeout";
    case "schema":
      return "provider_schema_rejected";
    case "parse":
      return "provider_parse_failed";
    case "no_object":
      return "provider_no_object";
    case "transport":
      return "provider_transport_error";
    default:
      return "provider_request_failed";
  }
}

const PROVIDER_TELEMETRY_BLOCKLIST_KEYS = new Set([
  "info",
  "rawText",
  "prompt",
  "responseBody",
  "text",
  "value",
  "context",
  "headers",
  "message",
  "body",
  "content",
  "events",
  "result",
  "homeTeam",
  "awayTeam",
  "player",
  "userId",
  "authorId",
  "eventId",
  "filename",
  "fileName",
]);

export function sanitizeReportFlowSentryExtra(
  extra: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extra)) {
    if (PROVIDER_TELEMETRY_BLOCKLIST_KEYS.has(key)) continue;
    if (key === "providerTelemetry" && isObject(value)) {
      out[key] = value;
      continue;
    }
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      out[key] = value;
    }
  }
  return out;
}
