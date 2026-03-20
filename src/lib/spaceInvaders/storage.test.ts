import { describe, expect, it } from "vitest";
import { MAX_HIGH_SCORES, mergeHighScores } from "./storage";
import type { HighScoreEntry } from "./types";

describe("mergeHighScores", () => {
  it("sorts by score descending and caps length", () => {
    const base: HighScoreEntry[] = [
      { score: 50, wave: 2, at: "a" },
      { score: 100, wave: 3, at: "b" },
    ];
    const merged = mergeHighScores(base, { score: 75, wave: 2, at: "c" });
    expect(merged.map((e) => e.score)).toEqual([100, 75, 50]);
  });

  it("respects max parameter", () => {
    const many: HighScoreEntry[] = Array.from({ length: 15 }, (_, i) => ({
      score: i * 10,
      wave: 1,
      at: `t${i}`,
    }));
    const merged = mergeHighScores(
      many,
      { score: 999, wave: 9, at: "top" },
      MAX_HIGH_SCORES,
    );
    expect(merged.length).toBe(MAX_HIGH_SCORES);
    expect(merged[0]!.score).toBe(999);
  });
});
