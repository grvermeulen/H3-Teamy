import { ATTEMPT_ID_PATTERN } from "./reportExtractAttemptIdPattern";

export const REPORT_FLOW_ID_HEADER = "X-Report-Flow-Id";
export const REPORT_EXTRACT_ATTEMPT_HEADER = "X-Report-Extract-Attempt";

/**
 * Flow-id voor extract → generate → save (zelfde uuid-validatie als extract-poging).
 */
export function createReportFlowId(): string {
  return crypto.randomUUID();
}

export function resolveReportFlowId(
  ...candidates: Array<string | null | undefined>
): string {
  for (const raw of candidates) {
    const trimmed = raw?.trim();
    if (trimmed && ATTEMPT_ID_PATTERN.test(trimmed)) {
      return trimmed.toLowerCase();
    }
  }
  return crypto.randomUUID();
}

export function reportFlowSupportRef(
  flowId: string,
  requestId: string,
): string {
  const f = flowId.replace(/-/g, "").slice(0, 8);
  const r = requestId.replace(/-/g, "").slice(0, 8);
  return `${f}-${r}`;
}
