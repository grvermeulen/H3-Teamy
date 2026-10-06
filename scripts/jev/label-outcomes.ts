#!/usr/bin/env tsx
/**
 * Labels post-merge outcomes for merged PRs (>= 7 days old).
 */
import { join } from "node:path";
import { labeledPrNumbers } from "@/lib/jev/dataset";
import {
  classifyOutcome,
  filterFollowUpsWithinDays,
} from "@/lib/jev/outcomeLabeling";
import { OUTCOMES_FILE, PREDICTIONS_FILE } from "@/lib/jev/types";
import type { OutcomeRecord, PredictionRecord } from "@/lib/jev/types";
import { parseJsonl } from "@/lib/jev/dataset";
import { readFileSync, existsSync } from "node:fs";
import { commitOutcomes, ensureDatasetWorktree } from "./datasetStore";

const WORKTREE_DIR = join(process.cwd(), ".jev-data-worktree");
const GH = "https://api.github.com";

async function main(): Promise<void> {
  const token = process.env.GITHUB_TOKEN?.trim();
  const repo = process.env.GITHUB_REPOSITORY?.trim();
  if (!token || !repo) {
    console.log("Missing GitHub env — skip.");
    return;
  }

  ensureDatasetWorktree(process.cwd(), WORKTREE_DIR);

  const predictionsPath = join(WORKTREE_DIR, PREDICTIONS_FILE);
  const outcomesPath = join(WORKTREE_DIR, OUTCOMES_FILE);
  const predictions = existsSync(predictionsPath)
    ? parseJsonl<PredictionRecord>(readFileSync(predictionsPath, "utf8"))
    : [];
  const existingOutcomes = existsSync(outcomesPath)
    ? parseJsonl<OutcomeRecord>(readFileSync(outcomesPath, "utf8"))
    : [];
  const alreadyLabeled = labeledPrNumbers(existingOutcomes);

  const mergedPrs = await listMergedPrs(token, repo, "image");
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const candidates = mergedPrs.filter((pr) => {
    const mergedAt = new Date(pr.merged_at).getTime();
    return mergedAt <= cutoff && !alreadyLabeled.has(pr.number);
  });

  if (candidates.length === 0) {
    console.log("No PRs ready for outcome labeling.");
    return;
  }

  const newOutcomes: OutcomeRecord[] = [];

  for (const pr of candidates) {
    const files = await listPrFiles(token, repo, pr.number);
    const labels = await listIssueLabels(token, repo, pr.number);
    const revertRefs = await findRevertRefs(token, repo, pr.number, pr.title);
    const followUps = await findFollowUpPrs(token, repo, pr.merged_at, files);
    const failedChecks = await getFailedChecksOnMerge(
      token,
      repo,
      pr.merge_commit_sha,
    );
    const vercelFailure = await getVercelProductionFailure(
      token,
      repo,
      pr.merge_commit_sha,
    );

    const outcome = classifyOutcome(
      {
        mergedPr: {
          number: pr.number,
          merge_commit_sha: pr.merge_commit_sha,
          merged_at: pr.merged_at,
          title: pr.title,
          labels,
          changed_files: files,
        },
        revertPrNumbers: revertRefs.prNumbers,
        revertCommitShas: revertRefs.shas,
        followUpPrs: followUps,
        failedCheckNames: failedChecks,
        vercelProductionFailure: vercelFailure.failed,
        vercelDeploymentUrl: vercelFailure.url,
      },
      predictions,
    );
    newOutcomes.push(outcome);
  }

  if (newOutcomes.length > 0) {
    commitOutcomes(
      process.cwd(),
      WORKTREE_DIR,
      newOutcomes,
      `jev: label ${newOutcomes.length} outcomes`,
    );
    console.log(`Labeled ${newOutcomes.length} outcomes.`);
  }
}

