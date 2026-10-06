import { describe, expect, it } from "vitest";
import {
  estimateJevCostUsd,
  extractApiCostUsd,
  getJevPricingConfig,
  JEV_DEFAULT_PRICE_INPUT_PER_MTOK,
  JEV_DEFAULT_PRICE_OUTPUT_PER_MTOK,
  JEV_PRICING_SOURCE_URL,
} from "./pricing";

describe("getJevPricingConfig", () => {
  it("uses defaults from the official rate card", () => {
    const config = getJevPricingConfig({});
    expect(config.inputPerMtok).toBe(JEV_DEFAULT_PRICE_INPUT_PER_MTOK);
    expect(config.outputPerMtok).toBe(JEV_DEFAULT_PRICE_OUTPUT_PER_MTOK);
    expect(config.sourceUrl).toBe(JEV_PRICING_SOURCE_URL);
  });

  it("reads env overrides", () => {
    const config = getJevPricingConfig({
      JEV_PRICE_INPUT_PER_MTOK: "0.05",
      JEV_PRICE_OUTPUT_PER_MTOK: "0.01",
    });
    expect(config.inputPerMtok).toBe(0.05);
    expect(config.outputPerMtok).toBe(0.01);
  });
});

describe("estimateJevCostUsd", () => {
  it("charges input only at $0.042/Mtok by default", () => {
    const cost = estimateJevCostUsd({
      input_tokens: 29_908,
      output_tokens: 135,
    });
    expect(cost).toBeCloseTo(0.001256136, 9);
  });

  it("includes output tokens when priced", () => {
    const cost = estimateJevCostUsd(
      { input_tokens: 1_000_000, output_tokens: 1_000_000 },
      {
        inputPerMtok: 0.042,
        outputPerMtok: 0.01,
        sourceUrl: JEV_PRICING_SOURCE_URL,
        sourceDate: "2026-10-06",
      },
    );
    expect(cost).toBeCloseTo(0.052, 6);
  });
});

describe("extractApiCostUsd", () => {
  it("reads top-level cost_usd", () => {
    expect(extractApiCostUsd({ cost_usd: 0.42 })).toBe(0.42);
  });

  it("reads nested usage.cost", () => {
    expect(
      extractApiCostUsd({ usage: { input_tokens: 1, output_tokens: 1, cost: 0.1 } }),
    ).toBe(0.1);
  });
});
