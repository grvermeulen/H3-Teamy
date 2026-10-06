#!/usr/bin/env tsx
/**
 * Generates JEV calibration report from jev-risk-data branch JSONL files.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseJsonl } from "@/lib/jev/dataset";
import { computeReportMetrics, formatReportMarkdown } from "@/lib/jev/report";
import { JEV_DATA_BRANCH, OUTCOMES_FILE, PREDICTIONS_FILE } from "@/lib/jev/types";
import type { OutcomeRecord, PredictionRecord } from "@/lib/jev/types";

const DATA_DIR = process.env.JEV_DATA_DIR ?? join(process.cwd(), ".jev-report-data");
const SUMMARY_PATH = process.env.GITHUB_STEP_SUMMARY;

function main(): void {
  fetchDataset(DATA_DIR);

  const predictionsPath = join(DATA_DIR, PREDICTIONS_FILE);
  const outcomesPath = join(DATA_DIR, OUTCOMES_FILE);

  const predictions = existsSync(predictionsPath)
    ? parseJsonl<PredictionRecord>(readFileSync(predictionsPath, "utf8"))
    : [];
  const outcomes = existsSync(outcomesPath)
    ? parseJsonl<OutcomeRecord>(readFileSync(outcomesPath, "utf8"))
    : [];

  const metrics = computeReportMetrics(predictions, outcomes);
  const markdown = formatReportMarkdown(metrics);

  console.log(markdown);

  if (SUMMARY_PATH) {
    writeFileSync(SUMMARY_PATH, markdown, "utf8");
  }
}

function fetchDataset(dir: string): void {
  mkdirSync(dir, { recursive: true });
  try {
    execSync(`git fetch origin ${JEV_DATA_BRANCH} 2>/dev/null || true`, {
      stdio: "pipe",
    });
    for (const file of [PREDICTIONS_FILE, OUTCOMES_FILE]) {
      try {
        const content = execSync(
          `git show origin/${JEV_DATA_BRANCH}:${file} 2>/dev/null || true`,
          { encoding: "utf8" },
        );
        writeFileSync(join(dir, file), content, "utf8");
      } catch {
        writeFileSync(join(dir, file), "", "utf8");
      }
    }
  } catch {
    console.warn(`Could not fetch ${JEV_DATA_BRANCH}; reporting on empty dataset.`);
  }
}

main();
