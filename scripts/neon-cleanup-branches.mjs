#!/usr/bin/env node
/**
 * Prunes Neon database branches created for Vercel preview deploys.
 * Two strategies (applied in order):
 *   1. **Orphan pruning** — delete branches whose git branch no longer has an
 *      open PR (requires GITHUB_TOKEN + GITHUB_REPOSITORY).
 *   2. **Count-based pruning** — delete oldest leaf branches when total exceeds
 *      --max-total (original behaviour, always active).
 *
 * Never deletes the project's primary branch.
 *
 * Env:
 *   NEON_API_KEY        — Personal API key from Neon Console
 *   NEON_PROJECT_ID     — Project ID from Neon project settings
 *   GITHUB_TOKEN        — (optional) GitHub token for open-PR lookup
 *   GITHUB_REPOSITORY   — (optional) owner/repo, auto-set in Actions
 *
 * Usage:
 *   node scripts/neon-cleanup-branches.mjs              # dry-run: list only
 *   node scripts/neon-cleanup-branches.mjs --execute    # perform deletes
 *   node scripts/neon-cleanup-branches.mjs --max-total=12 --execute
 *
 * @see docs/tech/neon-preview-branch-cleanup.md
 */

const NEON_BASE = "https://console.neon.tech/api/v2";
const GH_BASE = "https://api.github.com";

function parseArgs(argv) {
  const execute = argv.includes("--execute");
  let maxTotal = 12;
  for (const a of argv) {
    if (a.startsWith("--max-total=")) {
      maxTotal = Math.max(2, Number.parseInt(a.slice("--max-total=".length), 10) || 12);
    }
  }
  return { execute, maxTotal };
}

