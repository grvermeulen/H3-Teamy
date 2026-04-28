import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { fetchJsonIfOkOr, fetchJsonOr } from "./safeClientJson";

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

  it("returns fallback without Sentry when WebKit rejects with Load failed", async () => {
    const loadFailed = new TypeError("Load failed");
    vi.spyOn(global, "fetch").mockRejectedValue(loadFailed);
    const fallback = { user: null as null };
    const result = await fetchJsonOr(
      "/api/me",
      undefined,
      fallback,
      "test-webkit-load-failed",
    );
    expect(result).toBe(fallback);
    expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
  });

  it("returns fallback and reports to Sentry when fetch rejects with other TypeError", async () => {
    const other = new TypeError("NetworkError when attempting to fetch resource.");
    vi.spyOn(global, "fetch").mockRejectedValue(other);
    const fallback = { user: null as null };
    const result = await fetchJsonOr(
      "/api/me",
      undefined,
      fallback,
      "test-reject",
    );
    expect(result).toBe(fallback);
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(other, {
      tags: { clientFetch: "test-reject" },
    });
  });

  it("returns fallback without Sentry when Load failed is nested in error cause", async () => {
    const loadFailed = new TypeError("Load failed");
    const wrapped = new Error("wrapped");
    Object.assign(wrapped, { cause: loadFailed });
    vi.spyOn(global, "fetch").mockRejectedValue(wrapped);
    const fallback = { ok: false };
    const result = await fetchJsonOr(
      "/api/x",
      undefined,
      fallback,
      "test-load-failed-cause",
    );
    expect(result).toEqual(fallback);
    expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
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

  it("returns fallback without Sentry when fetch rejects with Failed to fetch but signal is aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const failedToFetch = new TypeError("Failed to fetch");
    vi.spyOn(global, "fetch").mockRejectedValue(failedToFetch);
    const fallback = { ok: false };
    const result = await fetchJsonOr(
      "/api/x",
      { signal: ac.signal },
      fallback,
      "test-abort-failed-fetch",
    );
    expect(result).toEqual(fallback);
    expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
  });

  it("returns fallback without Sentry when error cause is AbortError", async () => {
    const aborted = new DOMException(
      "The user aborted a request.",
      "AbortError",
    );
    const wrapped = new Error("wrapped");
    Object.assign(wrapped, { cause: aborted });
    vi.spyOn(global, "fetch").mockRejectedValue(wrapped);
    const fallback = { ok: false };
    const result = await fetchJsonOr(
      "/api/x",
      undefined,
      fallback,
      "test-abort-cause",
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

describe("fetchJsonIfOkOr", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns parsed JSON when status is OK", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ counts: { yes: 1, no: 0, maybe: 0 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await fetchJsonIfOkOr<{ counts: { yes: number; no: number; maybe: number } }>(
      "/api/rsvp/list?eventId=e1",
      { cache: "no-store" },
      "test-ifok",
    );
    expect(result).toEqual({ counts: { yes: 1, no: 0, maybe: 0 } });
    expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
  });

  it("returns null without Sentry when response is not OK", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "list_failed" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await fetchJsonIfOkOr<{ counts: { yes: number } }>(
      "/api/rsvp/list?eventId=e1",
      undefined,
      "test-not-ok",
    );
    expect(result).toBeNull();
    expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
  });

  it("returns null without Sentry when WebKit rejects with Load failed", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new TypeError("Load failed"));
    const result = await fetchJsonIfOkOr<{ x: number }>(
      "/api/x",
      undefined,
      "test-ifok-webkit",
    );
    expect(result).toBeNull();
    expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
  });

  it("returns null and reports to Sentry when fetch rejects with other error", async () => {
    const err = new TypeError("NetworkError when attempting to fetch resource.");
    vi.spyOn(global, "fetch").mockRejectedValue(err);
    const result = await fetchJsonIfOkOr<{ x: number }>(
      "/api/x",
      undefined,
      "test-ifok-reject",
    );
    expect(result).toBeNull();
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(err, {
      tags: { clientFetch: "test-ifok-reject" },
    });
  });

  it("returns null and reports to Sentry when JSON is invalid on OK response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response("not json", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );
    const result = await fetchJsonIfOkOr<{ ok: boolean }>(
      "/x",
      {},
      "test-ifok-bad-json",
    );
    expect(result).toBeNull();
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.any(SyntaxError),
      { tags: { clientFetch: "test-ifok-bad-json" } },
    );
  });
});
