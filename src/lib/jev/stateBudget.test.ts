import { describe, expect, it } from "vitest";
import { buildJevState } from "./buildState";
import {
  estimateJsonTokens,
  estimateRequestTokens,
  isStateWithinBudget,
  MAX_STATE_TOKENS,
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
    expect(estimateJsonTokens(state)).toBeLessThanOrEqual(MAX_STATE_TOKENS);
    expect(isStateWithinBudget(state)).toBe(true);
    expect(estimateRequestTokens(state)).toBeLessThan(32_000);
  });
});
