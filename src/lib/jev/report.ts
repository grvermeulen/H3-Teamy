import type {
  OutcomeRecord,
  PredictionRecord,
  ReportMetrics,
  RiskLevel,
} from "./types";

export interface JoinedRecord {
  prediction: PredictionRecord;
  outcome?: OutcomeRecord;
}

/**
 * Joins final predictions with outcomes by PR number.
 * @param predictions - All prediction records.
 * @param outcomes - Labeled outcome records.
 */
export function joinPredictionsWithOutcomes(
  predictions: PredictionRecord[],
  outcomes: OutcomeRecord[],
): JoinedRecord[] {
  const finals = predictions.filter((p) => p.final_before_merge);
  const outcomeByPr = new Map(outcomes.map((o) => [o.pr_number, o]));
  return finals.map((p) => ({
    prediction: p,
    outcome: outcomeByPr.get(p.pr_number),
  }));
}

/**
 * Computes report metrics for JEV calibration analysis.
 * @param predictions - Prediction dataset.
 * @param outcomes - Outcome dataset.
 * @param minSample - Minimum pairs before reporting precision/recall (default 5).
 */
export function computeReportMetrics(
  predictions: PredictionRecord[],
  outcomes: OutcomeRecord[],
  minSample = 5,
): ReportMetrics {
  const joined = joinPredictionsWithOutcomes(predictions, outcomes);
  const labeled = joined.filter((j) => j.outcome);

  const confusion = {
    high_or_medium: { problem: 0, no_problem: 0 },
    low: { problem: 0, no_problem: 0 },
  };

  let highTp = 0;
  let highFp = 0;
  let highFn = 0;

  const calibrationBuckets: Record<
    RiskLevel,
    { problems: number; total: number }
  > = {
    low: { problems: 0, total: 0 },
    medium: { problems: 0, total: 0 },
    high: { problems: 0, total: 0 },
  };

  const flagTotals: Record<string, { hits: number; total: number }> = {
    security_concern: { hits: 0, total: 0 },
    data_migration_risk: { hits: 0, total: 0 },
    likely_runtime_regression: { hits: 0, total: 0 },
    test_coverage_adequate: { hits: 0, total: 0 },
  };

  const dependabotSplit = {
    dependabot: { predictions: 0, problems: 0 },
    human: { predictions: 0, problems: 0 },
  };

  for (const { prediction, outcome } of labeled) {
    if (!outcome) {
      continue;
    }
    const risk = getRiskLevel(prediction) ?? "low";
    const problem = outcome.had_problem;
    const bucket = risk === "low" ? "low" : "high_or_medium";
    if (problem) {
      confusion[bucket].problem += 1;
    } else {
      confusion[bucket].no_problem += 1;
    }

    calibrationBuckets[risk].total += 1;
    if (problem) {
      calibrationBuckets[risk].problems += 1;
    }

    if (risk === "high") {
      if (problem) {
        highTp += 1;
      } else {
        highFp += 1;
      }
    } else if (problem) {
      highFn += 1;
    }

    for (const [flag, stats] of Object.entries(flagTotals)) {
      const answer = prediction.jev_answers[flag];
      if (!answer || answer.type !== "noul") {
        continue;
      }
      stats.total += 1;
      const flagged = answer.noul >= 0.5;
      const predictedProblem =
        flag === "test_coverage_adequate" ? !flagged : flagged;
      if (predictedProblem === problem) {
        stats.hits += 1;
      }
    }

    const splitKey = prediction.is_dependabot ? "dependabot" : "human";
    dependabotSplit[splitKey].predictions += 1;
    if (problem) {
      dependabotSplit[splitKey].problems += 1;
    }
  }

  const n = labeled.length;
  const metrics: ReportMetrics = {
    prediction_count: predictions.length,
    outcome_count: outcomes.length,
    labeled_pairs: n,
    too_small: n < minSample,
    confusion_matrix: confusion,
    calibration: (["low", "medium", "high"] as RiskLevel[]).map((level) => ({
      predicted: level,
      actual_problem_rate:
        calibrationBuckets[level].total > 0
          ? calibrationBuckets[level].problems / calibrationBuckets[level].total
          : 0,
      n: calibrationBuckets[level].total,
    })),
    flag_hit_rates: Object.fromEntries(
      Object.entries(flagTotals).map(([flag, s]) => [
        flag,
        {
          hits: s.hits,
          total: s.total,
          rate: s.total > 0 ? s.hits / s.total : 0,
        },
      ]),
    ),
    dependabot_split: dependabotSplit,
  };

  if (!metrics.too_small) {
    metrics.high_precision =
      highTp + highFp > 0 ? highTp / (highTp + highFp) : undefined;
    metrics.high_recall =
      highTp + highFn > 0 ? highTp / (highTp + highFn) : undefined;
  }

  return metrics;
}

/**
 * Renders a markdown report suitable for CI job summary or local CLI output.
 * @param metrics - Computed report metrics.
 */
export function formatReportMarkdown(metrics: ReportMetrics): string {
  const lines = [
    "# JEV PR-risico rapport",
    "",
    `Predictions: ${metrics.prediction_count} · Outcomes: ${metrics.outcome_count} · Gekoppelde paren: ${metrics.labeled_pairs}`,
    "",
  ];

  if (metrics.too_small) {
    lines.push(
      "> **Let op:** N te klein voor betrouwbare precision/recall (minimaal 5 gekoppelde paren aanbevolen).",
      "",
    );
  }

  lines.push(
    "## Confusion matrix (risk high/medium vs low)",
    "",
    "| Voorspeld | Probleem | Geen probleem |",
    "|-----------|----------|---------------|",
    `| high/medium | ${metrics.confusion_matrix.high_or_medium.problem} | ${metrics.confusion_matrix.high_or_medium.no_problem} |`,
    `| low | ${metrics.confusion_matrix.low.problem} | ${metrics.confusion_matrix.low.no_problem} |`,
    "",
  );

  if (metrics.high_precision !== undefined) {
    lines.push(
      `**Precision (high):** ${(metrics.high_precision * 100).toFixed(1)}%`,
    );
  }
  if (metrics.high_recall !== undefined) {
    lines.push(
      `**Recall (high):** ${(metrics.high_recall * 100).toFixed(1)}%`,
    );
  }
  lines.push("");

  lines.push("## Kalibratie per risiconiveau", "");
  for (const row of metrics.calibration) {
    lines.push(
      `- **${row.predicted}**: ${(row.actual_problem_rate * 100).toFixed(1)}% problemen (n=${row.n})`,
    );
  }
  lines.push("");

  lines.push("## Flag hit rates", "");
  for (const [flag, stats] of Object.entries(metrics.flag_hit_rates)) {
    lines.push(
      `- **${flag}**: ${(stats.rate * 100).toFixed(1)}% (${stats.hits}/${stats.total})`,
    );
  }
  lines.push("");

  lines.push("## Dependabot vs mens", "");
  lines.push(
    `- Dependabot: ${metrics.dependabot_split.dependabot.problems}/${metrics.dependabot_split.dependabot.predictions} problemen`,
  );
  lines.push(
    `- Mens: ${metrics.dependabot_split.human.problems}/${metrics.dependabot_split.human.predictions} problemen`,
  );

  return lines.join("\n");
}

function getRiskLevel(prediction: PredictionRecord): RiskLevel | undefined {
  const answer = prediction.jev_answers.risk_level;
  if (answer?.type === "choice") {
    const c = answer.choice;
    if (c === "low" || c === "medium" || c === "high") {
      return c;
    }
  }
  return undefined;
}
