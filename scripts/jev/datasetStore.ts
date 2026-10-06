import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  markFinalBeforeMerge,
  parseJsonl,
  serializeJsonl,
  upsertOutcome,
  upsertPrediction,
} from "@/lib/jev/dataset";
import { JEV_DATA_BRANCH, OUTCOMES_FILE, PREDICTIONS_FILE } from "@/lib/jev/types";
import type { OutcomeRecord, PredictionRecord } from "@/lib/jev/types";

const MAX_PUSH_RETRIES = 5;

/**
 * Prepares a git worktree for the jev-risk-data orphan branch.
 * @param repoRoot - Main repository checkout path.
 * @param worktreeDir - Directory for the dataset worktree.
 */
export function ensureDatasetWorktree(
  repoRoot: string,
  worktreeDir: string,
): void {
  execSync(`git fetch origin ${JEV_DATA_BRANCH} 2>/dev/null || true`, {
    cwd: repoRoot,
    stdio: "pipe",
  });

  const remoteBranch = execSync("git branch -r", {
    cwd: repoRoot,
    encoding: "utf8",
  }).includes(`origin/${JEV_DATA_BRANCH}`);

  if (existsSync(worktreeDir)) {
    execSync(`git worktree remove --force ${worktreeDir}`, {
      cwd: repoRoot,
      stdio: "pipe",
    });
  }
  mkdirSync(worktreeDir, { recursive: true });

  if (!remoteBranch) {
    initOrphanBranch(repoRoot, worktreeDir);
    return;
  }

  execSync(`git worktree add ${worktreeDir} origin/${JEV_DATA_BRANCH}`, {
    cwd: repoRoot,
    stdio: "pipe",
  });
}

function initOrphanBranch(repoRoot: string, worktreeDir: string): void {
  writeFileSync(join(worktreeDir, PREDICTIONS_FILE), "", "utf8");
  writeFileSync(join(worktreeDir, OUTCOMES_FILE), "", "utf8");
  writeFileSync(
    join(worktreeDir, "README.md"),
    "# JEV risk dataset\n\nOrphan branch for predictions/outcomes JSONL. Not deployed on Vercel.\n",
    "utf8",
  );

  const tempBranch = `${JEV_DATA_BRANCH}-init`;
  execSync(`git checkout --orphan ${tempBranch}`, {
    cwd: repoRoot,
    stdio: "pipe",
  });
  execSync("git rm -rf . 2>/dev/null || true", { cwd: repoRoot, stdio: "pipe" });
  for (const file of [PREDICTIONS_FILE, OUTCOMES_FILE, "README.md"]) {
    execSync(`cp ${join(worktreeDir, file)} ${join(repoRoot, file)}`, {
      stdio: "pipe",
    });
  }
  execSync("git add -A", { cwd: repoRoot, stdio: "pipe" });
  execSync(`git commit -m "jev: init ${JEV_DATA_BRANCH} dataset branch"`, {
    cwd: repoRoot,
    stdio: "pipe",
  });
  execSync(`git branch -M ${JEV_DATA_BRANCH}`, { cwd: repoRoot, stdio: "pipe" });
  execSync(`git push -u origin ${JEV_DATA_BRANCH}`, {
    cwd: repoRoot,
    stdio: "pipe",
  });
  execSync(`git checkout -`, { cwd: repoRoot, stdio: "pipe" });
  execSync(`git worktree add ${worktreeDir} origin/${JEV_DATA_BRANCH}`, {
    cwd: repoRoot,
    stdio: "pipe",
  });
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
      execSync(`git fetch origin ${JEV_DATA_BRANCH}`, {
        cwd: worktreeDir,
        stdio: "pipe",
      });
      execSync(`git reset --hard origin/${JEV_DATA_BRANCH}`, {
        cwd: worktreeDir,
        stdio: "pipe",
      });
      mutate();
      execSync("git add -A", { cwd: worktreeDir, stdio: "pipe" });
      const status = execSync("git status --porcelain", {
        cwd: worktreeDir,
        encoding: "utf8",
      });
      if (!status.trim()) {
        return;
      }
      execSync(`git -c user.name="github-actions[bot]" -c user.email="github-actions[bot]@users.noreply.github.com commit -m "${message.replace(/"/g, '\\"')}"`, {
        cwd: worktreeDir,
        stdio: "pipe",
      });
      execSync(`git push origin HEAD:${JEV_DATA_BRANCH}`, {
        cwd: worktreeDir,
        stdio: "pipe",
      });
      return;
    } catch {
      if (attempt === MAX_PUSH_RETRIES - 1) {
        throw new Error("Failed to push jev-risk-data after retries");
      }
    }
  }
}
