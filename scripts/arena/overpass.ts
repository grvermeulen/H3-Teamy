import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { OverpassJson } from "../../src/lib/cityArena/mapBuild/osmTypes";

/** Public Overpass API endpoint. */
export const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";

/** Options for {@link fetchOverpass}; `fetchImpl`/`sleep` exist for tests. */
export type FetchOverpassOptions = {
  cacheDir: string;
  refresh?: boolean;
  fetchImpl?: typeof fetch;
  endpoint?: string;
  retries?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  log?: (line: string) => void;
};

const DEFAULT_RETRIES = 3;
const BACKOFF_BASE_MS = 2000;

/** SHA-1 of the query text, used as the cache file name. */
export function overpassCacheKey(query: string): string {
  return createHash("sha1").update(query).digest("hex");
}

function isOverpassJson(value: unknown): value is OverpassJson {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { elements?: unknown }).elements)
  );
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Overpass answers HTTP 200 with a `remark` and a partial (often empty) `elements` array
 * when a query hits a server-side runtime error (timeout, memory limit). `isOverpassJson`
 * alone accepts this as a valid response, so it must be checked separately.
 */
function runtimeErrorRemark(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const remark = (value as { remark?: unknown }).remark;
  return typeof remark === "string" && /runtime error/i.test(remark)
    ? remark
    : null;
}

/** Reads and validates the cache file; returns null (meaning: refetch) on an acceptable miss. */
async function readCachedResponse(
  cacheFile: string,
  log: (line: string) => void,
): Promise<OverpassJson | null> {
  try {
    const cached: unknown = JSON.parse(await readFile(cacheFile, "utf8"));
    if (isOverpassJson(cached)) {
      log(`Overpass cache hit ${cacheFile}`);
      return cached;
    }
    return null;
  } catch (error: unknown) {
    const isMissing =
      error instanceof Error && "code" in error && error.code === "ENOENT";
    const isCorrupt = error instanceof SyntaxError;
    if (!isMissing && !isCorrupt) throw error;
    if (isCorrupt) log(`Overpass cache corrupt, refetching ${cacheFile}`);
    return null;
  }
}

/** One raw fetch attempt against the Overpass endpoint; network failures never throw. */
async function requestOnce(
  url: string,
  query: string,
  fetchImpl: typeof fetch,
): Promise<{ response: Response | null; failure: string | null }> {
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        // Overpass's server rejects requests with no User-Agent (406 Not
        // Acceptable); Node's fetch sends none by default, unlike curl or a
        // browser. Overpass's fair-use policy also asks for an identifying
        // header, so this doubles as etiquette, not just a workaround.
        "user-agent":
          "H3-Teamy-Arena-MapBuild/1.0 (+https://github.com/grvermeulen/H3-Teamy)",
      },
      body: `data=${encodeURIComponent(query)}`,
    });
    return { response, failure: null };
  } catch (error: unknown) {
    return {
      response: null,
      failure: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Parses and validates a successful response body; throws if the shape is wrong. */
async function parseSuccessResponse(response: Response): Promise<OverpassJson> {
  const parsed: unknown = await response.json();
  if (!isOverpassJson(parsed)) {
    throw new Error(
      `Overpass response has no elements array: ${JSON.stringify(parsed).slice(0, 300)}`,
    );
  }
  return parsed;
}

/**
 * Decides whether a non-ok (or network-failed) attempt should be retried: sleeps and logs
 * when it should, throws the final error message when it should not.
 */
async function handleFailure(
  response: Response | null,
  failure: string | null,
  attempt: number,
  retries: number,
  sleep: (milliseconds: number) => Promise<void>,
  log: (line: string) => void,
): Promise<void> {
  const status = response?.status ?? 0;
  const retryable = response ? isRetryable(status) : true;
  if (!retryable || attempt > retries) {
    const body = response
      ? (await response.text()).slice(0, 300)
      : (failure ?? "network error");
    throw new Error(
      `Overpass request failed with status ${status} after ${attempt} attempt(s): ${body}`,
    );
  }
  log(`Overpass attempt ${attempt} failed (${status || failure}); retrying`);
  await sleep(BACKOFF_BASE_MS * attempt);
}

/** Writes the cache file and returns the parsed response, logging the element count. */
async function storeAndReturn(
  cacheDir: string,
  cacheFile: string,
  parsed: OverpassJson,
  log: (line: string) => void,
): Promise<OverpassJson> {
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cacheFile, JSON.stringify(parsed));
  log(`Overpass fetched ${parsed.elements.length} elements → ${cacheFile}`);
  return parsed;
}

/** Fetches an Overpass query, caching the JSON under `cacheDir/<sha1>.json`. */
export async function fetchOverpass(
  query: string,
  options: FetchOverpassOptions,
): Promise<OverpassJson> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep =
    options.sleep ??
    ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const log = options.log ?? (() => {});
  const retries = options.retries ?? DEFAULT_RETRIES;
  const cacheFile = join(options.cacheDir, `${overpassCacheKey(query)}.json`);

  if (!options.refresh) {
    const cached = await readCachedResponse(cacheFile, log);
    if (cached) return cached;
  }

  let attempt = 0;
  for (;;) {
    attempt += 1;
    const { response, failure } = await requestOnce(
      options.endpoint ?? OVERPASS_ENDPOINT,
      query,
      fetchImpl,
    );
    if (response && response.ok) {
      const parsed = await parseSuccessResponse(response);
      const remark = runtimeErrorRemark(parsed);
      if (remark) {
        if (attempt > retries) {
          throw new Error(
            `Overpass runtime error after ${attempt} attempt(s): ${remark}`,
          );
        }
        log(`Overpass runtime error (attempt ${attempt}): ${remark}; retrying`);
        await sleep(BACKOFF_BASE_MS * attempt);
        continue;
      }
      return await storeAndReturn(options.cacheDir, cacheFile, parsed, log);
    }
    await handleFailure(response, failure, attempt, retries, sleep, log);
  }
}
