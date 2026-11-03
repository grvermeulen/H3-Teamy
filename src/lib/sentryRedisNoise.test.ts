import { describe, expect, it } from "vitest";
import { shouldDropRedisNoiseForSentry } from "./sentryRedisNoise";

describe("shouldDropRedisNoiseForSentry", () => {
  const baseEvent = { event_id: "test" } as Parameters<
    typeof shouldDropRedisNoiseForSentry
  >[0];

  it("drops ioredis connection closed noise (JAVASCRIPT-NEXTJS-4W)", () => {
    const hint = {
      originalException: new Error("Connection is closed."),
    };
    expect(shouldDropRedisNoiseForSentry(baseEvent, hint)).toBe(true);
  });

  it("keeps unrelated application errors", () => {
    const hint = {
      originalException: new Error("WRONGPASS invalid password"),
    };
    expect(shouldDropRedisNoiseForSentry(baseEvent, hint)).toBe(false);
  });
});
