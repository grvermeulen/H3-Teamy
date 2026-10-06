import { execSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  markFinalBeforeMerge,
  parseJsonl,
  serializeJsonl,
  upsertOutcome,
  upsertPrediction,
} from "@/lib/jev/dataset";
import {
  isRegisteredWorktree,
  shouldGitWorktreeRemove,
  shouldRemovePlainDirectory,
} from "@/lib/jev/datasetWorktree";
import { JEV_DATA_BRANCH, OUTCOMES_FILE, PREDICTIONS_FILE } from "@/lib/jev/types";
import type { OutcomeRecord, PredictionRecord } from "@/lib/jev/types";

const MAX_PUSH_RETRIES = 5;

function runGit(
  repoRoot: string,
  args: string,
  options: { cwd?: string; encoding?: BufferEncoding } = {},
): string {
  return execSync(`git ${args}`, {
    cwd: options.cwd ?? repoRoot,
    encoding: options.encoding ?? "utf8",
    stdio: options.encoding ? "pipe" : "pipe",
  }) as string;
}

function worktreeList(repoRoot: string): string {
  try {
    return runGit(repoRoot, "worktree list --porcelain");
  } catch {
    return "";
  }
}

/**
 * Idempotently removes a worktree directory or plain folder at worktreeDir.
 * @param repoRoot - Main repository checkout path.
 * @param worktreeDir - Candidate worktree path.
 */
export function cleanupWorktreeDir(repoRoot: string, worktreeDir: string): void {
  const dirExists = existsSync(worktreeDir);
  const list = worktreeList(repoRoot);

  if (shouldGitWorktreeRemove(dirExists, list, worktreeDir)) {
    try {
      runGit(repoRoot, `worktree remove --force "${worktreeDir}"`);
    } catch {
      // Fall through to directory removal.
    }
  }

  if (shouldRemovePlainDirectory(existsSync(worktreeDir), worktreeList(repoRoot), worktreeDir)) {
    rmSync(worktreeDir, { recursive: true, force: true });
  }

  try {
    runGit(repoRoot, "worktree prune");
  } catch {
    // Non-fatal.
  }
}

function remoteBranchExists(repoRoot: string): boolean {
  runGit(repoRoot, `fetch origin ${JEV_DATA_BRANCH} 2>/dev/null || true`);
  const branches = runGit(repoRoot, "branch -r");
  return branches.includes(`origin/${JEV_DATA_BRANCH}`);
}

function writeInitialDatasetFiles(worktreeDir: string): void {
  writeFileSync(join(worktreeDir, PREDICTIONS_FILE), "", "utf8");
  writeFileSync(join(worktreeDir, OUTCOMES_FILE), "", "utf8");
  writeFileSync(
    join(worktreeDir, "README.md"),
    "# JEV risk dataset\n\nOrphan branch for predictions/outcomes JSONL. Not deployed on Vercel.\n",
    "utf8",
  );
}

function gitActor(repoRoot: string): string {
  return `-c user.name="github-actions[bot]" -c user.email="github-actions[bot]@users.noreply.github.com"`;
}

/**
 * Prepares a git worktree for the jev-risk-data orphan branch.
 * @param repoRoot - Main repository checkout path.
 * @param worktreeDir - Directory for the dataset worktree.
 */
export function ensureDatasetWorktree(
  repoRoot: string,
  worktreeDir: string,
): void {
  cleanupWorktreeDir(repoRoot, worktreeDir);

  if (remoteBranchExists(repoRoot)) {
    runGit(repoRoot, `worktree add "${worktreeDir}" origin/${JEV_DATA_BRANCH}`);
    return;
  }

  runGit(repoRoot, `worktree add --orphan ${JEV_DATA_BRANCH} "${worktreeDir}"`);
  writeInitialDatasetFiles(worktreeDir);
  runGit(repoRoot, "add -A", { cwd: worktreeDir });
  runGit(repoRoot, `${gitActor(repoRoot)} commit -m "jev: init ${JEV_DATA_BRANCH} dataset branch"`, {
    cwd: worktreeDir,
  });
  runGit(repoRoot, `push -u origin ${JEV_DATA_BRANCH}`, { cwd: worktreeDir });
}

