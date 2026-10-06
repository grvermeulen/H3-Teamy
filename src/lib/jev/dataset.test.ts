import { describe, expect, it } from "vitest";
import {
  markFinalBeforeMerge,
  parseJsonl,
  serializeJsonl,
  upsertOutcome,
  upsertPrediction,
} from "./dataset";
import type { OutcomeRecord, PredictionRecord } from "./types";

const basePrediction = (
  overrides: Partial<PredictionRecord> = {},
): PredictionRecord => ({
  pr_number: 1,
  head_sha: "abc",
  base: "image",
  author: "dev",
  is_dependabot: false,
  title: "test",
  changed_paths_summary: [],
  sensitive_paths: [],
  jev_answers: {},
  model: "jev-1.13.0",
  usage: { input_tokens: 1, output_tokens: 1 },
  assessed_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

describe("parseJsonl / serializeJsonl", () => {
  it("round-trips records", () => {
    const records = [basePrediction(), basePrediction({ head_sha: "def" })];
    const parsed = parseJsonl<PredictionRecord>(serializeJsonl(records));
    expect(parsed).toHaveLength(2);
  });
});

describe("upsertPrediction", () => {
  it("replaces same head sha", () => {
    const existing = [basePrediction({ assessed_at: "2026-01-01T00:00:00Z" })];
    const updated = upsertPrediction(
      existing,
      basePrediction({ assessed_at: "2026-01-02T00:00:00Z" }),
    );
    expect(updated).toHaveLength(1);
    expect(updated[0].assessed_at).toContain("2026-01-02");
  });
});

describe("markFinalBeforeMerge", () => {
  it("marks latest assessment for pr", () => {
    const preds = [
      basePrediction({ head_sha: "old", assessed_at: "2026-01-01T00:00:00Z" }),
      basePrediction({ head_sha: "new", assessed_at: "2026-01-02T00:00:00Z" }),
    ];
    const marked = markFinalBeforeMerge(preds, 1, "2026-01-03T00:00:00Z");
    const final = marked.find((p) => p.final_before_merge);
    expect(final?.head_sha).toBe("new");
    expect(final?.merged_at).toBe("2026-01-03T00:00:00Z");
  });
});

describe("upsertOutcome", () => {
  it("replaces outcome by pr number", () => {
    const o: OutcomeRecord = {
      pr_number: 5,
      merge_commit_sha: "sha",
      merged_at: "2026-01-01",
      labeled_at: "2026-01-08",
      had_problem: false,
      evidence: {},
    };
    const updated = upsertOutcome([o], { ...o, had_problem: true });
    expect(updated).toHaveLength(1);
    expect(updated[0].had_problem).toBe(true);
  });
});
