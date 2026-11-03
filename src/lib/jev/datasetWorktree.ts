import { existsSync } from "node:fs";

/**
 * Returns true when dir is listed as a registered git worktree for repoRoot.
 * @param repoRoot - Main git repository path.
 * @param dir - Candidate worktree directory.
 * @param worktreeListOutput - Output of `git worktree list --porcelain`.
 */
export function isRegisteredWorktree(
  dir: string,
  worktreeListOutput: string,
): boolean {
  const normalized = dir.replace(/\/$/, "");
  return worktreeListOutput
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .some((line) => {
      const path = line.slice("worktree ".length).trim();
      return path === normalized || path.replace(/\/$/, "") === normalized;
    });
}

/**
 * Decides whether `git worktree remove` should run (dir exists and is registered).
 * @param dirExists - Whether the directory path exists on disk.
 * @param worktreeListOutput - Output of `git worktree list --porcelain`.
 * @param dir - Worktree directory path.
 */
export function shouldGitWorktreeRemove(
  dirExists: boolean,
  worktreeListOutput: string,
  dir: string,
): boolean {
  return dirExists && isRegisteredWorktree(dir, worktreeListOutput);
}

/**
 * Returns true when a plain directory should be deleted (exists but not a worktree).
 * @param dirExists - Whether the directory path exists.
 * @param worktreeListOutput - Output of `git worktree list --porcelain`.
 * @param dir - Directory path.
 */
export function shouldRemovePlainDirectory(
  dirExists: boolean,
  worktreeListOutput: string,
  dir: string,
): boolean {
  return dirExists && !isRegisteredWorktree(dir, worktreeListOutput);
}

/** Returns true when the path exists (filesystem check wrapper for tests). */
export function pathExists(path: string): boolean {
  return existsSync(path);
}
