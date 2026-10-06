import {
  estimateJevCostUsd,
  extractApiCostUsd,
  getJevPricingConfig,
  type JevPricingConfig,
} from "./pricing";
import type { JevApiCallRecord, JevResponse, JevUsage, PredictionRecord } from "./types";

export interface AssessmentUsage {
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  cost_is_estimate: boolean;
  model: string;
  api_calls: number;
}

/**
 * Aggregates usage across one or more JEV API calls (e.g. token-budget retry).
 * Prefers per-call API-reported cost; otherwise estimates from token counts.
 * @param responses - Successful JEV API responses for a single assessment.
 * @param pricing - Optional pricing override.
 */
export function aggregateJevAssessment(
  responses: readonly JevResponse[],
  pricing?: JevPricingConfig,
): AssessmentUsage {
  if (responses.length === 0) {
    throw new Error("aggregateJevAssessment requires at least one response");
  }

  const rates = pricing ?? getJevPricingConfig();
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let costIsEstimate = false;

  for (const response of responses) {
    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;

    const apiCost =
      response.usage.cost_usd ?? extractApiCostUsd(response);
    if (apiCost !== undefined) {
      costUsd += apiCost;
    } else {
      costUsd += estimateJevCostUsd(response.usage, rates);
      costIsEstimate = true;
    }
  }

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: costUsd,
    cost_is_estimate: costIsEstimate,
    model: responses[responses.length - 1].model,
    api_calls: responses.length,
  };
}

/**
 * Builds per-call records for dataset storage.
 * @param responses - Successful JEV API responses.
 * @param pricing - Optional pricing override.
 */
export function buildApiCallRecords(
  responses: readonly JevResponse[],
  pricing?: JevPricingConfig,
): JevApiCallRecord[] {
  const rates = pricing ?? getJevPricingConfig();
  return responses.map((response) => {
    const apiCost =
      response.usage.cost_usd ?? extractApiCostUsd(response);
    const costUsd =
      apiCost ?? estimateJevCostUsd(response.usage, rates);
    return {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cost_usd: costUsd,
      model: response.model,
    };
  });
}

/**
 * Reads token usage from a prediction, supporting legacy `usage`-only records.
 * @param record - Stored prediction row.
 */
export function getPredictionUsage(record: PredictionRecord): JevUsage {
  return {
    input_tokens: record.input_tokens ?? record.usage.input_tokens,
    output_tokens: record.output_tokens ?? record.usage.output_tokens,
  };
}

/**
 * Reads USD cost from a prediction, estimating from tokens when absent.
 * @param record - Stored prediction row.
 * @param pricing - Optional pricing override.
 */
export function getPredictionCostUsd(
  record: PredictionRecord,
  pricing?: JevPricingConfig,
): number {
  if (typeof record.cost_usd === "number") {
    return record.cost_usd;
  }
  return estimateJevCostUsd(getPredictionUsage(record), pricing);
}

/** Formats a token count with Dutch thousands separators (e.g. 29908 → "29.908"). */
export function formatNlTokenCount(count: number): string {
  return new Intl.NumberFormat("nl-NL", {
    maximumFractionDigits: 0,
  }).format(count);
}

/**
 * Formats a USD amount with Dutch decimal comma (e.g. 0.001256 → "$0,0013").
 * @param amount - USD amount.
 * @param significantDigits - Significant digits to show for small amounts.
 */
export function formatNlCostUsd(amount: number, significantDigits = 4): string {
  if (amount === 0) {
    return "$0,00";
  }

  const abs = Math.abs(amount);
  let fractionDigits = 2;
  if (abs < 0.01) {
    const magnitude = Math.floor(Math.log10(abs));
    fractionDigits = Math.max(2, -magnitude + (significantDigits - 1));
  }

  const formatted = new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(amount);

  return formatted.replace(/\u00A0/g, "");
}

/**
 * Formats the token/cost footer line for the sticky PR comment.
 * @param usage - Aggregated assessment usage.
 */
export function formatAssessmentUsageLine(usage: AssessmentUsage): string {
  const costLabel = usage.cost_is_estimate ? "kosten ≈" : "kosten";
  return [
    `Tokens: ${formatNlTokenCount(usage.input_tokens)} in / ${formatNlTokenCount(usage.output_tokens)} uit`,
    `${costLabel} ${formatNlCostUsd(usage.cost_usd)}`,
  ].join(" · ");
}
