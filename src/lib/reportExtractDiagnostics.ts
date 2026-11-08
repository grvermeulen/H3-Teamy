import type { MultipartIngressDiagnostics } from "./multipartIngressDiagnostics";
import {
  reportExtractSupportRef,
  resolveReportExtractAttemptId,
} from "./reportExtractAttemptId";

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
};

export type ReportExtractDiagnosticResponse = {
  attemptId: string;
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
 * Classificeert providerfouten zonder ruwe provider-tekst te loggen of terug te geven.
 */
export function classifyExtractProviderFailure(info: unknown): string {
  const text = typeof info === "string" ? info : "";
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
}

export function buildExtractDiagnosticResponse(args: {
  attemptId: string;
  requestId: string;
  errorClass?: string;
}): ReportExtractDiagnosticResponse {
  return {
    attemptId: args.attemptId,
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
  const out = { ...extra };
  delete out.info;
  delete out.rawText;
  delete out.prompt;
  delete out.responseBody;
  return out;
}
