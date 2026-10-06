import { describe, expect, it } from "vitest";
import { buildJevState, isSkippedFile, trimBody } from "./buildState";
import {
  estimateStatePlusLongestQuestion,
  isStateWithinBudget,
  JEV_STATE_QUESTION_TOKEN_LIMIT,
} from "./stateBudget";

describe("buildJevState", () => {
  it("summarizes lockfiles and omits binary paths from diff", () => {
    const state = buildJevState({
      title: "bump deps",
      body: "Dependabot",
      author: "dependabot[bot]",
      labels: ["dependencies"],
      files: [
        {
          filename: "package-lock.json",
          additions: 10,
          deletions: 10,
          patch: '+    "lodash": {\n+      "version": "4.17.21",',
        },
        {
          filename: "public/arena/map/tile.png",
          additions: 100,
          deletions: 0,
        },
        {
          filename: "src/lib/services/foo.ts",
          additions: 2,
          deletions: 1,
          patch: "@@\n+export const x = 1;",
        },
      ],
      diff: [
        "diff --git a/package-lock.json b/package-lock.json",
        "+lodash",
        "diff --git a/public/arena/map/tile.png b/public/arena/map/tile.png",
        "Binary files differ",
        "diff --git a/src/lib/services/foo.ts b/src/lib/services/foo.ts",
        "+export const x = 1;",
      ].join("\n"),
    });

    expect(state.lockfile_summaries?.["package-lock.json"]).toBeDefined();
    expect(state.changed_files.map((f) => f.path)).not.toContain(
      "public/arena/map/tile.png",
    );
    expect(state.sensitive_paths).toContain("service layer");
    expect(state.diff).toContain("src/lib/services/foo.ts");
    expect(state.diff).not.toContain("Binary files differ");
    expect(isStateWithinBudget(state)).toBe(true);
  });

  it("truncates very large diffs within budget", () => {
    const hugeDiff = `diff --git a/a.ts b/a.ts\n${"+line\n".repeat(200_000)}`;
    const state = buildJevState({
      title: "big",
      body: "",
      author: "dev",
      labels: [],
      files: [{ filename: "a.ts", additions: 1, deletions: 0 }],
      diff: hugeDiff,
    });
    expect(state.truncation_note).toBeDefined();
    expect(state.diff).toContain("[diff truncated");
    expect(isStateWithinBudget(state)).toBe(true);
  });
});

describe("isSkippedFile", () => {
  it("skips binary and generated arena map paths", () => {
    expect(isSkippedFile("foo.png")).toBe(true);
    expect(isSkippedFile("public/arena/map/v3/tile.bin")).toBe(true);
    expect(isSkippedFile("src/app/page.tsx")).toBe(false);
  });
});

describe("trimBody", () => {
  it("truncates long PR bodies", () => {
    expect(trimBody("x".repeat(5000), 100).length).toBeLessThan(200);
  });
});
