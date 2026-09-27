import { describe, expect, it } from "vitest";
import { MAX_STRUCTURES } from "../sim/structures";
import { isInputFrame, isSnapshot } from "./wireValidation";
import type { Snapshot } from "./snapshotWire";

const snapshot: Snapshot = {
  n: 3,
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

describe("structures and rockets on the wire (Task 5)", () => {
  it("accepts every player-row width the wire has ever used: 19, 22 and 23 columns", () => {
    for (const width of [19, 22, 23]) {
      expect(isSnapshot({ ...snapshot, p: [Array(width).fill(0)] })).toBe(true);
    }
  });

  it("accepts a bullet row from before and after the rocket launcher: 7 and 8 columns", () => {
    for (const width of [7, 8]) {
      expect(isSnapshot({ ...snapshot, b: [Array(width).fill(0)] })).toBe(true);
    }
  });

  it("rejects a bullet's weapon index once it is out of the wire table's range", () => {
    expect(isSnapshot({ ...snapshot, b: [[0, 0, 0, 0, 0, 0, 0, 99]] })).toBe(
      false,
    );
  });

  it("accepts a z row at every valid value, including NONE for destroyedAtTick", () => {
    expect(isSnapshot({ ...snapshot, z: [[1, 200, -1, 40]] })).toBe(true);
    expect(isSnapshot({ ...snapshot, z: [[2, 480, 90, 90]] })).toBe(true);
  });

  it("accepts up to MAX_STRUCTURES rows but rejects one more", () => {
    const atCap = Array.from({ length: MAX_STRUCTURES }, (_, index) => [
      index,
      0,
      -1,
      0,
    ]);
    expect(isSnapshot({ ...snapshot, z: atCap })).toBe(true);
    const overCap = [...atCap, [MAX_STRUCTURES, 0, -1, 0]];
    expect(isSnapshot({ ...snapshot, z: overCap })).toBe(false);
  });

  it("rejects a structure row that is not exactly 4 columns", () => {
    expect(isSnapshot({ ...snapshot, z: [[1, 200, -1]] })).toBe(false);
    expect(isSnapshot({ ...snapshot, z: [[1, 200, -1, 40, 0]] })).toBe(false);
  });

  it("rejects a destroyedAtTick below NONE", () => {
    expect(isSnapshot({ ...snapshot, z: [[1, 200, -2, 40]] })).toBe(false);
  });
});
