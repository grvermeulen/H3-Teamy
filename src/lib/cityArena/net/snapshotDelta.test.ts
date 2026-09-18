import { describe, expect, it } from "vitest";
import { createSnapshotDecoder, createSnapshotEncoder } from "./snapshotDelta";
import type { Snapshot } from "./snapshotWire";
import { isSnapshot } from "./wireValidation";

const packet = (
  tick: number,
  vehicles = [[1, 0, 0, 0, 0, 0, 0, 100, 0, 0]],
): Snapshot => ({
  n: 3,
  t: tick,
  s: tick * 34,
  p: [],
  v: vehicles,
  d: [],
  c: [],
  b: [],
  k: [],
  q: [],
});

describe("snapshot vehicle baselines", () => {
  it("preserves armoured vehicle health above one byte through full and delta frames", () => {
    const encode = createSnapshotEncoder();
    const decode = createSnapshotDecoder();
    const tank = [1, 9, 0, 0, 0, 0, 0, 750, 0, 0];
    const full = encode(packet(3, [tank]));
    expect(isSnapshot(full)).toBe(true);
    expect(decode(full)?.v[0][7]).toBe(750);
    const damaged = [...tank];
    damaged[7] = 599;
    const delta = encode(packet(6, [damaged]));
    expect(isSnapshot(delta)).toBe(true);
    expect(decode(delta)?.v[0][7]).toBe(599);
  });
  it("recovers independently after lost/reordered deltas and carries additions and removals", () => {
    const encode = createSnapshotEncoder();
    const decode = createSnapshotDecoder();
    const first = packet(3);
    expect(decode(encode(first))).toEqual(first);
    const lost = encode(packet(6, [[1, 0, 100, 0, 0, 0, 0, 100, 0, 0]]));
    const changed = packet(9, [[2, 0, 300, 0, 0, 0, 0, 100, 0, 0]]);
    const delta = encode(changed);
    expect(isSnapshot(delta)).toBe(true);
    expect(decode(delta)).toEqual(changed);
    expect(decode(lost)).toBeNull();
    expect(decode(delta)).toBeNull();
  });
  it("waits for the next full frame when its baseline was lost", () => {
    const encode = createSnapshotEncoder();
    const decode = createSnapshotDecoder();
    encode(packet(3));
    expect(decode(encode(packet(6)))).toBeNull();
    const full = packet(33);
    expect(decode(encode(full))).toEqual(full);
    expect(decode(encode(packet(36)))).toEqual(packet(36));
  });
  it("omits unchanged parked vehicles and does not alias the baseline", () => {
    const encode = createSnapshotEncoder();
    const first = packet(3);
    encode(first);
    expect(encode(packet(6)).v).toEqual([]);
    expect(first.v).toHaveLength(1);
  });
});
