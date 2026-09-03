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
    try {
      const cached: unknown = JSON.parse(await readFile(cacheFile, "utf8"));
      if (isOverpassJson(cached)) {
        log(`Overpass cache hit ${cacheFile}`);
        return cached;
      }
    } catch (error: unknown) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      )
        throw error;
    }
  }

  let attempt = 0;
  for (;;) {
    attempt += 1;
    let response: Response | null = null;
    let failure: string | null = null;
    try {
      response = await fetchImpl(options.endpoint ?? OVERPASS_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
      });
    } catch (error: unknown) {
      failure = error instanceof Error ? error.message : String(error);
    }
    if (response && response.ok) {
      const parsed: unknown = await response.json();
      if (!isOverpassJson(parsed)) {
        throw new Error(
          `Overpass response has no elements array: ${JSON.stringify(parsed).slice(0, 300)}`,
        );
      }
      await mkdir(options.cacheDir, { recursive: true });
      await writeFile(cacheFile, JSON.stringify(parsed));
      log(`Overpass fetched ${parsed.elements.length} elements → ${cacheFile}`);
      return parsed;
    }
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
}
