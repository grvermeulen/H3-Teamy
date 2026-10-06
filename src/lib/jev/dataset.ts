import {
  JEV_DATA_BRANCH,
  OUTCOMES_FILE,
  PREDICTIONS_FILE,
} from "./types";
import type { OutcomeRecord, PredictionRecord } from "./types";

/**
 * Parses a JSONL file into typed records, skipping blank lines.
 * @param content - Raw JSONL text.
 */
export function parseJsonl<T>(content: string): T[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

/**
 * Serializes records to JSONL (one JSON object per line).
 * @param records - Array of records to write.
 */
export function serializeJsonl<T>(records: T[]): string {
  if (records.length === 0) {
    return "";
  }
  return `${records.map((r) => JSON.stringify(r)).join("\n")}\n`;
}

/**
 * Upserts a prediction by head SHA, keeping the latest assessment per SHA.
 * @param existing - Current prediction records.
 * @param record - New or updated prediction.
 */
export function upsertPrediction(
  existing: PredictionRecord[],
  record: PredictionRecord,
): PredictionRecord[] {
  const withoutSha = existing.filter((r) => r.head_sha !== record.head_sha);
  return [...withoutSha, record].sort((a, b) =>
    a.assessed_at.localeCompare(b.assessed_at),
  );
}

/**
 * Marks the final prediction before merge for a PR number.
 * @param predictions - All prediction records.
 * @param prNumber - Merged PR number.
 * @param mergedAt - ISO timestamp of merge.
 */
export function markFinalBeforeMerge(
  predictions: PredictionRecord[],
  prNumber: number,
  mergedAt: string,
): PredictionRecord[] {
  const forPr = predictions
    .filter((p) => p.pr_number === prNumber)
    .sort((a, b) => a.assessed_at.localeCompare(b.assessed_at));
  if (forPr.length === 0) {
    return predictions;
  }
  const finalSha = forPr[forPr.length - 1].head_sha;
  return predictions.map((p) => {
    if (p.pr_number !== prNumber) {
      return p;
    }
    return {
      ...p,
      final_before_merge: p.head_sha === finalSha,
      merged_at: p.head_sha === finalSha ? mergedAt : p.merged_at,
    };
  });
}

/**
 * Upserts an outcome by PR number.
 * @param existing - Current outcome records.
 * @param record - New or updated outcome.
 */
export function upsertOutcome(
  existing: OutcomeRecord[],
  record: OutcomeRecord,
): OutcomeRecord[] {
  const without = existing.filter((r) => r.pr_number !== record.pr_number);
  return [...without, record].sort((a, b) =>
    a.merged_at.localeCompare(b.merged_at),
  );
}

/**
 * Returns PR numbers that already have outcome labels.
 * @param outcomes - Labeled outcome records.
 */
export function labeledPrNumbers(outcomes: OutcomeRecord[]): Set<number> {
  return new Set(outcomes.map((o) => o.pr_number));
}

/** Dataset branch and file names for git operations. */
export const DATASET_FILES = {
  branch: JEV_DATA_BRANCH,
  predictions: PREDICTIONS_FILE,
  outcomes: OUTCOMES_FILE,
} as const;
