#!/usr/bin/env tsx
/**
 * Marks final JEV prediction when a PR merges into image.
 */
import { join } from "node:path";
import { commitMergeMark, ensureDatasetWorktree } from "./datasetStore";

const WORKTREE_DIR = join(process.cwd(), ".jev-data-worktree");

async function main(): Promise<void> {
  const merged = process.env.PR_MERGED === "true";
  const prNumber = Number(process.env.PR_NUMBER);
  const mergedAt = process.env.MERGED_AT?.trim();

  if (!merged || !prNumber || !mergedAt) {
    console.log("Not a merged PR or missing metadata — skip.");
    return;
  }

  try {
    ensureDatasetWorktree(process.cwd(), WORKTREE_DIR);
    commitMergeMark(process.cwd(), WORKTREE_DIR, prNumber, mergedAt);
    console.log(`Marked final prediction for merged PR #${prNumber}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`Merge mark failed (non-fatal): ${msg}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
