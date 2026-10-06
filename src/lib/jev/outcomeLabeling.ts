import type { OutcomeEvidence, OutcomeRecord, RiskLevel } from "./types";
import type { PredictionRecord } from "./types";

export interface MergedPrInput {
  number: number;
  merge_commit_sha: string;
  merged_at: string;
  title: string;
  labels: string[];
  changed_files: string[];
}

export interface OutcomeSignalInput {
  mergedPr: MergedPrInput;
  revertPrNumbers: number[];
  revertCommitShas: string[];
  followUpPrs: Array<{ number: number; title: string; files: string[] }>;
  failedCheckNames: string[];
  vercelProductionFailure: boolean;
  vercelDeploymentUrl?: string;
}

const FIX_TITLE_RE =
  /\b(fix|hotfix|revert|patch|rollback|regression)\b/i;
const FIX_BRANCH_RE =
  /\b(fix|hotfix|revert|patch)\b/i;

/**
 * Classifies post-merge outcome signals into a labeled record.
 * @param input - GitHub-derived signals for a merged PR.
 * @param predictions - Optional predictions to link risk level at merge.
 */
export function classifyOutcome(
  input: OutcomeSignalInput,
  predictions: PredictionRecord[] = [],
): OutcomeRecord {
  const { mergedPr } = input;
  const evidence: OutcomeEvidence = {};

  if (input.revertPrNumbers.length > 0 || input.revertCommitShas.length > 0) {
    evidence.reverted = true;
    evidence.revert_refs = [
      ...input.revertPrNumbers.map((n) => `PR #${n}`),
      ...input.revertCommitShas.map((s) => `commit ${s.slice(0, 7)}`),
    ];
  }

  const overlappingFixPrs = input.followUpPrs.filter((pr) => {
    const titleMatch = FIX_TITLE_RE.test(pr.title);
    const overlap = pr.files.some((f) => mergedPr.changed_files.includes(f));
    return titleMatch && overlap;
  });

  if (overlappingFixPrs.length > 0) {
    evidence.follow_up_fix_pr = true;
    evidence.follow_up_prs = overlappingFixPrs.map((p) => p.number);
  }

  if (input.failedCheckNames.length > 0) {
    evidence.failed_checks_on_merge = true;
    evidence.failed_check_names = input.failedCheckNames;
  }

  if (input.vercelProductionFailure) {
    evidence.vercel_production_failure = true;
    if (input.vercelDeploymentUrl) {
      evidence.vercel_deployment_url = input.vercelDeploymentUrl;
    }
  }

  if (mergedPr.labels.includes("post-merge-issue")) {
    evidence.labeled_post_merge_issue = true;
  }
  if (mergedPr.labels.includes("jev:incident")) {
    evidence.labeled_jev_incident = true;
  }
  if (mergedPr.labels.includes("jev:false-alarm")) {
    evidence.manual_false_alarm = true;
  }
  if (mergedPr.labels.includes("jev:no-issue")) {
    evidence.manual_no_issue = true;
  }

  const hadProblem = deriveHadProblem(evidence);
  const finalPrediction = predictions.find(
    (p) => p.pr_number === mergedPr.number && p.final_before_merge,
  );

  return {
    pr_number: mergedPr.number,
    merge_commit_sha: mergedPr.merge_commit_sha,
    merged_at: mergedPr.merged_at,
    labeled_at: new Date().toISOString(),
    had_problem: hadProblem,
    evidence,
    prediction_head_sha: finalPrediction?.head_sha,
    risk_level_at_merge: finalPrediction
      ? getRiskLevel(finalPrediction)
      : undefined,
  };
}

/**
 * Returns true when automated or manual signals indicate a post-merge problem.
 * @param evidence - Collected outcome evidence.
 */
export function deriveHadProblem(evidence: OutcomeEvidence): boolean {
  if (evidence.manual_false_alarm || evidence.manual_no_issue) {
    return false;
  }
  return Boolean(
    evidence.reverted ||
      evidence.follow_up_fix_pr ||
      evidence.failed_checks_on_merge ||
      evidence.vercel_production_failure ||
      evidence.labeled_post_merge_issue ||
      evidence.labeled_jev_incident,
  );
}

/**
 * Filters follow-up PRs merged within days after the original merge.
 * @param followUps - Candidate PRs with merge timestamps.
 * @param mergedAt - ISO merge time of the original PR.
 * @param withinDays - Window in days (default 7).
 */
export function filterFollowUpsWithinDays<T extends { merged_at: string }>(
  followUps: T[],
  mergedAt: string,
  withinDays = 7,
): T[] {
  const start = new Date(mergedAt).getTime();
  const end = start + withinDays * 24 * 60 * 60 * 1000;
  return followUps.filter((pr) => {
    const t = new Date(pr.merged_at).getTime();
    return t >= start && t <= end;
  });
}

function getRiskLevel(prediction: PredictionRecord): RiskLevel | undefined {
  const answer = prediction.jev_answers.risk_level;
  if (answer?.type === "choice") {
    const choice = answer.choice;
    if (choice === "low" || choice === "medium" || choice === "high") {
      return choice;
    }
  }
  return undefined;
}
