import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const kvIncrementWindow = vi.fn();
vi.mock("./kv", () => ({
  kvIncrementWindow: (...args: unknown[]) => kvIncrementWindow(...args),
}));

const {
  ARENA_LIMITS,
  RATE_LIMITED_MESSAGE,
  checkRateLimit,
  clientAddress,
  rateLimited,
} = await import("./rateLimit");

/** A rule small enough to count through by hand. */
const RULE = { name: "test", limit: 3, windowSec: 60 };

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("counts against a key for this subject and this window", async () => {
    kvIncrementWindow.mockResolvedValue(1);
    // 90 s in: the second minute-long window.
    await checkRateLimit(RULE, "user-1", () => 90_000);
    expect(kvIncrementWindow).toHaveBeenCalledWith(
      "ratelimit:test:user-1:1",
      60,
    );
  });

  it("allows up to the limit and refuses the request after it", async () => {
    kvIncrementWindow.mockResolvedValueOnce(3);
    expect(await checkRateLimit(RULE, "user-1")).toEqual({ allowed: true });
    kvIncrementWindow.mockResolvedValueOnce(4);
    expect(await checkRateLimit(RULE, "user-1")).toMatchObject({
      allowed: false,
    });
  });

  it("says how long is left in the window, never less than a second", async () => {
    kvIncrementWindow.mockResolvedValue(99);
    // 15 s into the first window: 45 s to go.
    expect(await checkRateLimit(RULE, "u", () => 15_000)).toEqual({
      allowed: false,
      retryAfterSec: 45,
    });
    // 59.9 s in: rounds up to one whole second, not down to zero.
    expect(await checkRateLimit(RULE, "u", () => 59_900)).toEqual({
      allowed: false,
      retryAfterSec: 1,
    });
  });

  it("lets the request through when no store could count it", async () => {
    kvIncrementWindow.mockResolvedValue(null);
    expect(await checkRateLimit(RULE, "user-1")).toEqual({ allowed: true });
  });

  it("gives every arena route a limit per minute", () => {
    for (const rule of Object.values(ARENA_LIMITS)) {
      expect(rule.windowSec).toBe(60);
      expect(rule.limit).toBeGreaterThan(0);
    }
    expect(ARENA_LIMITS.matches.limit).toBeLessThan(ARENA_LIMITS.token.limit);
  });
});

describe("rateLimited", () => {
  it("is a 429 in Dutch that says when to try again", async () => {
    const response = rateLimited({ retryAfterSec: 12 });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("12");
    expect(await response.json()).toEqual({ error: RATE_LIMITED_MESSAGE });
  });
});

describe("clientAddress", () => {
  it("takes the first forwarded hop, then the real-ip header, then a fixed label", () => {
    const forwarded = new NextRequest("http://localhost/x", {
      headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" },
    });
    expect(clientAddress(forwarded)).toBe("203.0.113.5");
    const real = new NextRequest("http://localhost/x", {
      headers: { "x-real-ip": "198.51.100.7" },
    });
    expect(clientAddress(real)).toBe("198.51.100.7");
    expect(clientAddress(new NextRequest("http://localhost/x"))).toBe(
      "unknown",
    );
  });
});
