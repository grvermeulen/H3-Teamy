import { describe, expect, it } from "vitest";
import {
  formatNoulAnswer,
  formatNoulFlagLine,
  formatSeverityAnswer,
  isNoulYes,
} from "./formatAnswers";
import type { JevScoreAnswer } from "./types";

describe("formatNoulAnswer", () => {
  it("shows ja with P(true) when noul >= 0.5", () => {
    expect(formatNoulAnswer({ type: "noul", noul: 0.72 })).toBe(
      "ja (kans 72%)",
    );
  });

  it("shows nee with P(false) when noul < 0.5", () => {
    expect(formatNoulAnswer({ type: "noul", noul: 0.21 })).toBe(
      "nee (kans 79%)",
    );
  });
});

describe("formatNoulFlagLine", () => {
  it("prefixes label for test coverage adequate", () => {
    expect(
      formatNoulFlagLine("Testdekking adequaat", { type: "noul", noul: 0.72 }),
    ).toBe("Testdekking adequaat: ja (kans 72%)");
  });
});

describe("formatSeverityAnswer", () => {
  it("maps score 0.70 to Klein (Minor)", () => {
    const answer: JevScoreAnswer = {
      type: "score",
      score: 0.7,
      legend: { "0": "None", "1": "Minor", "2": "Moderate", "3": "Severe" },
      probabilities: { "0": 0.2, "1": 0.6, "2": 0.15, "3": 0.05 },
      confidence: 0.3,
    };
    expect(formatSeverityAnswer(answer)).toContain("**Klein**");
    expect(formatSeverityAnswer(answer)).toContain("score 0.70");
  });
});

describe("isNoulYes", () => {
  it("returns true at 0.5 threshold", () => {
    expect(isNoulYes({ type: "noul", noul: 0.5 })).toBe(true);
    expect(isNoulYes({ type: "noul", noul: 0.49 })).toBe(false);
  });
});
