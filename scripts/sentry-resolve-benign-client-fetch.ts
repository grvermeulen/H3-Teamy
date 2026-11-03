/**
 * Resolves unresolved Sentry issues whose titles are benign transient client fetch
 * noise (Chromium/WebKit/Firefox). Those events are dropped in `beforeSend` after
 * deploy; lingering issues are usually from pre-fix bundles or one-off previews.
 * Run from CI (Sentry Issue Sync) or locally with SENTRY_AUTH_TOKEN set.
 */
import { isBenignTransientClientFetchSentryIssueTitle } from "../src/lib/sentryBenignClientFetchNoise";

type SentryIssue = {
  id: string;
  title: string;
  status?: string;
};

const ORG = process.env.SENTRY_ORG ?? "h3-teamy";
const PROJECT = process.env.SENTRY_PROJECT ?? "javascript-nextjs";
const TOKEN = process.env.SENTRY_AUTH_TOKEN;

async function fetchUnresolvedIssues(): Promise<SentryIssue[]> {
  const url = new URL(
    `https://sentry.io/api/0/projects/${ORG}/${PROJECT}/issues/`,
  );
  url.searchParams.set("query", "is:unresolved");
  url.searchParams.set("statsPeriod", "14d");
  url.searchParams.set("limit", "50");

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sentry list issues failed (${res.status}): ${body}`);
  }
  const data: unknown = await res.json();
  if (!Array.isArray(data)) {
    throw new Error("Unexpected Sentry issues response (expected array)");
  }
  return data as SentryIssue[];
}

async function resolveIssue(issueId: string): Promise<void> {
  const res = await fetch(`https://sentry.io/api/0/issues/${issueId}/`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      status: "resolved",
      statusDetails: {
        inCommit: false,
        inNextRelease: false,
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Sentry resolve issue ${issueId} failed (${res.status}): ${body}`,
    );
  }
}

async function main(): Promise<void> {
  if (!TOKEN) {
    console.error("SENTRY_AUTH_TOKEN is required");
    process.exit(1);
  }

  const explicitIds = (process.env.SENTRY_RESOLVE_ISSUE_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  for (const issueId of explicitIds) {
    await resolveIssue(issueId);
    console.log(`Resolved explicit issue ${issueId}`);
  }

  const issues = await fetchUnresolvedIssues();
  const benignFetch = issues.filter((issue) =>
    isBenignTransientClientFetchSentryIssueTitle(issue.title),
  );

  if (benignFetch.length === 0) {
    console.log("No benign transient client fetch issues to resolve");
    return;
  }

  for (const issue of benignFetch) {
    await resolveIssue(issue.id);
    console.log(`Resolved ${issue.id}: ${issue.title}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
