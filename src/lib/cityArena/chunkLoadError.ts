/**
 * The other failure of the 3D view that is not a bug: its lazily loaded chunk failing to download —
 * most often a tab still running the previous deploy asking for a chunk that no longer exists, or a
 * dropped connection. Webpack and Turbopack both name that error `ChunkLoadError`; a native
 * `import()` that fails says so in its message instead. Kept free of three.js.
 */

/** Messages browsers give a dynamic `import()` whose module could not be fetched. */
const CHUNK_LOAD_MESSAGES = [
  /Loading chunk [\w-]+ failed/i,
  /Failed to load chunk/i,
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
];

/** The `name` webpack and Turbopack give a chunk that failed to download. */
const CHUNK_LOAD_ERROR_NAME = "ChunkLoadError";

/**
 * True when `error` is a lazily loaded chunk that failed to download.
 *
 * @param error - Anything caught from a dynamic `import()`.
 * @returns Whether it is a chunk-load failure rather than a bug in the module.
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === CHUNK_LOAD_ERROR_NAME) return true;
  return CHUNK_LOAD_MESSAGES.some((pattern) => pattern.test(error.message));
}
