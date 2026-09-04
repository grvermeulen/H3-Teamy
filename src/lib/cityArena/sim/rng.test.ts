import { describe, expect, it } from "vitest";
import { createRng, seedFromString } from "./rng";

describe("createRng", () => {
  it("is deterministic for a seed and stays within [0, 1)", () => {
    const first = createRng(42);
    const second = createRng(42);
    const sequence = Array.from({ length: 5 }, () => first());
    expect(sequence).toEqual(Array.from({ length: 5 }, () => second()));
    expect(sequence).toEqual([
      0.6011037519201636, 0.44829055899754167, 0.8524657934904099,
      0.6697340414393693, 0.17481389874592423,
    ]);
    expect(sequence.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(createRng(43)()).not.toBe(sequence[0]);
  });

  it("hashes strings to stable seeds", () => {
    expect(seedFromString("wageningen")).toBe(2691618140);
    expect(seedFromString("rhenen")).toBe(83870123);
    expect(seedFromString("wageningen")).not.toBe(seedFromString("rhenen"));
  });
});
