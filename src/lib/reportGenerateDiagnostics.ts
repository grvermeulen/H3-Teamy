import type { AllowlistedProviderTelemetry } from "./aiSdkFailureTelemetry";
import { providerTelemetryToErrorClass } from "./aiSdkFailureTelemetry";
import {
  reportFlowSupportRef,
  resolveReportFlowId,
} from "./reportFlowCorrelation";
import type {
  ReportFlowInputSummary,
  ReportFlowPersistenceSummary,
} from "./reportFlowTelemetry";
import {
  createReportFlowRequestId,
  logReportFlowTrace,
} from "./reportFlowTelemetry";

export type ReportGenerateTracePhase =
  | "entry"
  | "json_fail"
  | "validate_fail"
  | "input_ok"
  | "ai_start"
  | "ai_ok"
  | "ai_fail"
  | "persist_start"
  | "persist_ok"
  | "persist_fail"
  | "notify"
  | "completed"
  | "failed";

export type ReportGenerateDiagnosticResponse = {
  flowId: string;
  requestId: string;
  supportRef: string;
  errorClass?: string;
};

export function readGenerateFlowFromRequest(
  req: Request,
  bodyFlowId?: string | null,
): { flowId: string; vercelRequestId?: string } {
  const flowId = resolveReportFlowId(
    req.headers.get("X-Report-Flow-Id"),
    req.headers.get("X-Report-Extract-Attempt"),
    bodyFlowId ?? null,
  );
  const vercelRequestId = req.headers.get("x-vercel-id")?.trim() || undefined;
  return { flowId, vercelRequestId };
}

export function buildGenerateDiagnosticResponse(args: {
  flowId: string;
  requestId: string;
  errorClass?: string;
}): ReportGenerateDiagnosticResponse {
  return {
    flowId: args.flowId,
    requestId: args.requestId,
    supportRef: reportFlowSupportRef(args.flowId, args.requestId),
    ...(args.errorClass ? { errorClass: args.errorClass } : {}),
  };
}

export function classifyGenerateAiFailure(
  telemetry?: AllowlistedProviderTelemetry,
): string {
  if (telemetry) {
    return providerTelemetryToErrorClass(telemetry);
  }
  return "provider_request_failed";
}

export function logReportGenerateTrace(args: {
  flowId: string;
  requestId: string;
  vercelRequestId?: string;
  phase: ReportGenerateTracePhase;
  startedAt: number;
  stageStartedAt?: number;
  outcome?: "success" | "error";
  appHttpStatus?: number;
  errorClass?: string;
  errorCode?: string;
  inputSummary?: ReportFlowInputSummary;
  persistence?: ReportFlowPersistenceSummary;
  provider?: { model?: string };
  providerTelemetry?: AllowlistedProviderTelemetry;
}): void {
  logReportFlowTrace({
    event: "report_flow_trace",
    flowId: args.flowId,
    scope: "generate",
    phase: args.phase,
    requestId: args.requestId,
    vercelRequestId: args.vercelRequestId,
    outcome: args.outcome,
    durationMs: Date.now() - args.startedAt,
    stageDurationMs:
      args.stageStartedAt != null
        ? Date.now() - args.stageStartedAt
        : undefined,
    appHttpStatus: args.appHttpStatus,
    upstreamHttpStatus: args.providerTelemetry?.upstreamHttpStatus,
    errorClass: args.errorClass,
    errorCode: args.errorCode,
    inputSummary: args.inputSummary,
    persistence: args.persistence,
    provider: args.provider,
    providerTelemetry: args.providerTelemetry,
  });
}

export { createReportFlowRequestId };
