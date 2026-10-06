import { describe, expect, it } from "vitest";
import {
  isRegisteredWorktree,
  shouldGitWorktreeRemove,
  shouldRemovePlainDirectory,
} from "./datasetWorktree";

const SAMPLE_LIST = `worktree /home/runner/work/H3-Teamy/H3-Teamy
HEAD abc
branch refs/heads/image

worktree /home/runner/work/H3-Teamy/H3-Teamy/.jev-data-worktree
HEAD def
branch refs/heads/jev-risk-data
`;

describe("isRegisteredWorktree", () => {
  it("detects registered worktree paths", () => {
    expect(
      isRegisteredWorktree(
        "/home/runner/work/H3-Teamy/H3-Teamy/.jev-data-worktree",
        SAMPLE_LIST,
      ),
    ).toBe(true);
    expect(
      isRegisteredWorktree(
        "/home/runner/work/H3-Teamy/H3-Teamy/.jev-data-worktree-not-real",
        SAMPLE_LIST,
      ),
    ).toBe(false);
  });
});

describe("cleanup decisions", () => {
  it("removes via git only when registered", () => {
    const dir = "/home/runner/work/H3-Teamy/H3-Teamy/.jev-data-worktree";
    expect(shouldGitWorktreeRemove(true, SAMPLE_LIST, dir)).toBe(true);
    expect(
      shouldGitWorktreeRemove(true, SAMPLE_LIST, "/tmp/plain-dir"),
    ).toBe(false);
  });

  it("deletes plain directory when not a worktree", () => {
    expect(
      shouldRemovePlainDirectory(true, SAMPLE_LIST, "/tmp/plain-dir"),
    ).toBe(true);
    expect(
      shouldRemovePlainDirectory(
        true,
        SAMPLE_LIST,
        "/home/runner/work/H3-Teamy/H3-Teamy/.jev-data-worktree",
      ),
    ).toBe(false);
  });
});
