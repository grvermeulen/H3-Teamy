/**
 * Detects Git merge conflict marker lines in source text.
 * Markers at the start of a line (after whitespace) break the Next.js parser and must never ship.
 */

/** Line-start prefixes that indicate an unresolved merge conflict. */
export const MERGE_CONFLICT_LINE_PREFIXES: readonly string[] = [
  "<<<<<<<",
  "=======",
  ">>>>>>>",
];

/**
 * Returns 1-based line numbers where a merge conflict marker appears at line start (ignoring leading whitespace).
 * @param content - Full file contents.
 * @returns Sorted unique line numbers.
 */
export function findMergeConflictMarkerLines(
  content: string,
): readonly number[] {
  const lines = content.split(/\r?\n/);
  const found = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trimStart();
    for (const prefix of MERGE_CONFLICT_LINE_PREFIXES) {
      if (trimmed.startsWith(prefix)) {
        found.add(i + 1);
        break;
      }
    }
  }
  return [...found].sort((a, b) => a - b);
}
