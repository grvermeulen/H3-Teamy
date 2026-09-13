import { describe, expect, it } from "vitest";
import { isInputFrame, isSnapshot } from "./wireValidation";
import type { Snapshot } from "./snapshotWire";

const snapshot: Snapshot = {
  n: 2,
  t: 30,
  s: 1000,
  p: [],
  v: [],
  d: [],
  c: [],
  b: [],
  k: [],
  q: [],
};

describe("untrusted arena wire messages", () => {
  it("accepts neutral and active input but rejects unsafe containers, values and flags", () => {
    expect(isInputFrame([1, 0, 0, -1, 0])).toBe(true);
    expect(isInputFrame([3, -100, 100, 255, 15])).toBe(true);
    for (const value of [
      null,
      {},
      "frame",
      [],
      [1, 0, 0, -1, 0, 0],
      [1, 0, 0, -1, 16],
      [NaN, 0, 0, -1, 0],
      [1, 101, 0, -1, 0],
      [1.1, 0, 0, -1, 0],
    ]) {
      expect(isInputFrame(value)).toBe(false);
    }
  });

  it("requires the protocol version and bounds nested rows before decoding", () => {
    expect(isSnapshot(snapshot)).toBe(true);
    for (const value of [
      null,
      {},
      { ...snapshot, n: 1 },
      { ...snapshot, p: null },
      { ...snapshot, q: [[1]] },
      { ...snapshot, q: [[1, NaN]] },
      { ...snapshot, v: Array(141).fill(Array(10).fill(0)) },
      { ...snapshot, p: [Array(17).fill(0)] },
      { ...snapshot, m: [["x".repeat(65), 1]] },
      { ...snapshot, f: [4, 30] },
      {
        ...snapshot,
        q: [
          [1, 2],
          [1, 3],
        ],
      },
      { ...snapshot, extra: "x".repeat(50000) },
    ]) {
      expect(isSnapshot(value)).toBe(false);
    }
  });
});
