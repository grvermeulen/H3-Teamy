/**
 * Vercel preview hostnames include `-git-` between project slug and team suffix.
 * @see https://vercel.com/docs/deployments/generated-urls
 */
const EPHEMERAL_VERCEL_PREVIEW_HOST =
  /^[a-z0-9-]+-git-[a-z0-9-]+-[a-z0-9-]+\.vercel\.app$/i;

/**
 * Returns whether a hostname is an ephemeral Vercel preview deployment URL
 * (not production or a stable custom domain).
 *
 * @param hostname - Host without scheme, e.g. `h3-teamy-git-branch-team.vercel.app`.
 */
export function isEphemeralVercelPreviewHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return false;
  return EPHEMERAL_VERCEL_PREVIEW_HOST.test(host);
}

/**
 * Parses `http(s)://host` from a string and returns the hostname, if any.
 *
 * @param value - Full URL or host-only string.
 */
export function hostnameFromUrlOrHost(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  try {
    const withScheme = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const parsed = new URL(withScheme);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    return parsed.hostname.toLowerCase();
  } catch {
    const hostOnly = trimmed.replace(/^https?:\/\//i, "").split("/")[0];
    return hostOnly ? hostOnly.toLowerCase() : undefined;
  }
}

/**
 * Returns whether `value` points at an ephemeral Vercel preview deployment.
 *
 * @param value - URL or hostname.
 */
export function isEphemeralVercelPreviewUrl(value: string): boolean {
  const host = hostnameFromUrlOrHost(value);
  if (!host) return false;
  return isEphemeralVercelPreviewHostname(host);
}
