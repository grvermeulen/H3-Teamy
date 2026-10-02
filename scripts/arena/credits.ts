/**
 * The credits tables next to the audio files (`public/arena/audio/CREDITS.md`,
 * `public/arena/radio/CREDITS.md`): a Markdown table with one row per file, matched by the first
 * cell. Prettier pads the columns of a committed table, so cells are compared trimmed.
 */

/** The table's header and separator, as the writers emit them. */
export const CREDITS_TABLE_HEADER = [
  "| File | Source | Author | Licence | URL |",
  "| --- | --- | --- | --- | --- |",
];

/** True for a data row: a table line that is neither the header nor the separator. */
function isDataRow(line: string): boolean {
  return (
    line.startsWith("| ") &&
    !line.startsWith("| File") &&
    !line.startsWith("| ---")
  );
}

/**
 * The file a row credits: its first cell, trimmed.
 *
 * @param row - One table row.
 * @returns The file name, or an empty string for a row without a first cell.
 */
export function fileOfRow(row: string): string {
  return row.split("|")[1]?.trim() ?? "";
}

/**
 * The data rows of a credits file.
 *
 * @param credits - The file's contents, or null when it does not exist.
 * @returns The rows, header and separator excluded.
 */
export function creditRows(credits: string | null): string[] {
  return (credits ?? "").split("\n").filter(isDataRow);
}

/**
 * The files a credits file has a row for.
 *
 * @param credits - The file's contents, or null when it does not exist.
 * @returns The file names.
 */
export function creditedFiles(credits: string | null): Set<string> {
  return new Set(creditRows(credits).map(fileOfRow));
}

/**
 * The files a credits file credits more than once — a stale row a regeneration left behind.
 *
 * @param credits - The file's contents, or null when it does not exist.
 * @returns The file names, each once.
 */
export function creditedTwice(credits: string | null): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const file of creditRows(credits).map(fileOfRow)) {
    if (seen.has(file)) twice.add(file);
    seen.add(file);
  }
  return [...twice];
}

/**
 * A whole credits file: a title, an intro line, the table.
 *
 * @param title - The Markdown heading.
 * @param intro - One line under it.
 * @param rows - The data rows, in the order to write them.
 * @returns The file contents, newline-terminated.
 */
export function creditsFile(
  title: string,
  intro: string,
  rows: string[],
): string {
  return (
    [`# ${title}`, "", intro, "", ...CREDITS_TABLE_HEADER, ...rows].join("\n") +
    "\n"
  );
}
