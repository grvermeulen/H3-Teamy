#!/usr/bin/env node
/**
 * Prunes Neon database branches created for Vercel preview deploys when the
 * account hits the branch limit. Never deletes the project's primary branch.
 *
 * Env:
 *   NEON_API_KEY   — Personal API key from Neon Console (Settings → API keys)
 *   NEON_PROJECT_ID — Project ID from Neon project settings (e.g. autumn-disk-484331)
 *
 * Usage:
 *   node scripts/neon-cleanup-branches.mjs              # dry-run: list only
 *   node scripts/neon-cleanup-branches.mjs --execute    # perform deletes
 *   node scripts/neon-cleanup-branches.mjs --max-total=12 --execute
 *
 * @see docs/tech/neon-preview-branch-cleanup.md
 */

const BASE = "https://console.neon.tech/api/v2";

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

async function neonFetch(path, { method = "GET", apiKey } = {}) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
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

async function main() {
  const { execute, maxTotal } = parseArgs(process.argv.slice(2));
  const apiKey = process.env.NEON_API_KEY;
  const projectId = process.env.NEON_PROJECT_ID;

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
  console.log(`Target: at most ${maxTotal} branches total. Mode: ${execute ? "DELETE" : "dry-run"}.`);

  if (branches.length <= maxTotal) {
    console.log("Nothing to prune.");
    return;
  }

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
    console.log(
      `${execute ? "Deleting" : "Would delete"} ${victimId} (${victim?.name || "unnamed"}, updated ${victim?.updated_at})`,
    );
    if (execute) {
      await neonFetch(`/projects/${projectId}/branches/${victimId}`, {
        method: "DELETE",
        apiKey,
      });
    }
    branches = branches.filter((b) => b.id !== victimId);
  }

  if (!execute) {
    console.log("\nRe-run with --execute to apply deletes.");
  } else {
    console.log(`Done. ${branches.length} branch(es) remain.`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
