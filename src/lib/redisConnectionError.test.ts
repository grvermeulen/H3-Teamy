import { describe, expect, it } from "vitest";
import { isRedisTransientConnectionNoise } from "./redisConnectionError";

describe("isRedisTransientConnectionNoise", () => {
  it("returns true for ioredis CONNECTION_CLOSED (JAVASCRIPT-NEXTJS-4W)", () => {
    expect(
      isRedisTransientConnectionNoise(new Error("Connection is closed.")),
    ).toBe(true);
  });

  it("returns true for connection is closed without trailing period", () => {
    expect(
      isRedisTransientConnectionNoise(new Error("Connection is closed")),
    ).toBe(true);
  });

  it("returns false for unrelated Redis errors", () => {
    expect(
      isRedisTransientConnectionNoise(new Error("WRONGPASS invalid password")),
    ).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isRedisTransientConnectionNoise("x")).toBe(false);
  });
});
