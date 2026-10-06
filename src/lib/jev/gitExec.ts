import * as childProcess from "node:child_process";

const GIT_ACTOR_CONFIG = [
  "-c",
  "user.name=github-actions[bot]",
  "-c",
  "user.email=github-actions[bot]@users.noreply.github.com",
] as const;

/** Mutable executor hook for tests. */
export const gitExecutor = {
  execFile: childProcess.execFileSync,
};

/**
 * Runs git with an argument array (no shell interpolation).
 * @param cwd - Working directory for the git process.
 * @param args - Git arguments after the `git` executable name.
 */
export function runGit(cwd: string, args: readonly string[]): string {
  return gitExecutor.execFile("git", [...args], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });
}

/**
 * Runs git and returns null when the command fails.
 * @param cwd - Working directory for the git process.
 * @param args - Git arguments after the `git` executable name.
 */
export function tryRunGit(cwd: string, args: readonly string[]): string | null {
  try {
    return runGit(cwd, args);
  } catch {
    return null;
  }
}

/**
 * Creates a commit with the GitHub Actions bot identity.
 * @param cwd - Repository or worktree directory.
 * @param message - Commit message (passed as a single `-m` argument).
 */
export function gitActorCommit(cwd: string, message: string): string {
  return runGit(cwd, [...GIT_ACTOR_CONFIG, "commit", "-m", message]);
}
