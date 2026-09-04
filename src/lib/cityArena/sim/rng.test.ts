import { describe, expect, it } from "vitest";
import { createRng, seedFromString } from "./rng";

describe("createRng", () => {
  it("is deterministic for a seed and stays within [0, 1)", () => {
    const first = createRng(42);
    const second = createRng(42);
    const sequence = Array.from({ length: 5 }, () => first());
    expect(sequence).toEqual(Array.from({ length: 5 }, () => second()));
    expect(sequence.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(createRng(43)()).not.toBe(sequence[0]);
  });

  it("hashes strings to stable seeds", () => {
    expect(seedFromString("wageningen")).toBe(seedFromString("wageningen"));
    expect(seedFromString("wageningen")).not.toBe(seedFromString("rhenen"));
  });
});
