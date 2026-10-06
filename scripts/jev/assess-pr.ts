#!/usr/bin/env tsx
/**
 * JEV PR risk assessment — runs in GitHub Actions on pull_request.
 * Never exits non-zero (non-blocking for CI / Dependabot auto-merge).
 */
import { join } from "node:path";
import { buildJevState } from "@/lib/jev/buildState";
import {
  estimateJsonTokens,
  estimateRequestTokens,
  estimateStatePlusLongestQuestion,
  MAX_STATE_TOKENS,
} from "@/lib/jev/stateBudget";
import { formatJevPrComment, formatJevUnavailableComment } from "@/lib/jev/formatComment";
import { callJevApi, isMaxTokensExceededError } from "@/lib/jev/jevClient";
import { buildJevRequest } from "@/lib/jev/questions";
import { matchSensitivePaths } from "@/lib/jev/sensitivePaths";
import { JEV_COMMENT_MARKER } from "@/lib/jev/types";
import type { PredictionRecord } from "@/lib/jev/types";
import {
  commitPrediction,
  ensureDatasetWorktree,
} from "./datasetStore";
import {
  fetchPrDiff,
  listPrFiles,
  upsertJevComment,
} from "./github";

const WORKTREE_DIR = join(process.cwd(), ".jev-data-worktree");

async function main(): Promise<void> {
  const apiKey = process.env.JEV_API_KEY?.trim();
  const token = process.env.GITHUB_TOKEN?.trim();
  const repo = process.env.GITHUB_REPOSITORY?.trim();
  const prNumber = Number(process.env.PR_NUMBER);
  const isFork = process.env.IS_FORK === "true";

  if (isFork) {
    console.log("Fork PR — skipping JEV assessment.");
    return;
  }

  if (!token || !repo || !prNumber) {
    console.warn("Missing GITHUB_TOKEN, GITHUB_REPOSITORY, or PR_NUMBER — skip.");
    return;
  }

  const client = { token, repo };

  if (!apiKey) {
    console.log("JEV_API_KEY not configured — posting unavailable comment.");
    await safeUpsertComment(
      client,
      prNumber,
      formatJevUnavailableComment("API-sleutel niet geconfigureerd"),
    );
    return;
  }

  try {
    const pr = await fetchPr(client, prNumber);
    const files = await listPrFiles(client, prNumber);
    const diff = await fetchPrDiff(client, prNumber);
    const labels = (pr.labels ?? []).map(
      (l: { name: string }) => l.name,
    );

    const stateInput = {
      title: pr.title,
      body: pr.body ?? "",
      author: pr.user?.login ?? "unknown",
      labels,
      files,
      diff,
    };

    let state = buildJevState(stateInput);
    logTokenEstimates(state);

    let requestBody = buildJevRequest(state);
    let response;
    try {
      response = await callJevApi(requestBody, { apiKey });
    } catch (firstErr: unknown) {
      if (!isMaxTokensExceededError(firstErr)) {
        throw firstErr;
      }
      console.warn("JEV max_tokens_exceeded — rebuilding state at 60% budget");
      state = buildJevState({
        ...stateInput,
        maxStateTokens: Math.floor(MAX_STATE_TOKENS * 0.6),
      });
      logTokenEstimates(state);
      requestBody = buildJevRequest(state);
      response = await callJevApi(requestBody, { apiKey });
    }
    console.log(
      `JEV answers: ${JSON.stringify({
        risk_level: response.answers.risk_level,
        severity: response.answers.severity,
        security_concern: response.answers.security_concern,
        data_migration_risk: response.answers.data_migration_risk,
        likely_runtime_regression: response.answers.likely_runtime_regression,
        test_coverage_adequate: response.answers.test_coverage_adequate,
      })}`,
    );
    const sensitive = matchSensitivePaths(files.map((f) => f.filename));
    const comment = formatJevPrComment(response, sensitive);
    await upsertJevComment(client, prNumber, JEV_COMMENT_MARKER, comment);

    const record: PredictionRecord = {
      pr_number: prNumber,
      head_sha: pr.head?.sha ?? "unknown",
      base: pr.base?.ref ?? "image",
      author: pr.user?.login ?? "unknown",
      is_dependabot: pr.user?.login === "dependabot[bot]",
      title: pr.title,
      changed_paths_summary: files.map((f) => f.filename),
      sensitive_paths: sensitive,
      jev_answers: response.answers,
      model: response.model,
      usage: response.usage,
      assessed_at: new Date().toISOString(),
      workflow_run_id: process.env.GITHUB_RUN_ID
        ? Number(process.env.GITHUB_RUN_ID)
        : undefined,
    };

    try {
      ensureDatasetWorktree(process.cwd(), WORKTREE_DIR);
      commitPrediction(
        process.cwd(),
        WORKTREE_DIR,
        record,
        `jev: prediction PR #${prNumber} @ ${record.head_sha.slice(0, 7)}`,
      );
    } catch (datasetErr: unknown) {
      const msg =
        datasetErr instanceof Error ? datasetErr.message : String(datasetErr);
      console.warn(`Dataset commit failed (non-fatal): ${msg}`);
    }

    console.log(`JEV assessment complete for PR #${prNumber}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`JEV assessment failed: ${msg}`);
    await safeUpsertComment(
      client,
      prNumber,
      formatJevUnavailableComment(msg.slice(0, 200)),
    );
  }
}

async function fetchPr(
  client: { token: string; repo: string },
  prNumber: number,
): Promise<{
  title: string;
  body?: string;
  user?: { login: string };
  head?: { sha: string };
  base?: { ref: string };
  labels?: Array<{ name: string }>;
}> {
  const res = await fetch(
    `https://api.github.com/repos/${client.repo}/pulls/${prNumber}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${client.token}`,
        "User-Agent": "jev-pr-risk",
      },
    },
  );
  if (!res.ok) {
    throw new Error(`GitHub PR ${res.status}`);
  }
  return res.json() as Promise<{
    title: string;
    body?: string;
    user?: { login: string };
    head?: { sha: string };
    base?: { ref: string };
    labels?: Array<{ name: string }>;
  }>;
}

function logTokenEstimates(state: ReturnType<typeof buildJevState>): void {
  console.log(
    `JEV state ~${estimateJsonTokens(state)} tokens, state+longest-question ~${estimateStatePlusLongestQuestion(state)} (cap 32000), full request ~${estimateRequestTokens(state)}`,
  );
}

async function safeUpsertComment(
  client: { token: string; repo: string },
  prNumber: number,
  body: string,
): Promise<void> {
  try {
    await upsertJevComment(client, prNumber, JEV_COMMENT_MARKER, body);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`Could not post JEV comment: ${msg}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.warn("Unexpected JEV error:", err);
    process.exit(0);
  });
