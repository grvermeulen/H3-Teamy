import type { ReportFlowScope } from "./reportFlowTelemetry";
import { logReportFlowTrace } from "./reportFlowTelemetry";

export type ReportFlowClientPhase =
  | "flow_start"
  | "materialize_start"
  | "materialize_ok"
  | "materialize_fail"
  | "extract_request_start"
  | "extract_request_ok"
  | "extract_request_fail"
  | "extract_validation_fail"
  | "generate_request_start"
  | "generate_request_ok"
  | "generate_request_fail"
  | "flow_completed";

/**
 * Clientzijde flow-telemetrie (geen PII); alleen allowlisted velden.
 */
export function logReportFlowClientTrace(args: {
  flowId: string;
  phase: ReportFlowClientPhase;
  outcome?: "success" | "error";
  errorClass?: string;
  httpStatus?: number;
  materializeErrorClass?: string;
  networkKind?: string;
  extractValidationReason?: string;
}): void {
  logReportFlowTrace({
    event: "report_flow_trace",
    flowId: args.flowId,
    scope: "client" satisfies ReportFlowScope,
    phase: args.phase,
    outcome: args.outcome,
    appHttpStatus: args.httpStatus,
    errorClass: args.errorClass,
    client: {
      materializeErrorClass: args.materializeErrorClass,
      networkKind: args.networkKind,
      extractValidationReason: args.extractValidationReason,
    },
  });
}
