/**
 * Injects a GitHub token into an HTTPS github.com remote URL.
 * Rejects non-github.com hosts (exact hostname match via URL parser).
 * @param remoteUrl - Origin remote URL from git.
 * @param token - GitHub token (optional).
 */
export function authenticatedRemoteUrl(
  remoteUrl: string,
  token?: string,
): string {
  const trimmed = remoteUrl.trim();
  if (!token) {
    return trimmed;
  }

  if (trimmed.startsWith("git@github.com:")) {
    const repoPath = trimmed.slice("git@github.com:".length);
    return `https://x-access-token:${token}@github.com/${repoPath}`;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
      return trimmed;
    }
    parsed.username = "x-access-token";
    parsed.password = token;
    return parsed.toString();
  } catch {
    return trimmed;
  }
}