async function ghGet(
  token: string,
  path: string,
): Promise<Response> {
  return fetch(`${GH}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "jev-outcome-labeling",
    },
  });
}

async function listMergedPrs(
  token: string,
  repo: string,
  base: string,
): Promise<
  Array<{
    number: number;
    title: string;
    merged_at: string;
    merge_commit_sha: string;
  }>
> {
  const res = await ghGet(
    token,
    `/repos/${repo}/pulls?state=closed&base=${base}&sort=updated&direction=desc&per_page=100`,
  );
  const prs = (await res.json()) as Array<{
    number: number;
    title: string;
    merged_at: string | null;
    merge_commit_sha: string | null;
  }>;
  return prs
    .filter((p) => p.merged_at && p.merge_commit_sha)
    .map((p) => ({
      number: p.number,
      title: p.title,
      merged_at: p.merged_at!,
      merge_commit_sha: p.merge_commit_sha!,
    }));
}

async function listPrFiles(
  token: string,
  repo: string,
  prNumber: number,
): Promise<string[]> {
  const res = await ghGet(
    token,
    `/repos/${repo}/pulls/${prNumber}/files?per_page=100`,
  );
  const files = (await res.json()) as Array<{ filename: string }>;
  return files.map((f) => f.filename);
}

async function listIssueLabels(
  token: string,
  repo: string,
  issueNumber: number,
): Promise<string[]> {
  const res = await ghGet(token, `/repos/${repo}/issues/${issueNumber}`);
  const issue = (await res.json()) as { labels: Array<{ name: string }> };
  return (issue.labels ?? []).map((l) => l.name);
}

async function findRevertRefs(
  token: string,
  repo: string,
  prNumber: number,
  title: string,
): Promise<{ prNumbers: number[]; shas: string[] }> {
  const q = encodeURIComponent(
    `repo:${repo} is:pr is:merged revert ${prNumber} in:body,title`,
  );
  const res = await ghGet(token, `/search/issues?q=${q}&per_page=20`);
  const data = (await res.json()) as {
    items: Array<{ number: number; pull_request?: unknown }>;
  };
  const prNumbers = (data.items ?? [])
    .filter((i) => i.pull_request)
    .map((i) => i.number);

  const commitRes = await ghGet(
    token,
    `/repos/${repo}/commits?per_page=30`,
  );
  const commits = (await commitRes.json()) as Array<{
    sha: string;
    commit: { message: string };
  }>;
  const shas = commits
    .filter(
      (c) =>
        /\brevert\b/i.test(c.commit.message) &&
        (c.commit.message.includes(`#${prNumber}`) ||
          c.commit.message.toLowerCase().includes(title.toLowerCase().slice(0, 40))),
    )
    .map((c) => c.sha);

  return { prNumbers, shas };
}

async function findFollowUpPrs(
  token: string,
  repo: string,
  mergedAt: string,
  originalFiles: string[],
): Promise<Array<{ number: number; title: string; files: string[] }>> {
  const res = await ghGet(
    token,
    `/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=50`,
  );
  const prs = (await res.json()) as Array<{
    number: number;
    title: string;
    merged_at: string | null;
  }>;

  const within = filterFollowUpsWithinDays(
    prs.filter((p) => p.merged_at).map((p) => ({
      number: p.number,
      title: p.title,
      merged_at: p.merged_at!,
    })),
    mergedAt,
    7,
  );

  const result: Array<{ number: number; title: string; files: string[] }> = [];
  for (const pr of within) {
    const files = await listPrFiles(token, repo, pr.number);
    const overlap = files.some((f) => originalFiles.includes(f));
    if (overlap) {
      result.push({ number: pr.number, title: pr.title, files });
    }
  }
  return result;
}

async function getFailedChecksOnMerge(
  token: string,
  repo: string,
  sha: string,
): Promise<string[]> {
  const res = await ghGet(
    token,
    `/repos/${repo}/commits/${sha}/check-runs?per_page=100`,
  );
  const data = (await res.json()) as {
    check_runs: Array<{ name: string; conclusion: string | null }>;
  };
  return (data.check_runs ?? [])
    .filter((c) => c.conclusion === "failure" || c.conclusion === "timed_out")
    .map((c) => c.name);
}

async function getVercelProductionFailure(
  token: string,
  repo: string,
  sha: string,
): Promise<{ failed: boolean; url?: string }> {
  const res = await ghGet(
    token,
    `/repos/${repo}/commits/${sha}/status`,
  );
  const status = (await res.json()) as {
    state: string;
    statuses: Array<{
      context: string;
      state: string;
      target_url?: string;
      description?: string;
    }>;
  };
  const vercel = (status.statuses ?? []).find(
    (s) =>
      /vercel/i.test(s.context) &&
      /production/i.test(s.context + (s.description ?? "")),
  );
  if (!vercel) {
    return { failed: false };
  }
  return {
    failed: vercel.state === "failure" || vercel.state === "error",
    url: vercel.target_url,
  };
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.warn("Outcome labeling error:", err);
    process.exit(0);
  });
