/**
 * File helpers for the audio scripts. "Missing" is the one failure the audits and the generators
 * expect and handle; anything else — a permission, a disk on its way out — must surface, not
 * pass for a missing file.
 */

import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * True for the error Node raises when a path does not exist.
 *
 * @param error - Whatever was thrown.
 * @returns Whether it is an `ENOENT`.
 */
export function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/**
 * The file's text, or `null` when there is no such file. Any other failure is thrown.
 *
 * @param file - The path.
 * @returns The contents, or `null`.
 */
export async function readIfPresent(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error: unknown) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/**
 * The directory's entries, or none when there is no such directory. Any other failure is thrown.
 *
 * @param dir - The path.
 * @returns The entry names.
 */
export async function listIfPresent(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error: unknown) {
    if (isMissing(error)) return [];
    throw error;
  }
}

/**
 * Writes through a sibling temporary file and a rename, so a crash leaves the old file or the
 * new one, never half of one. Creates the directory when it is missing.
 *
 * @param file - The path to end up at.
 * @param contents - What to write.
 */
export async function writeAtomic(
  file: string,
  contents: string | Uint8Array,
): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, contents);
  await rename(temp, file);
}
