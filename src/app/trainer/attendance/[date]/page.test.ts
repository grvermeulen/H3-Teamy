import { describe, expect, it } from "vitest";

import { resolveDateParam } from "./page";

describe("resolveDateParam", () => {
  it("returns the provided date string", () => {
    expect(resolveDateParam("2026-03-19")).toBe("2026-03-19");
  });

  it("returns first value when params are an array", () => {
    expect(resolveDateParam(["2026-03-19", "ignored"])).toBe("2026-03-19");
  });

  it("returns empty string for missing value", () => {
    expect(resolveDateParam(undefined)).toBe("");
  });
});
