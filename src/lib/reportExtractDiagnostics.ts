import type { AllowlistedProviderTelemetry } from "./aiSdkFailureTelemetry";
import {
  providerTelemetryToErrorClass,
  sanitizeReportFlowSentryExtra,
} from "./aiSdkFailureTelemetry";
import type { MultipartIngressDiagnostics } from "./multipartIngressDiagnostics";
import {
  reportExtractSupportRef,
  resolveReportExtractAttemptId,
} from "./reportExtractAttemptId";
import { logReportFlowTrace } from "./reportFlowTelemetry";

export type ReportExtractTracePhase =
  | "entry"
  | "multipart_start"
  | "multipart_ok"
  | "multipart_fail"
  | "preprocess_start"
  | "preprocess_ok"
  | "preprocess_fail"
  | "provider_start"
  | "provider_ok"
  | "provider_fail"
  | "completed"
  | "failed";

export type ReportExtractImageMeta = {
  mimeType: string;
  bytes: number;
  width?: number;
  height?: number;
  visionResizePlanned?: boolean;
  outputMimeType?: string;
  outputWidth?: number;
  outputHeight?: number;
  outputBytes?: number;
};

export type ReportExtractTracePayload = {
  event: "report_extract_trace";
  attemptId: string;
  requestId: string;
  vercelRequestId?: string;
  phase: ReportExtractTracePhase;
  outcome?: "success" | "error";
  durationMs?: number;
  stageDurationMs?: number;
  httpStatus?: number;
  errorClass?: string;
  errorCode?: string;
  image?: ReportExtractImageMeta;
  provider?: {
    providerUsed?: string;
    model?: string;
    fallbackUsed?: boolean;
  };
  uploadIngress?: MultipartIngressDiagnostics;
  providerTelemetry?: AllowlistedProviderTelemetry;
  upstreamHttpStatus?: number;
};

export type ReportExtractDiagnosticResponse = {
  attemptId: string;
  /** Zelfde id als attemptId; koppelt aan generate/save. */
  flowId: string;
  requestId: string;
  supportRef: string;
  errorClass?: string;
};

const PROVIDER_INFO_PATTERNS: { pattern: RegExp; errorClass: string }[] = [
  { pattern: /unauthenticated/i, errorClass: "gateway_unauthenticated" },
  { pattern: /time\s*out|timed out/i, errorClass: "provider_timeout" },
  { pattern: /rate limit/i, errorClass: "provider_rate_limited" },
  { pattern: /invalid schema/i, errorClass: "provider_schema_rejected" },
  {
    pattern: /dimension|8000|7800|too large/i,
    errorClass: "image_dimension_rejected",
  },
];

/**
 * Classificeert providerfouten: eerst getypeerde SDK-telemetrie, anders legacy regex op message.
 */
export function classifyExtractProviderFailure(args: {
  info?: unknown;
  providerTelemetry?: AllowlistedProviderTelemetry;
}): string {
  if (args.providerTelemetry) {
    return providerTelemetryToErrorClass(args.providerTelemetry);
  }
  const text = typeof args.info === "string" ? args.info : "";
  if (!text) return "provider_request_failed";
  for (const { pattern, errorClass } of PROVIDER_INFO_PATTERNS) {
    if (pattern.test(text)) return errorClass;
  }
  return "provider_request_failed";
}

export function createReportExtractRequestId(): string {
  return crypto.randomUUID();
}

export function readExtractAttemptFromRequest(
  req: Request,
  requestId: string,
  formAttemptId?: string | null,
): { attemptId: string; vercelRequestId?: string } {
  const attemptId = resolveReportExtractAttemptId(
    req.headers.get("X-Report-Extract-Attempt"),
    formAttemptId ?? null,
  );
  const vercelRequestId = req.headers.get("x-vercel-id")?.trim() || undefined;
  return { attemptId, vercelRequestId };
}

export function logReportExtractTrace(
  payload: ReportExtractTracePayload,
): void {
  console.info(payload.event, payload);
  logReportFlowTrace({
    event: "report_flow_trace",
    flowId: payload.attemptId,
    scope: "extract",
    phase: payload.phase,
    requestId: payload.requestId,
    vercelRequestId: payload.vercelRequestId,
    outcome: payload.outcome,
    durationMs: payload.durationMs,
    stageDurationMs: payload.stageDurationMs,
    appHttpStatus: payload.httpStatus,
    upstreamHttpStatus:
      payload.upstreamHttpStatus ??
      payload.providerTelemetry?.upstreamHttpStatus,
    errorClass: payload.errorClass,
    errorCode: payload.errorCode,
    image: payload.image,
    provider: payload.provider,
    uploadIngress: payload.uploadIngress,
    providerTelemetry: payload.providerTelemetry,
  });
}

export function buildExtractDiagnosticResponse(args: {
  attemptId: string;
  requestId: string;
  errorClass?: string;
}): ReportExtractDiagnosticResponse {
  return {
    attemptId: args.attemptId,
    flowId: args.attemptId,
    requestId: args.requestId,
    supportRef: reportExtractSupportRef(args.attemptId, args.requestId),
    ...(args.errorClass ? { errorClass: args.errorClass } : {}),
  };
}

export function extractDiagnosticResponseHeaders(
  requestId: string,
): Record<string, string> {
  return {
    "X-Report-Extract-Request-Id": requestId,
  };
}

export function sanitizeExtractSentryExtra(
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return sanitizeReportFlowSentryExtra(extra);
}
