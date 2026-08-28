import { describe, expect, it } from "vitest";
import { shouldDropPgPoolNoiseForSentry } from "./sentryPgPoolNoise";

describe("shouldDropPgPoolNoiseForSentry", () => {
  const baseEvent = { event_id: "test" } as Parameters<
    typeof shouldDropPgPoolNoiseForSentry
  >[0];

  it("drops Prisma Postgres proxy auth handshake noise (JAVASCRIPT-NEXTJS-3A)", () => {
    const hint = {
      originalException: new Error(
        "Error while reading client PasswordMessage",
      ),
    };
    expect(shouldDropPgPoolNoiseForSentry(baseEvent, hint)).toBe(true);
  });

  it("drops idle pg pool disconnect noise", () => {
    const hint = {
      originalException: new Error("Connection terminated unexpectedly"),
    };
    expect(shouldDropPgPoolNoiseForSentry(baseEvent, hint)).toBe(true);
  });

  it("keeps unrelated application errors", () => {
    const hint = {
      originalException: new Error("password authentication failed"),
    };
    expect(shouldDropPgPoolNoiseForSentry(baseEvent, hint)).toBe(false);
  });
});
