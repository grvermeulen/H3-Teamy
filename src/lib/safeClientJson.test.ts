import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { fetchJsonOr } from "./safeClientJson";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

describe("fetchJsonOr", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns parsed JSON on success", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ user: { id: "u1" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await fetchJsonOr<{ user: { id: string } }>(
      "/api/me",
      { cache: "no-store" },
      { user: { id: "" } },
      "test-me",
    );
    expect(result).toEqual({ user: { id: "u1" } });
    expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
  });

  it("returns fallback and reports to Sentry when fetch rejects", async () => {
    const loadFailed = new TypeError("Load failed");
    vi.spyOn(global, "fetch").mockRejectedValue(loadFailed);
    const fallback = { user: null as null };
    const result = await fetchJsonOr(
      "/api/me",
      undefined,
      fallback,
      "test-reject",
    );
    expect(result).toBe(fallback);
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      loadFailed,
      {
        tags: { clientFetch: "test-reject" },
      },
    );
  });

  it("returns fallback without Sentry when fetch aborts", async () => {
    const aborted = new DOMException(
      "The user aborted a request.",
      "AbortError",
    );
    vi.spyOn(global, "fetch").mockRejectedValue(aborted);
    const fallback = { ok: false };
    const result = await fetchJsonOr(
      "/api/x",
      { signal: new AbortController().signal },
      fallback,
      "test-abort",
    );
    expect(result).toEqual(fallback);
    expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
  });

  it("returns fallback and reports to Sentry when JSON is invalid", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response("not json", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );
    const fallback = { ok: false };
    const result = await fetchJsonOr("/x", {}, fallback, "test-bad-json");
    expect(result).toEqual(fallback);
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.any(SyntaxError),
      { tags: { clientFetch: "test-bad-json" } },
    );
  });
});
