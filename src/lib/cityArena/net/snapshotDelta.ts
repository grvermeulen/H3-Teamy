import { MAX_VEHICLES } from "../sim/limits";
import type { Snapshot } from "./snapshotWire";

/** Sends vehicle changes against an independent full baseline every second; lost deltas never accumulate. */
export function createSnapshotEncoder(): (snapshot: Snapshot) => Snapshot {
  let baseline: Snapshot | null = null;
  let rows = new Map<number, number[]>();
  return (snapshot) => {
    if (!baseline || snapshot.t - baseline.t >= 30) {
      baseline = snapshot;
      rows = new Map(snapshot.v.map((row) => [row[0]!, row]));
      return snapshot;
    }
    const present = new Set(snapshot.v.map((row) => row[0]!));
    const v = snapshot.v.filter((row) => {
      const previous = rows.get(row[0]!);
      return !previous || row.some((cell, index) => cell !== previous[index]);
    });
    return {
      ...snapshot,
      r: baseline.t,
      x: [...rows.keys()].filter((id) => !present.has(id)),
      v,
    };
  };
}

/** Reconstructs a complete snapshot, rejecting replays and waiting for a keyframe after packet loss. */
export function createSnapshotDecoder(): (
  snapshot: Snapshot,
) => Snapshot | null {
  let baseline: Snapshot | null = null;
  let lastTick = -1;
  return (snapshot) => {
    if (snapshot.t <= lastTick) return null;
    if (snapshot.r === undefined) {
      baseline = snapshot;
      lastTick = snapshot.t;
      return snapshot;
    }
    if (!baseline || baseline.t !== snapshot.r) return null;
    const removed = new Set(snapshot.x);
    const rows = new Map(
      baseline.v
        .filter((row) => !removed.has(row[0]!))
        .map((row) => [row[0]!, row]),
    );
    for (const row of snapshot.v) rows.set(row[0]!, row);
    if (rows.size > MAX_VEHICLES) return null;
    lastTick = snapshot.t;
    const full = { ...snapshot, v: [...rows.values()] };
    delete full.r;
    delete full.x;
    return full;
  };
}
