/** JEV model pin used for all PR risk assessments. */
export const JEV_MODEL = "jev-1.13.0";

/** Hidden marker for the sticky PR comment (HTML comment, not shown in UI). */
export const JEV_COMMENT_MARKER = "<!-- jev-pr-risk:v1 -->";

/** Orphan git branch that stores prediction/outcome datasets (no Vercel deploy). */
export const JEV_DATA_BRANCH = "jev-risk-data";

export const PREDICTIONS_FILE = "predictions.jsonl";
export const OUTCOMES_FILE = "outcomes.jsonl";

export type RiskLevel = "low" | "medium" | "high";

export interface JevNoulAnswer {
  type: "noul";
  noul: number;
}

export interface JevChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface JevScoreAnswer {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
}

export type JevAnswer = JevNoulAnswer | JevChoiceAnswer | JevScoreAnswer;

export interface JevUsage {
  input_tokens: number;
  output_tokens: number;
  /** Present when the JEV API reports a billed cost for the call. */
  cost_usd?: number;
}

/** Per-call usage stored on newer prediction records (supports retry aggregation). */
export interface JevApiCallRecord {
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  model: string;
}

export interface JevResponse {
  model: string;
  answers: Record<string, JevAnswer>;
  usage: JevUsage;
}

export interface PrFileChange {
  filename: string;
  additions: number;
  deletions: number;
  patch?: string;
  status?: string;
}

export interface JevState {
  title: string;
  body: string;
  author: string;
  labels: string[];
  changed_files: Array<{
    path: string;
    additions: number;
    deletions: number;
  }>;
  sensitive_paths: string[];
  repo_context: string;
  lockfile_summaries?: Record<string, string[]>;
  diff: string;
  truncation_note?: string;
}

export interface PredictionRecord {
  pr_number: number;
  head_sha: string;
  base: string;
  author: string;
  is_dependabot: boolean;
  title: string;
  changed_paths_summary: string[];
  sensitive_paths: string[];
  jev_answers: Record<string, JevAnswer>;
  model: string;
  /** Legacy summed usage; kept for backward compatibility with older JSONL rows. */
  usage: JevUsage;
  /** Summed input tokens across all API calls in this assessment. */
  input_tokens?: number;
  /** Summed output tokens across all API calls in this assessment. */
  output_tokens?: number;
  /** Summed USD cost (API-reported or estimated) for this assessment. */
  cost_usd?: number;
  /** One entry per successful JEV API call (e.g. token-budget retry). */
  api_calls?: JevApiCallRecord[];
  assessed_at: string;
  workflow_run_id?: number;
  final_before_merge?: boolean;
  merged_at?: string;
}

export interface OutcomeEvidence {
  reverted?: boolean;
  revert_refs?: string[];
  follow_up_fix_pr?: boolean;
  follow_up_prs?: number[];
  failed_checks_on_merge?: boolean;
  failed_check_names?: string[];
  vercel_production_failure?: boolean;
  vercel_deployment_url?: string;
  labeled_post_merge_issue?: boolean;
  labeled_jev_incident?: boolean;
  manual_false_alarm?: boolean;
  manual_no_issue?: boolean;
}

export interface OutcomeRecord {
  pr_number: number;
  merge_commit_sha: string;
  merged_at: string;
  labeled_at: string;
  had_problem: boolean;
  evidence: OutcomeEvidence;
  prediction_head_sha?: string;
  risk_level_at_merge?: RiskLevel;
}

export interface ReportMetrics {
  prediction_count: number;
  outcome_count: number;
  labeled_pairs: number;
  too_small: boolean;
  confusion_matrix: {
    high_or_medium: { problem: number; no_problem: number };
    low: { problem: number; no_problem: number };
  };
  high_precision?: number;
  high_recall?: number;
  calibration: Array<{ predicted: RiskLevel; actual_problem_rate: number; n: number }>;
  flag_hit_rates: Record<string, { hits: number; total: number; rate: number }>;
  dependabot_split: {
    dependabot: { predictions: number; problems: number };
    human: { predictions: number; problems: number };
  };
  usage_summary: UsageReportSummary;
}

export interface MonthlyUsageRow {
  month: string;
  predictions: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export interface UsageReportSummary {
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  avg_input_tokens: number;
  avg_output_tokens: number;
  avg_cost_usd: number;
  by_month: MonthlyUsageRow[];
}
