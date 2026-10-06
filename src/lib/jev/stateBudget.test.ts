import { describe, expect, it } from "vitest";
import { buildJevState } from "./buildState";
import {
  estimateJsonTokens,
  estimateRequestTokens,
  estimateStatePlusLongestQuestion,
  isStateWithinBudget,
  JEV_STATE_QUESTION_TOKEN_LIMIT,
} from "./stateBudget";

describe("stateBudget", () => {
  it("keeps built state under MAX_STATE_TOKENS for large diffs", () => {
    const hugeDiff = `diff --git a/a.ts b/a.ts\n${"+line\n".repeat(200_000)}`;
    const state = buildJevState({
      title: "big PR",
      body: "body",
      author: "dev",
      labels: [],
      files: [{ filename: "a.ts", additions: 1, deletions: 0 }],
      diff: hugeDiff,
    });
    expect(estimateStatePlusLongestQuestion(state)).toBeLessThanOrEqual(
      JEV_STATE_QUESTION_TOKEN_LIMIT,
    );
    expect(isStateWithinBudget(state)).toBe(true);
  });
});
