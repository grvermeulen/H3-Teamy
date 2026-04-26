import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeoutAndRetries } from "./fetchWithRetry";

describe("fetchWithTimeoutAndRetries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns response on first successful fetch", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(""),
    } as Response);

    const res = await fetchWithTimeoutAndRetries("https://example.com/x", {
      timeoutMs: 5000,
      maxAttempts: 2,
    });

    expect(res.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries on rejection then succeeds", async () => {
    vi.spyOn(global, "fetch")
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(""),
      } as Response);

    const res = await fetchWithTimeoutAndRetries("https://example.com/x", {
      timeoutMs: 5000,
      maxAttempts: 3,
    });

    expect(res.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("throws last error after all attempts fail", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("network down"));

    await expect(
      fetchWithTimeoutAndRetries("https://example.com/x", {
        timeoutMs: 5000,
        maxAttempts: 2,
      }),
    ).rejects.toThrow("network down");

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
