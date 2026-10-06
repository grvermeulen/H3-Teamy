import { isLockfilePath, summarizeLockfileChanges } from "./lockfileSummary";
import { matchSensitivePaths, REPO_CONTEXT } from "./sensitivePaths";
import type { JevState, PrFileChange } from "./types";

const BINARY_OR_GENERATED = [
  /\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|eot|glb|gltf|mp3|wav|ogg|zip|pdf)$/i,
  /^public\/arena\/map\//,
  /^\.next\//,
  /^node_modules\//,
  /^coverage\//,
  /\.min\.(js|css)$/,
];

/** Approximate token count (chars / 4) for JEV budget checks. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Max tokens reserved for the state payload (32k total minus question headroom). */
export const STATE_TOKEN_BUDGET = 24_000;

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
  tokenBudget?: number;
}

/**
 * Builds the JEV evaluation state from PR metadata, applying lockfile summarization and diff truncation.
 * @param input - PR fields and raw unified diff.
 */
export function buildJevState(input: BuildStateInput): JevState {
  const tokenBudget = input.tokenBudget ?? STATE_TOKEN_BUDGET;
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
  const { diff, truncated } = truncateDiffToBudget(filteredDiff, tokenBudget, {
    title: input.title,
    body,
    author: input.author,
    labels: input.labels,
    paths,
    lockfileSummaries,
  });

  const state: JevState = {
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
    diff,
  };

  if (Object.keys(lockfileSummaries).length > 0) {
    state.lockfile_summaries = lockfileSummaries;
  }
  if (truncated) {
    state.truncation_note =
      "Diff truncated to fit JEV token budget; lockfiles summarized separately.";
  }

  return state;
}

/**
 * Trims PR body to a reasonable length for the model.
 * @param body - Raw PR body markdown.
 */
export function trimBody(body: string, maxChars = 4000): string {
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

function truncateDiffToBudget(
  diff: string,
  tokenBudget: number,
  overhead: {
    title: string;
    body: string;
    author: string;
    labels: string[];
    paths: string[];
    lockfileSummaries: Record<string, string[]>;
  },
): { diff: string; truncated: boolean } {
  const overheadJson = JSON.stringify({
    title: overhead.title,
    body: overhead.body,
    author: overhead.author,
    labels: overhead.labels,
    changed_files: overhead.paths,
    lockfile_summaries: overhead.lockfileSummaries,
    repo_context: REPO_CONTEXT,
  });
  const overheadTokens = estimateTokens(overheadJson);
  const diffBudget = Math.max(2000, tokenBudget - overheadTokens);

  if (estimateTokens(diff) <= diffBudget) {
    return { diff, truncated: false };
  }

  const maxChars = diffBudget * 4;
  return {
    diff: `${diff.slice(0, maxChars)}\n\n[diff truncated for token budget]`,
    truncated: true,
  };
}
