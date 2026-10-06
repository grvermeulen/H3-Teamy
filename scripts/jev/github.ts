const GH_API = "https://api.github.com";

export interface GitHubClient {
  token: string;
  repo: string;
  fetchFn?: typeof fetch;
}

function ghFetch(
  client: GitHubClient,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const fetchFn = client.fetchFn ?? fetch;
  return fetchFn(`${GH_API}/repos/${client.repo}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${client.token}`,
      "User-Agent": "jev-pr-risk",
      ...(init.headers ?? {}),
    },
  });
}

/**
 * Lists changed files for a pull request.
 * @param client - GitHub API client config.
 * @param prNumber - Pull request number.
 */
export async function listPrFiles(
  client: GitHubClient,
  prNumber: number,
): Promise<
  Array<{
    filename: string;
    additions: number;
    deletions: number;
    patch?: string;
    status?: string;
  }>
> {
  const res = await ghFetch(client, `/pulls/${prNumber}/files?per_page=100`);
  if (!res.ok) {
    throw new Error(`GitHub files ${res.status}`);
  }
  const files = (await res.json()) as Array<{
    filename: string;
    additions: number;
    deletions: number;
    patch?: string;
    status?: string;
  }>;
  return files;
}

/**
 * Fetches unified diff for a pull request.
 * @param client - GitHub API client config.
 * @param prNumber - Pull request number.
 */
export async function fetchPrDiff(
  client: GitHubClient,
  prNumber: number,
): Promise<string> {
  const fetchFn = client.fetchFn ?? fetch;
  const res = await fetchFn(
    `${GH_API}/repos/${client.repo}/pulls/${prNumber}`,
    {
      headers: {
        Accept: "application/vnd.github.v3.diff",
        Authorization: `Bearer ${client.token}`,
        "User-Agent": "jev-pr-risk",
      },
    },
  );
  if (!res.ok) {
    throw new Error(`GitHub diff ${res.status}`);
  }
  return res.text();
}

/**
 * Finds an existing JEV comment by marker, or returns undefined.
 * @param client - GitHub API client config.
 * @param prNumber - Pull request number.
 * @param marker - Hidden HTML comment marker.
 */
export async function findJevComment(
  client: GitHubClient,
  prNumber: number,
  marker: string,
): Promise<{ id: number; body: string } | undefined> {
  const res = await ghFetch(
    client,
    `/issues/${prNumber}/comments?per_page=100`,
  );
  if (!res.ok) {
    throw new Error(`GitHub comments ${res.status}`);
  }
  const comments = (await res.json()) as Array<{ id: number; body: string }>;
  return comments.find((c) => c.body.includes(marker));
}

/**
 * Creates or updates the sticky JEV PR comment.
 * @param client - GitHub API client config.
 * @param prNumber - Pull request number.
 * @param marker - Hidden marker to find existing comment.
 * @param body - Full comment markdown.
 */
export async function upsertJevComment(
  client: GitHubClient,
  prNumber: number,
  marker: string,
  body: string,
): Promise<void> {
  const existing = await findJevComment(client, prNumber, marker);
  if (existing) {
    const res = await ghFetch(
      client,
      `/issues/comments/${existing.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      },
    );
    if (!res.ok) {
      throw new Error(`GitHub update comment ${res.status}`);
    }
    return;
  }

  const res = await ghFetch(client, `/issues/${prNumber}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    throw new Error(`GitHub create comment ${res.status}`);
  }
}
