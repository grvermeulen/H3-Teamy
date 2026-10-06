import { isLockfilePath, summarizeLockfileChanges } from "./lockfileSummary";
import { matchSensitivePaths, REPO_CONTEXT } from "./sensitivePaths";
import {
  estimateJsonTokens,
  estimateTokens,
  MAX_STATE_TOKENS,
} from "./stateBudget";
import type { JevState, PrFileChange } from "./types";

const BINARY_OR_GENERATED = [
  /\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|eot|glb|gltf|mp3|wav|ogg|zip|pdf)$/i,
  /^public\/arena\/map\//,
  /^\.next\//,
  /^node_modules\//,
  /^coverage\//,
  /\.min\.(js|css)$/,
];

/**
 * Returns true when a file should be omitted from the diff (binary/generated).
 * @param filename - Path relative to repo root.
 */
export function isSkippedFile(filename: string): boolean {
  return BINARY_OR_GENERATED.some((re) => re.test(filename));
}

export interface BuildStateInput {
  title: string;
  body: string;
  author: string;
  labels: string[];
  files: PrFileChange[];
  diff: string;
  maxStateTokens?: number;
}

/**
 * Builds the JEV evaluation state from PR metadata, applying lockfile summarization and diff truncation.
 * @param input - PR fields and raw unified diff.
 */
export function buildJevState(input: BuildStateInput): JevState {
  const maxStateTokens = input.maxStateTokens ?? MAX_STATE_TOKENS;
  const targetTokens = maxStateTokens - 200;
  const body = trimBody(input.body);
  const paths = input.files.map((f) => f.filename);
  const lockfileSummaries: Record<string, string[]> = {};

  for (const file of input.files) {
    if (!isLockfilePath(file.filename)) {
      continue;
    }
    const source = file.patch ?? extractFileDiff(input.diff, file.filename);
    if (source) {
      lockfileSummaries[file.filename] = summarizeLockfileChanges(
        file.filename,
        source,
      );
    }
  }

  const filteredDiff = filterDiff(input.diff, input.files);
  let diff = filteredDiff;
  let truncated = false;

  const baseState = (): Omit<JevState, "diff" | "truncation_note"> => ({
    title: input.title,
    body,
    author: input.author,
    labels: input.labels,
    changed_files: input.files
      .filter((f) => !isSkippedFile(f.filename))
      .map((f) => ({
        path: f.filename,
        additions: f.additions,
        deletions: f.deletions,
      })),
    sensitive_paths: matchSensitivePaths(paths),
    repo_context: REPO_CONTEXT,
    ...(Object.keys(lockfileSummaries).length > 0
      ? { lockfile_summaries: lockfileSummaries }
      : {}),
  });

  // Iteratively shrink diff until serialized state fits the 32k state+question cap.
  let low = 0;
  let high = diff.length;
  let bestDiff = "";
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate =
      mid >= diff.length
        ? diff
        : `${diff.slice(0, mid)}\n\n[diff truncated for token budget]`;
    const state: JevState = { ...baseState(), diff: candidate };
    const tokens = estimateJsonTokens(state);
    if (tokens <= targetTokens) {
      bestDiff = candidate;
      truncated = mid < diff.length;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (!bestDiff && diff.length > 0) {
    bestDiff = "[diff omitted — PR too large for JEV state budget]";
    truncated = true;
  }

  let state: JevState = { ...baseState(), diff: bestDiff };
  while (estimateJsonTokens(state) > targetTokens && state.diff.length > 0) {
    truncated = true;
    const nextLen = Math.floor(state.diff.length * 0.9);
    state = {
      ...state,
      diff:
        nextLen <= 0
          ? "[diff omitted — PR too large for JEV state budget]"
          : `${state.diff.slice(0, nextLen)}\n\n[diff truncated for token budget]`,
    };
  }

  if (truncated) {
    state.truncation_note =
      "Diff truncated to fit JEV token budget (32k state + questions); lockfiles summarized separately.";
  }
  return state;
}

/**
 * Trims PR body to a reasonable length for the model.
 * @param body - Raw PR body markdown.
 */
export function trimBody(body: string, maxChars = 3000): string {
  const trimmed = body.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxChars)}\n\n[body truncated]`;
}

function extractFileDiff(diff: string, filename: string): string {
  const marker = `diff --git a/${filename} b/${filename}`;
  const start = diff.indexOf(marker);
  if (start < 0) {
    return "";
  }
  const next = diff.indexOf("\ndiff --git ", start + 1);
  return next < 0 ? diff.slice(start) : diff.slice(start, next);
}

function filterDiff(diff: string, files: PrFileChange[]): string {
  const skip = new Set(
    files
      .filter(
        (f) =>
          isSkippedFile(f.filename) ||
          isLockfilePath(f.filename) ||
          (f.status === "removed" &&
            BINARY_OR_GENERATED.some((re) => re.test(f.filename))),
      )
      .map((f) => f.filename),
  );

  if (skip.size === 0) {
    return diff;
  }

  const parts: string[] = [];
  const fileDiffs = diff.split(/\n(?=diff --git )/);
  for (const part of fileDiffs) {
    const pathMatch = part.match(/^diff --git a\/(.+?) b\//);
    const path = pathMatch?.[1];
    if (path && skip.has(path)) {
      parts.push(
        `diff --git a/${path} b/${path}\n[omitted: lockfile/binary/generated — see lockfile_summaries or changed_files]`,
      );
      continue;
    }
    if (path && isLockfilePath(path)) {
      parts.push(
        `diff --git a/${path} b/${path}\n[omitted lockfile hunks — see lockfile_summaries]`,
      );
      continue;
    }
    parts.push(part);
  }
  return parts.join("\n");
}