function readPredictions(dir: string): PredictionRecord[] {
  const path = join(dir, PREDICTIONS_FILE);
  if (!existsSync(path)) {
    return [];
  }
  return parseJsonl<PredictionRecord>(readFileSync(path, "utf8"));
}

function readOutcomes(dir: string): OutcomeRecord[] {
  const path = join(dir, OUTCOMES_FILE);
  if (!existsSync(path)) {
    return [];
  }
  return parseJsonl<OutcomeRecord>(readFileSync(path, "utf8"));
}

/**
 * Upserts a prediction on jev-risk-data with conflict retry.
 * @param repoRoot - Repository root.
 * @param worktreeDir - Dataset worktree path.
 * @param record - Prediction record.
 * @param message - Commit message.
 */
export function commitPrediction(
  repoRoot: string,
  worktreeDir: string,
  record: PredictionRecord,
  message: string,
): void {
  pushWithRetry(repoRoot, worktreeDir, () => {
    const predictions = readPredictions(worktreeDir);
    writeFileSync(
      join(worktreeDir, PREDICTIONS_FILE),
      serializeJsonl(upsertPrediction(predictions, record)),
      "utf8",
    );
  }, message);
}

/**
 * Upserts outcome records on jev-risk-data.
 * @param repoRoot - Repository root.
 * @param worktreeDir - Dataset worktree path.
 * @param records - Outcome records.
 * @param message - Commit message.
 */
export function commitOutcomes(
  repoRoot: string,
  worktreeDir: string,
  records: OutcomeRecord[],
  message: string,
): void {
  pushWithRetry(repoRoot, worktreeDir, () => {
    let outcomes = readOutcomes(worktreeDir);
    for (const record of records) {
      outcomes = upsertOutcome(outcomes, record);
    }
    writeFileSync(
      join(worktreeDir, OUTCOMES_FILE),
      serializeJsonl(outcomes),
      "utf8",
    );
  }, message);
}

/**
 * Marks the final pre-merge prediction after a PR merges.
 * @param repoRoot - Repository root.
 * @param worktreeDir - Dataset worktree path.
 * @param prNumber - Merged PR number.
 * @param mergedAt - ISO merge timestamp.
 */
export function commitMergeMark(
  repoRoot: string,
  worktreeDir: string,
  prNumber: number,
  mergedAt: string,
): void {
  pushWithRetry(
    repoRoot,
    worktreeDir,
    () => {
      const predictions = readPredictions(worktreeDir);
      writeFileSync(
        join(worktreeDir, PREDICTIONS_FILE),
        serializeJsonl(
          markFinalBeforeMerge(predictions, prNumber, mergedAt),
        ),
        "utf8",
      );
    },
    `jev: mark final prediction for PR #${prNumber}`,
  );
}

function pushWithRetry(
  repoRoot: string,
  worktreeDir: string,
  mutate: () => void,
  message: string,
): void {
  for (let attempt = 0; attempt < MAX_PUSH_RETRIES; attempt++) {
    try {
      if (!existsSync(worktreeDir) || !isRegisteredWorktree(worktreeDir, worktreeList(repoRoot))) {
        ensureDatasetWorktree(repoRoot, worktreeDir);
      }

      runGit(repoRoot, `fetch origin ${JEV_DATA_BRANCH}`, { cwd: worktreeDir });
      runGit(repoRoot, `reset --hard origin/${JEV_DATA_BRANCH}`, { cwd: worktreeDir });
      mutate();
      runGit(repoRoot, "add -A", { cwd: worktreeDir });
      const status = runGit(repoRoot, "status --porcelain", { cwd: worktreeDir });
      if (!status.trim()) {
        return;
      }
      const safeMessage = message.replace(/"/g, '\\"');
      runGit(
        repoRoot,
        `${gitActor(repoRoot)} commit -m "${safeMessage}"`,
        { cwd: worktreeDir },
      );
      runGit(repoRoot, `push origin HEAD:${JEV_DATA_BRANCH}`, { cwd: worktreeDir });
      return;
    } catch {
      if (attempt === MAX_PUSH_RETRIES - 1) {
        throw new Error("Failed to push jev-risk-data after retries");
      }
      cleanupWorktreeDir(repoRoot, worktreeDir);
    }
  }
}
