import { describe, expect, it } from "vitest";
import { canApplyRuntimeUpdate } from "./arenaRuntime";

describe("arena runtime async guards", () => {
  it("rejects callbacks after runtime disposal", () => {
    expect(canApplyRuntimeUpdate({ disposed: false })).toBe(true);
    expect(canApplyRuntimeUpdate({ disposed: true })).toBe(false);
  });
});
