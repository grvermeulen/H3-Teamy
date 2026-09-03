// @vitest-environment node
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchOverpass, overpassCacheKey } from "./overpass";

const payload = {
  version: 0.6,
  elements: [{ type: "node", id: 1, lat: 51.98, lon: 5.625 }],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("fetchOverpass", () => {
  let cacheDir = "";
  const sleep = vi.fn(async () => {});

  beforeEach(async () => {
    vi.clearAllMocks();
    cacheDir = await mkdtemp(join(tmpdir(), "arena-overpass-"));
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  it("hashes the query into a stable cache key", () => {
    expect(overpassCacheKey("a")).toBe(overpassCacheKey("a"));
    expect(overpassCacheKey("a")).not.toBe(overpassCacheKey("b"));
    expect(overpassCacheKey("a")).toMatch(/^[0-9a-f]{40}$/);
  });

  it("posts the query as form data and caches the response on disk", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(payload));
    const first = await fetchOverpass("[out:json];node(1);out;", {
      cacheDir,
      fetchImpl,
      sleep,
    });
    const second = await fetchOverpass("[out:json];node(1);out;", {
      cacheDir,
      fetchImpl,
      sleep,
    });
    expect(first.elements).toHaveLength(1);
    expect(second).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0];
    expect(init?.method).toBe("POST");
    expect(String(init?.body)).toBe(
      `data=${encodeURIComponent("[out:json];node(1);out;")}`,
    );
    expect(await readdir(cacheDir)).toHaveLength(1);
  });

  it("bypasses the cache with refresh", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(payload));
    await fetchOverpass("q", { cacheDir, fetchImpl, sleep });
    await fetchOverpass("q", { cacheDir, fetchImpl, sleep, refresh: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("treats a corrupt cache file as a miss and fetches again", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(payload));
    await mkdir(cacheDir, { recursive: true });
    await writeFile(
      join(cacheDir, `${overpassCacheKey("q")}.json`),
      "{ not json",
    );
    const result = await fetchOverpass("q", { cacheDir, fetchImpl, sleep });
    expect(result.elements).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 and 5xx with backoff, then succeeds", async () => {
    const fetchImpl = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(jsonResponse({ error: "busy" }, 429))
      .mockResolvedValueOnce(jsonResponse({ error: "gateway" }, 504))
      .mockResolvedValueOnce(jsonResponse(payload));
    const result = await fetchOverpass("q", { cacheDir, fetchImpl, sleep });
    expect(result.elements).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("gives up after the configured retries and reports the status", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ error: "busy" }, 429),
    );
    await expect(
      fetchOverpass("q", { cacheDir, fetchImpl, sleep, retries: 2 }),
    ).rejects.toThrow(/429/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("rejects responses without an elements array", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ remark: "runtime error" }),
    );
    await expect(
      fetchOverpass("q", { cacheDir, fetchImpl, sleep }),
    ).rejects.toThrow(/elements/);
  });
});
