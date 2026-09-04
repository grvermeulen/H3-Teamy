import { isEphemeralVercelPreviewUrl } from "./sentryEphemeralVercelUrl";

const DOWNTIME_TITLE_PREFIX = /^Downtime detected for\s+/i;

/**
 * Extracts the monitored URL from a Sentry Uptime issue title.
 *
 * @param title - Issue title, e.g. `Downtime detected for https://…vercel.app`.
 */
export function extractUptimeUrlFromIssueTitle(
  title: string,
): string | undefined {
  const match = DOWNTIME_TITLE_PREFIX.exec(title.trim());
  if (!match) return undefined;
  const rest = title.trim().slice(match[0].length).trim();
  return rest || undefined;
}

/**
 * Sentry Uptime alerts on removed Vercel preview deployments are expected noise:
 * previews return 410 GONE after the branch/PR is gone while monitors may linger.
 *
 * @param title - Sentry issue title.
 */
export function isEphemeralPreviewUptimeDowntimeIssue(title: string): boolean {
  const monitored = extractUptimeUrlFromIssueTitle(title);
  if (!monitored) return false;
  return isEphemeralVercelPreviewUrl(monitored);
}
