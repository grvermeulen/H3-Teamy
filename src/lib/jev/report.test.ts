import { describe, expect, it } from "vitest";
import { computeReportMetrics, formatReportMarkdown } from "./report";
import type { OutcomeRecord, PredictionRecord } from "./types";

function prediction(
  pr: number,
  risk: "low" | "medium" | "high",
  dependabot = false,
): PredictionRecord {
  return {
    pr_number: pr,
    head_sha: `sha-${pr}`,
    base: "image",
    author: dependabot ? "dependabot[bot]" : "human",
    is_dependabot: dependabot,
    title: `PR ${pr}`,
    changed_paths_summary: [],
    sensitive_paths: [],
    jev_answers: {
      risk_level: {
        type: "choice",
        choice: risk,
        probabilities: { low: 0, medium: 0, high: 1 },
        confidence: 0.9,
      },
      security_concern: { type: "noul", noul: risk === "high" ? 0.9 : 0.1 },
    },
    model: "jev-1.13.0",
    usage: { input_tokens: 1, output_tokens: 1 },
    assessed_at: "2026-01-01T00:00:00Z",
    final_before_merge: true,
  };
}

function outcome(pr: number, problem: boolean): OutcomeRecord {
  return {
    pr_number: pr,
    merge_commit_sha: `merge-${pr}`,
    merged_at: "2026-01-02T00:00:00Z",
    labeled_at: "2026-01-09T00:00:00Z",
    had_problem: problem,
    evidence: problem ? { reverted: true } : {},
  };
}

describe("computeReportMetrics", () => {
  it("builds confusion matrix and marks small N", () => {
    const predictions = [
      prediction(1, "high"),
      prediction(2, "low"),
      prediction(3, "low", true),
    ];
    const outcomes = [outcome(1, true), outcome(2, false), outcome(3, false)];
    const metrics = computeReportMetrics(predictions, outcomes, 5);
    expect(metrics.too_small).toBe(true);
    expect(metrics.labeled_pairs).toBe(3);
    expect(metrics.confusion_matrix.high_or_medium.problem).toBe(1);
    expect(metrics.confusion_matrix.low.no_problem).toBe(2);
    expect(metrics.dependabot_split.dependabot.predictions).toBe(1);
  });

  it("computes precision when N is sufficient", () => {
    const predictions = Array.from({ length: 6 }, (_, i) =>
      prediction(i + 1, i % 2 === 0 ? "high" : "low"),
    );
    const outcomes = predictions.map((p, i) =>
      outcome(p.pr_number, i % 2 === 0),
    );
    const metrics = computeReportMetrics(predictions, outcomes, 5);
    expect(metrics.too_small).toBe(false);
    expect(metrics.high_precision).toBeDefined();
  });
});

describe("formatReportMarkdown", () => {
  it("includes confusion matrix table", () => {
    const md = formatReportMarkdown(
      computeReportMetrics([prediction(1, "low")], [outcome(1, false)]),
    );
    expect(md).toContain("Confusion matrix");
    expect(md).toContain("N te klein");
  });
});
