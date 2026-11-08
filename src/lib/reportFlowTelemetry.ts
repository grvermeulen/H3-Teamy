import type { AllowlistedProviderTelemetry } from "./aiSdkFailureTelemetry";
import type { MultipartIngressDiagnostics } from "./multipartIngressDiagnostics";
import type { ReportExtractImageMeta } from "./reportExtractDiagnostics";

export type ReportFlowScope = "client" | "extract" | "generate";

export type ReportFlowInputSummary = {
  hasEventId?: boolean;
  hasMatchTitle?: boolean;
  hasHomeScore?: boolean;
  hasAwayScore?: boolean;
  eventsCount?: number;
  hasFlowId?: boolean;
};

export type ReportFlowPersistenceSummary = {
  outcome: "saved" | "failed" | "skipped";
  category?: "kv" | "unavailable";
};

export type ReportFlowTracePayload = {
  event: "report_flow_trace";
  flowId: string;
  scope: ReportFlowScope;
  phase: string;
  requestId?: string;
  vercelRequestId?: string;
  outcome?: "success" | "error";
  durationMs?: number;
  stageDurationMs?: number;
  appHttpStatus?: number;
  upstreamHttpStatus?: number;
  errorClass?: string;
  errorCode?: string;
  image?: ReportExtractImageMeta;
  provider?: {
    providerUsed?: string;
    model?: string;
    fallbackUsed?: boolean;
  };
  uploadIngress?: MultipartIngressDiagnostics;
  inputSummary?: ReportFlowInputSummary;
  persistence?: ReportFlowPersistenceSummary;
  client?: {
    materializeErrorClass?: string;
    networkKind?: string;
    extractValidationReason?: string;
  };
  providerTelemetry?: AllowlistedProviderTelemetry;
};

export function logReportFlowTrace(payload: ReportFlowTracePayload): void {
  console.info(payload.event, payload);
}

export function createReportFlowRequestId(): string {
  return crypto.randomUUID();
}
