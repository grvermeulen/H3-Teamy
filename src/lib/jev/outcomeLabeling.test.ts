import { describe, expect, it } from "vitest";
import {
  classifyOutcome,
  deriveHadProblem,
  filterFollowUpsWithinDays,
} from "./outcomeLabeling";

describe("deriveHadProblem", () => {
  it("returns false for manual false alarm", () => {
    expect(
      deriveHadProblem({ manual_false_alarm: true, reverted: true }),
    ).toBe(false);
  });

  it("returns true for revert evidence", () => {
    expect(deriveHadProblem({ reverted: true })).toBe(true);
  });
});

describe("classifyOutcome", () => {
  it("collects revert and follow-up evidence", () => {
    const outcome = classifyOutcome({
      mergedPr: {
        number: 10,
        merge_commit_sha: "abc123",
        merged_at: "2026-01-01T12:00:00Z",
        title: "feat: widget",
        labels: [],
        changed_files: ["src/lib/foo.ts"],
      },
      revertPrNumbers: [11],
      revertCommitShas: [],
      followUpPrs: [
        {
          number: 12,
          title: "fix: widget regression",
          files: ["src/lib/foo.ts"],
        },
      ],
      failedCheckNames: [],
      vercelProductionFailure: false,
    });
    expect(outcome.had_problem).toBe(true);
    expect(outcome.evidence.reverted).toBe(true);
    expect(outcome.evidence.follow_up_fix_pr).toBe(true);
  });

  it("respects jev:no-issue override", () => {
    const outcome = classifyOutcome({
      mergedPr: {
        number: 10,
        merge_commit_sha: "abc",
        merged_at: "2026-01-01T12:00:00Z",
        title: "feat",
        labels: ["jev:no-issue"],
        changed_files: [],
      },
      revertPrNumbers: [11],
      revertCommitShas: [],
      followUpPrs: [],
      failedCheckNames: ["Verify"],
      vercelProductionFailure: true,
    });
    expect(outcome.had_problem).toBe(false);
  });
});

describe("filterFollowUpsWithinDays", () => {
  it("keeps PRs within 7 days after merge", () => {
    const mergedAt = "2026-01-01T12:00:00Z";
    const items = filterFollowUpsWithinDays(
      [
        { merged_at: "2026-01-03T12:00:00Z" },
        { merged_at: "2026-01-20T12:00:00Z" },
      ],
      mergedAt,
      7,
    );
    expect(items).toHaveLength(1);
  });
});
