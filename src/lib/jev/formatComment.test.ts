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
      probabilities: { low: 0.1, medium: 0.47, high: 0.43 },
      confidence: 0.6,
    },
    severity: {
      type: "score",
      score: 0.7,
      legend: { "0": "None", "1": "Minor", "2": "Moderate", "3": "Severe" },
      probabilities: { "0": 0.2, "1": 0.5, "2": 0.2, "3": 0.1 },
      confidence: 0.3,
    },
    security_concern: { type: "noul", noul: 0.21 },
    data_migration_risk: { type: "noul", noul: 0.08 },
    likely_runtime_regression: { type: "noul", noul: 0.15 },
    test_coverage_adequate: { type: "noul", noul: 0.72 },
  },
  usage: { input_tokens: 1200, output_tokens: 40 },
};

describe("formatJevPrComment", () => {
  it("renders Dutch comment with corrected noul and severity labels", () => {
    const body = formatJevPrComment(sampleResponse, ["CI workflows"]);
    expect(body).toContain(JEV_COMMENT_MARKER);
    expect(body).toContain("gemiddeld (kans 47%)");
    expect(body).toContain("Ernst: **Klein**");
    expect(body).toContain("Beveiligingsrisico: nee (kans 79%)");
    expect(body).toContain("Testdekking adequaat: ja (kans 72%)");
    expect(body).toContain("Gevoelige paden: CI workflows");
  });
});

describe("formatJevUnavailableComment", () => {
  it("explains skip reason in Dutch", () => {
    const body = formatJevUnavailableComment("API down");
    expect(body).toContain("JEV niet beschikbaar");
    expect(body).toContain("API down");
  });
});
