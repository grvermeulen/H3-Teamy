import { describe, expect, it } from "vitest";
import {
  aggregateJevAssessment,
  buildApiCallRecords,
  formatAssessmentUsageLine,
  formatNlCostUsd,
  formatNlTokenCount,
  getPredictionCostUsd,
  getPredictionUsage,
} from "./usage";
import type { JevResponse, PredictionRecord } from "./types";

const response = (
  input: number,
  output: number,
  costUsd?: number,
): JevResponse => ({
  model: "jev-1.13.0",
  answers: {},
  usage: { input_tokens: input, output_tokens: output, cost_usd: costUsd },
});

describe("aggregateJevAssessment", () => {
  it("sums tokens across retry calls", () => {
    const summary = aggregateJevAssessment([
      response(20_000, 100),
      response(9_908, 35),
    ]);
    expect(summary.input_tokens).toBe(29_908);
    expect(summary.output_tokens).toBe(135);
    expect(summary.api_calls).toBe(2);
    expect(summary.cost_is_estimate).toBe(true);
    expect(summary.cost_usd).toBeCloseTo(0.001256136, 9);
  });

  it("prefers API-reported cost over estimates", () => {
    const summary = aggregateJevAssessment([response(1000, 10, 0.0005)]);
    expect(summary.cost_usd).toBe(0.0005);
    expect(summary.cost_is_estimate).toBe(false);
  });
});

describe("buildApiCallRecords", () => {
  it("stores one record per API call", () => {
    const records = buildApiCallRecords([
      response(100, 1),
      response(200, 2),
    ]);
    expect(records).toHaveLength(2);
    expect(records[0].input_tokens).toBe(100);
    expect(records[1].model).toBe("jev-1.13.0");
  });
});

describe("getPredictionUsage", () => {
  it("reads legacy usage-only records", () => {
    const record: PredictionRecord = {
      pr_number: 1,
      head_sha: "abc",
      base: "image",
      author: "dev",
      is_dependabot: false,
      title: "t",
      changed_paths_summary: [],
      sensitive_paths: [],
      jev_answers: {},
      model: "jev-1.13.0",
      usage: { input_tokens: 500, output_tokens: 20 },
      assessed_at: "2026-01-01T00:00:00Z",
    };
    expect(getPredictionUsage(record)).toEqual({
      input_tokens: 500,
      output_tokens: 20,
    });
  });

  it("prefers top-level token fields on newer records", () => {
    const record: PredictionRecord = {
      pr_number: 1,
      head_sha: "abc",
      base: "image",
      author: "dev",
      is_dependabot: false,
      title: "t",
      changed_paths_summary: [],
      sensitive_paths: [],
      jev_answers: {},
      model: "jev-1.13.0",
      usage: { input_tokens: 1, output_tokens: 1 },
      input_tokens: 900,
      output_tokens: 30,
      cost_usd: 0.01,
      assessed_at: "2026-01-01T00:00:00Z",
    };
    expect(getPredictionUsage(record).input_tokens).toBe(900);
    expect(getPredictionCostUsd(record)).toBe(0.01);
  });
});

describe("formatting", () => {
  it("formats Dutch token counts and costs", () => {
    expect(formatNlTokenCount(29_908)).toBe("29.908");
    expect(formatNlCostUsd(0.001256136)).toContain("0,001");
    expect(formatAssessmentUsageLine({
      input_tokens: 29_908,
      output_tokens: 135,
      cost_usd: 0.001256136,
      cost_is_estimate: true,
      model: "jev-1.13.0",
      api_calls: 1,
    })).toContain("Tokens: 29.908 in / 135 uit");
  });
});
