/**
 * Detects Git merge-conflict marker lines so broken merges cannot reach CI or production.
 * Markers are recognised at the first non-whitespace column, matching Git’s output.
 *
 * @param line - A single line of source (may include trailing newline in the string).
 * @returns True when the line starts a conflict marker after leading whitespace.
 */
export function lineHasMergeConflictMarker(line: string): boolean {
  const s = line.trimStart();
  if (/^<{7}/.test(s)) return true;
  if (/^>{7}/.test(s)) return true;
  if (/^={7}(\s|$)/.test(s)) return true;
  return false;
}

/**
 * Lists every line in `text` that contains a merge conflict marker.
 *
 * @param text - Full file contents.
 * @param label - Path or label shown in each finding (e.g. `src/foo.ts`).
 * @returns Entries like `src/foo.ts:94` for each offending line.
 */
export function findMergeConflictMarkerOccurrences(text: string, label: string): string[] {
  const lines = text.split(/\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lineHasMergeConflictMarker(lines[i] ?? "")) {
      out.push(`${label}:${i + 1}`);
    }
  }
  return out;
}
