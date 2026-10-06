const LOCKFILE_PATHS = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "requirements.txt",
  "poetry.lock",
]);

/**
 * Returns true when the path is a lockfile we summarize instead of including hunks.
 * @param filename - File path relative to repo root.
 */
export function isLockfilePath(filename: string): boolean {
  return LOCKFILE_PATHS.has(filename);
}

/**
 * Summarizes package version changes from a lockfile or requirements diff hunk.
 * @param filename - Lockfile path.
 * @param content - Patch text or full file content from the PR.
 */
export function summarizeLockfileChanges(
  filename: string,
  content: string,
): string[] {
  const lines = content.split("\n");
  const changes: string[] = [];

  if (filename === "package-lock.json" || filename === "package.json") {
    for (const line of lines) {
      const pkgMatch = line.match(/^[-+]\s+"([^"]+)":\s*\{/) ;
      if (pkgMatch) {
        changes.push(pkgMatch[1]);
        continue;
      }
      const versionMatch = line.match(
        /^[-+]\s+"((?:@[^/"]+\/)?[^"]+)":\s*"([^"]+)"/,
      );
      if (versionMatch) {
        changes.push(`${versionMatch[1]}@${versionMatch[2]}`);
      }
    }
    return dedupe(changes).slice(0, 200);
  }

  if (filename === "requirements.txt") {
    for (const line of lines) {
      const reqMatch = line.match(/^[-+]([^#\s].+)$/);
      if (reqMatch) {
        changes.push(reqMatch[1].trim());
      }
    }
    return dedupe(changes).slice(0, 200);
  }

  for (const line of lines) {
    if (line.startsWith("+") || line.startsWith("-")) {
      const trimmed = line.slice(1).trim();
      if (trimmed && !trimmed.startsWith("@@")) {
        changes.push(trimmed);
      }
    }
  }

  return dedupe(changes).slice(0, 200);
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}
