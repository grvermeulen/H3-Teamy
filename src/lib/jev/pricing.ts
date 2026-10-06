import type { JevUsage } from "./types";

/** Official TypeSafe pricing page for jev-1.13.0 (checked 2026-10-06). */
export const JEV_PRICING_SOURCE_URL = "https://docs.typesafe.ai/models";

/** Date the pricing constants below were verified against the source URL. */
export const JEV_PRICING_SOURCE_DATE = "2026-10-06";

/** Default input price: $0.042 per million input tokens ($42 per billion). */
export const JEV_DEFAULT_PRICE_INPUT_PER_MTOK = 0.042;

/** Default output price: output tokens are free on the official rate card. */
export const JEV_DEFAULT_PRICE_OUTPUT_PER_MTOK = 0;

export interface JevPricingConfig {
  inputPerMtok: number;
  outputPerMtok: number;
  sourceUrl: string;
  sourceDate: string;
}

/**
 * Resolves JEV per-million-token pricing from env overrides or defaults.
 * @param env - Optional env map (defaults to `process.env`).
 */
export function getJevPricingConfig(
  env: Record<string, string | undefined> = process.env,
): JevPricingConfig {
  return {
    inputPerMtok: parsePriceEnv(
      env.JEV_PRICE_INPUT_PER_MTOK,
      JEV_DEFAULT_PRICE_INPUT_PER_MTOK,
    ),
    outputPerMtok: parsePriceEnv(
      env.JEV_PRICE_OUTPUT_PER_MTOK,
      JEV_DEFAULT_PRICE_OUTPUT_PER_MTOK,
    ),
    sourceUrl: JEV_PRICING_SOURCE_URL,
    sourceDate: JEV_PRICING_SOURCE_DATE,
  };
}

/**
 * Estimates USD cost from token usage and configured per-Mtok rates.
 * @param usage - Input/output token counts.
 * @param pricing - Optional pricing override (defaults to env-based config).
 */
export function estimateJevCostUsd(
  usage: JevUsage,
  pricing?: JevPricingConfig,
): number {
  const rates = pricing ?? getJevPricingConfig();
  const inputCost =
    (usage.input_tokens / 1_000_000) * rates.inputPerMtok;
  const outputCost =
    (usage.output_tokens / 1_000_000) * rates.outputPerMtok;
  return inputCost + outputCost;
}

/**
 * Extracts a USD cost from a JEV API payload when the service reports one.
 * @param json - Raw API response object.
 */
export function extractApiCostUsd(json: unknown): number | undefined {
  if (!json || typeof json !== "object") {
    return undefined;
  }
  const record = json as Record<string, unknown>;

  const topLevel = pickCost(record);
  if (topLevel !== undefined) {
    return topLevel;
  }

  const usage = record.usage;
  if (usage && typeof usage === "object") {
    return pickCost(usage as Record<string, unknown>);
  }

  return undefined;
}

function pickCost(record: Record<string, unknown>): number | undefined {
  for (const key of ["cost_usd", "cost", "total_cost_usd", "total_cost"]) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function parsePriceEnv(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}
