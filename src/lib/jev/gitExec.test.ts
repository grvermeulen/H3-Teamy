import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gitActorCommit, gitExecutor, runGit, tryRunGit } from "./gitExec";

describe("runGit", () => {
  afterEach(() => {
    gitExecutor.execFile = execFileSync;
  });

  it("calls execFileSync with argument array and no shell", () => {
    const mock = vi.fn().mockReturnValue("ok");
    gitExecutor.execFile = mock as typeof execFileSync;
    runGit("/repo", ["status", "--porcelain"]);
    expect(mock).toHaveBeenCalledWith(
      "git",
      ["status", "--porcelain"],
      { cwd: "/repo", encoding: "utf8", stdio: "pipe" },
    );
  });
});

describe("gitActorCommit", () => {
  afterEach(() => {
    gitExecutor.execFile = execFileSync;
  });

  it("passes commit message as a discrete -m argument", () => {
    const mock = vi.fn().mockReturnValue("");
    gitExecutor.execFile = mock as typeof execFileSync;
    gitActorCommit("/repo", 'jev: test "quote" \\ slash');
    expect(mock).toHaveBeenCalledWith(
      "git",
      [
        "-c",
        "user.name=github-actions[bot]",
        "-c",
        "user.email=github-actions[bot]@users.noreply.github.com",
        "commit",
        "-m",
        'jev: test "quote" \\ slash',
      ],
      { cwd: "/repo", encoding: "utf8", stdio: "pipe" },
    );
  });
});

describe("tryRunGit", () => {
  afterEach(() => {
    gitExecutor.execFile = execFileSync;
  });

  it("returns null on failure", () => {
    gitExecutor.execFile = vi.fn().mockImplementation(() => {
      throw new Error("fail");
    }) as typeof execFileSync;
    expect(tryRunGit("/repo", ["fetch"])).toBeNull();
  });
});