async function apiFetch(base, path, { method = "GET", token, tokenScheme = "Bearer" } = {}) {
  const url = `${base}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      accept: "application/json",
      authorization: `${tokenScheme} ${token}`,
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const msg = body?.message || body?.error || res.statusText;
    throw new Error(`${method} ${path} → ${res.status}: ${msg}`);
  }
  return body;
}

function neonFetch(path, opts) {
  return apiFetch(NEON_BASE, path, { ...opts, token: opts.apiKey });
}

async function listAllBranches(projectId, apiKey) {
  const branches = [];
  let cursor = null;
  for (;;) {
    const qs = new URLSearchParams({ limit: "100", sort_by: "updated_at", sort_order: "asc" });
    if (cursor) qs.set("cursor", cursor);
    const data = await neonFetch(`/projects/${projectId}/branches?${qs}`, { apiKey });
    const batch = data.branches || [];
    branches.push(...batch);
    cursor = data.pagination?.next || data.pagination?.cursor || null;
    if (!cursor || batch.length === 0) break;
  }
  return branches;
}

function getPrimaryBranch(branches) {
  const primary = branches.find((b) => b.primary === true);
  if (primary) return primary;
  const noParent = branches.find((b) => !b.parent_id);
  if (noParent) return noParent;
  return branches.find((b) => b.name === "main") || branches[0];
}

/**
 * Returns the set of head branch names from all open PRs.
 * Falls back to empty set when credentials are missing.
 */
async function openPrBranches(repo, ghToken) {
  if (!repo || !ghToken) return null;
  const branches = new Set();
  let page = 1;
  for (;;) {
    const qs = new URLSearchParams({ state: "open", per_page: "100", page: String(page) });
    const prs = await apiFetch(GH_BASE, `/repos/${repo}/pulls?${qs}`, {
      token: ghToken,
    });
    if (!Array.isArray(prs) || prs.length === 0) break;
    for (const pr of prs) branches.add(pr.head.ref);
    if (prs.length < 100) break;
    page++;
  }
  return branches;
}

/**
 * Normalises a Neon branch name so it can be compared against a git ref.
 * Vercel's Neon integration typically mirrors the git branch name as-is,
 * but some setups replace `/` with `-`. We check both forms.
 */
function matchesAnyRef(neonName, refSet) {
  if (refSet.has(neonName)) return true;
  if (refSet.has(neonName.replaceAll("-", "/"))) return true;
  for (const ref of refSet) {
    if (ref.replaceAll("/", "-") === neonName) return true;
  }
  return false;
}

/** Branches that are not parent of any other branch in the set (safe delete order bottom-up). */
function leafNonPrimaryIds(branches, primaryId) {
  const ids = new Set(branches.map((b) => b.id));
  const isParent = new Set();
  for (const b of branches) {
    if (b.parent_id && ids.has(b.parent_id)) {
      isParent.add(b.parent_id);
    }
  }
  return branches
    .filter((b) => b.id !== primaryId && !isParent.has(b.id))
    .sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime())
    .map((b) => b.id);
}

async function deleteBranch(projectId, apiKey, branch, execute) {
  console.log(
    `${execute ? "Deleting" : "Would delete"} ${branch.id} (${branch.name || "unnamed"}, updated ${branch.updated_at})`,
  );
  if (execute) {
    await neonFetch(`/projects/${projectId}/branches/${branch.id}`, {
      method: "DELETE",
      apiKey,
    });
  }
}

async function main() {
  const { execute, maxTotal } = parseArgs(process.argv.slice(2));
  const apiKey = process.env.NEON_API_KEY;
  const projectId = process.env.NEON_PROJECT_ID;
  const ghToken = process.env.GITHUB_TOKEN;
  const ghRepo = process.env.GITHUB_REPOSITORY;

  if (!apiKey || !projectId) {
    console.error(
      "Set NEON_API_KEY and NEON_PROJECT_ID (see docs/tech/neon-preview-branch-cleanup.md).",
    );
    process.exit(1);
  }

  let branches = await listAllBranches(projectId, apiKey);
  const primary = getPrimaryBranch(branches);
  if (!primary) {
    console.error("No branches returned; check NEON_PROJECT_ID.");
    process.exit(1);
  }

  console.log(`Project ${projectId}: ${branches.length} branch(es), primary = ${primary.id} (${primary.name || "unnamed"})`);
  console.log(`Mode: ${execute ? "DELETE" : "dry-run"}.`);

  // --- Phase 1: orphan pruning (branches without a matching open PR) ---
  const prRefs = await openPrBranches(ghRepo, ghToken);
  if (prRefs) {
    console.log(`\nPhase 1 — orphan pruning (${prRefs.size} open PR branch(es) found on GitHub)`);
    const orphans = branches.filter(
      (b) => b.id !== primary.id && !matchesAnyRef(b.name, prRefs),
    );
    if (orphans.length === 0) {
      console.log("No orphan branches found.");
    } else {
      console.log(`Found ${orphans.length} orphan branch(es):`);
      for (const orphan of orphans) {
        const leaves = leafNonPrimaryIds(branches, primary.id);
        if (!leaves.includes(orphan.id)) {
          console.log(`  Skipping ${orphan.id} (${orphan.name}) — has child branches`);
          continue;
        }
        await deleteBranch(projectId, apiKey, orphan, execute);
        branches = branches.filter((b) => b.id !== orphan.id);
      }
    }
  } else {
    console.log("\nPhase 1 — orphan pruning skipped (GITHUB_TOKEN / GITHUB_REPOSITORY not set)");
  }

  // --- Phase 2: count-based pruning ---
  console.log(`\nPhase 2 — count-based pruning (target: at most ${maxTotal} branches)`);
  if (branches.length <= maxTotal) {
    console.log(`${branches.length} branch(es) remaining — within limit, nothing to prune.`);
  } else {
    while (branches.length > maxTotal) {
      const leaves = leafNonPrimaryIds(branches, primary.id);
      const victimId = leaves[0];
      if (!victimId) {
        console.error(
          "No deletable leaf branch found (Neon requires deleting children before parents). Prune manually in Neon Console.",
        );
        process.exit(2);
      }
      const victim = branches.find((b) => b.id === victimId);
      await deleteBranch(projectId, apiKey, victim, execute);
      branches = branches.filter((b) => b.id !== victimId);
    }
  }

  if (!execute) {
    console.log("\nRe-run with --execute to apply deletes.");
  } else {
    console.log(`\nDone. ${branches.length} branch(es) remain.`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
