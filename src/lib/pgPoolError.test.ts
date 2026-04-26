import { describe, expect, it } from "vitest";
import { isPgPoolIdleDisconnectNoise } from "./pgPoolError";

describe("isPgPoolIdleDisconnectNoise", () => {
  it("returns true for Connection terminated unexpectedly", () => {
    expect(
      isPgPoolIdleDisconnectNoise(
        new Error("Connection terminated unexpectedly"),
      ),
    ).toBe(true);
  });

  it("returns true for Connection terminated (pg ending path)", () => {
    expect(
      isPgPoolIdleDisconnectNoise(new Error("Connection terminated")),
    ).toBe(true);
  });

  it("returns false for unrelated pool errors", () => {
    expect(
      isPgPoolIdleDisconnectNoise(new Error("password authentication failed")),
    ).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isPgPoolIdleDisconnectNoise("x")).toBe(false);
  });
});
