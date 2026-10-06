import { describe, expect, it } from "vitest";
import { formatJevPrComment, formatJevUnavailableComment } from "./formatComment";
import { JEV_COMMENT_MARKER } from "./types";
import type { JevResponse } from "./types";

const sampleResponse: JevResponse = {
  model: "jev-1.13.0",
  answers: {
    risk_level: {
      type: "choice",
      choice: "medium",
      probabilities: { low: 0.1, medium: 0.7, high: 0.2 },
      confidence: 0.6,
    },
    severity: {
      type: "score",
      score: 1.2,
      legend: { "0": "None", "1": "Minor", "2": "Moderate", "3": "Severe" },
      probabilities: { "0": 0, "1": 0.5, "2": 0.4, "3": 0.1 },
      confidence: 0.5,
    },
    security_concern: { type: "noul", noul: 0.8 },
    data_migration_risk: { type: "noul", noul: 0.1 },
    likely_runtime_regression: { type: "noul", noul: 0.6 },
    test_coverage_adequate: { type: "noul", noul: 0.3 },
  },
  usage: { input_tokens: 1200, output_tokens: 40 },
};

describe("formatJevPrComment", () => {
  it("renders Dutch comment with marker and signals", () => {
    const body = formatJevPrComment(sampleResponse, ["auth API"]);
    expect(body).toContain(JEV_COMMENT_MARKER);
    expect(body).toContain("gemiddeld");
    expect(body).toContain("Beveiligingsrisico");
    expect(body).toContain("Gevoelige paden: auth API");
    expect(body).toContain("jev-1.13.0");
  });
});

describe("formatJevUnavailableComment", () => {
  it("explains skip reason in Dutch", () => {
    const body = formatJevUnavailableComment("API down");
    expect(body).toContain("JEV niet beschikbaar");
    expect(body).toContain("API down");
  });
});
