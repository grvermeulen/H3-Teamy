import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callJevApi, parseJevResponse } from "./jevClient";

describe("parseJevResponse", () => {
  it("accepts a valid response", () => {
    const json = {
      model: "jev-1.13.0",
      answers: { risk_level: { type: "choice", choice: "low" } },
      usage: { input_tokens: 100, output_tokens: 10 },
    };
    expect(parseJevResponse(json).model).toBe("jev-1.13.0");
  });

  it("rejects missing usage", () => {
    expect(() =>
      parseJevResponse({ model: "jev-1.13.0", answers: {} }),
    ).toThrow(/usage/);
  });
});

describe("callJevApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("retries on 429 then succeeds", async () => {
    vi.useFakeTimers();
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => "" })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          model: "jev-1.13.0",
          answers: {},
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      });

    const promise = callJevApi(
      { state: "x", model: "jev-1.13.0", questions: {} },
      { apiKey: "test-key", maxRetries: 2, fetchFn },
    );
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.model).toBe("jev-1.13.0");
    expect(fetchFn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("throws on non-retryable errors", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "unauthorized",
    });
    await expect(
      callJevApi({}, { apiKey: "bad", fetchFn }),
    ).rejects.toThrow(/401/);
  });
});
