import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
import { gitActorCommit, runGit, tryRunGit } from "@/lib/jev/gitExec";
import { authenticatedRemoteUrl } from "@/lib/jev/gitRemote";
import { jevDatasetVercelJsonText } from "@/lib/jev/datasetBranchVercel";
import {
  JEV_DATA_BRANCH,
  OUTCOMES_FILE,
  PREDICTIONS_FILE,
} from "@/lib/jev/types";
import type { OutcomeRecord, PredictionRecord } from "@/lib/jev/types";

const MAX_PUSH_RETRIES = 5;

function worktreeList(repoRoot: string): string {
  return tryRunGit(repoRoot, ["worktree", "list", "--porcelain"]) ?? "";
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
      runGit(repoRoot, ["worktree", "remove", "--force", worktreeDir]);
    } catch {
      // Fall through to directory removal.
    }
  }

  if (
    shouldRemovePlainDirectory(
      existsSync(worktreeDir),
      worktreeList(repoRoot),
      worktreeDir,
    )
  ) {
    rmSync(worktreeDir, { recursive: true, force: true });
  }

  tryRunGit(repoRoot, ["worktree", "prune"]);
}

function remoteBranchExists(repoRoot: string): boolean {
  tryRunGit(repoRoot, ["fetch", "origin", JEV_DATA_BRANCH]);
  const branches = runGit(repoRoot, ["branch", "-r"]);
  return branches.includes(`origin/${JEV_DATA_BRANCH}`);
}

function writeDatasetVercelConfig(dir: string): void {
  writeFileSync(join(dir, "vercel.json"), jevDatasetVercelJsonText(), "utf8");
}

function writeInitialDatasetFiles(dir: string): void {
  writeFileSync(join(dir, PREDICTIONS_FILE), "", "utf8");
  writeFileSync(join(dir, OUTCOMES_FILE), "", "utf8");
  writeFileSync(
    join(dir, "README.md"),
    "# JEV risk dataset\n\nOrphan branch for predictions/outcomes JSONL. Not deployed on Vercel.\n",
    "utf8",
  );
  writeDatasetVercelConfig(dir);
}

function resolveAuthenticatedRemote(repoRoot: string): string {
  const url = runGit(repoRoot, ["remote", "get-url", "origin"]).trim();
  return authenticatedRemoteUrl(url, process.env.GITHUB_TOKEN?.trim());
}

/**
 * Creates the orphan jev-risk-data branch via a temp repo (avoids worktree --orphan quirks).
 * @param repoRoot - Main checkout with origin remote configured.
 * @param worktreeDir - Target worktree path after branch exists.
 */
function initOrphanBranch(repoRoot: string, worktreeDir: string): void {
  const tempDir = `${worktreeDir}-init`;
  rmSync(tempDir, { recursive: true, force: true });
  mkdirSync(tempDir, { recursive: true });

  writeInitialDatasetFiles(tempDir);
  runGit(tempDir, ["init"]);
  runGit(tempDir, ["checkout", "--orphan", JEV_DATA_BRANCH]);
  runGit(tempDir, ["add", "-A"]);
  gitActorCommit(tempDir, `jev: init ${JEV_DATA_BRANCH} dataset branch`);
  runGit(tempDir, ["remote", "add", "origin", resolveAuthenticatedRemote(repoRoot)]);
  runGit(tempDir, ["push", "-u", "origin", JEV_DATA_BRANCH]);

  rmSync(tempDir, { recursive: true, force: true });
  runGit(repoRoot, ["fetch", "origin", JEV_DATA_BRANCH]);
  runGit(repoRoot, [
    "worktree",
    "add",
    worktreeDir,
    `origin/${JEV_DATA_BRANCH}`,
  ]);
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
    runGit(repoRoot, [
      "worktree",
      "add",
      worktreeDir,
      `origin/${JEV_DATA_BRANCH}`,
    ]);
    return;
  }

  initOrphanBranch(repoRoot, worktreeDir);
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
      if (
        !existsSync(worktreeDir) ||
        !isRegisteredWorktree(worktreeDir, worktreeList(repoRoot))
      ) {
        ensureDatasetWorktree(repoRoot, worktreeDir);
      }

      runGit(worktreeDir, ["fetch", "origin", JEV_DATA_BRANCH]);
      runGit(worktreeDir, ["reset", "--hard", `origin/${JEV_DATA_BRANCH}`]);
      writeDatasetVercelConfig(worktreeDir);
      mutate();
      runGit(worktreeDir, ["add", "-A"]);
      const status = runGit(worktreeDir, ["status", "--porcelain"]);
      if (!status.trim()) {
        return;
      }
      gitActorCommit(worktreeDir, message);
      runGit(worktreeDir, ["push", "origin", `HEAD:${JEV_DATA_BRANCH}`]);
      return;
    } catch {
      if (attempt === MAX_PUSH_RETRIES - 1) {
        throw new Error("Failed to push jev-risk-data after retries");
      }
      cleanupWorktreeDir(repoRoot, worktreeDir);
    }
  }
}
