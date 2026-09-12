import { MAX_BULLETS } from "../sim/bullets";
import {
  MAX_ARENA_PLAYERS,
  MAX_COPS,
  MAX_PEDS,
  MAX_PICKUPS,
  MAX_VEHICLES,
} from "../sim/limits";
import type { Snapshot } from "./snapshotWire";
import { VEHICLE_KINDS } from "../sim/vehicle";
import type { InputFrame } from "./wire";

/** Maximum accepted snapshot, including room metadata, below Ably's 64 KiB limit. */
export const MAX_WIRE_SNAPSHOT_BYTES = 48 * 1024;
const MAX_TICK = 2_147_483_647;
const SNAPSHOT_KEYS = new Set([
  "n",
  "t",
  "s",
  "p",
  "v",
  "d",
  "c",
  "b",
  "k",
  "q",
  "m",
  "a",
  "y",
  "f",
  "r",
  "x",
]);
const rejected = { input: 0, snapshot: 0 };

/** Counts rejected packets locally; hostile payloads never enter error reporting. */
export function recordInvalidWireMessage(kind: keyof typeof rejected): void {
  rejected[kind] = Math.min(Number.MAX_SAFE_INTEGER, rejected[kind] + 1);
}

/** Aggregate protocol diagnostics without retaining payloads or peer identifiers. */
export function wireDiagnostics(): Readonly<typeof rejected> {
  return { ...rejected };
}

function integer(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
  );
}

/** Accepts only the exact five-field input protocol, including known button bits. */
export function isInputFrame(value: unknown): value is InputFrame {
  return (
    Array.isArray(value) &&
    value.length === 5 &&
    integer(value[0], 0, MAX_TICK) &&
    integer(value[1], -100, 100) &&
    integer(value[2], -100, 100) &&
    integer(value[3], -1, 255) &&
    integer(value[4], 0, 15)
  );
}

function rows(
  value: unknown,
  width: number,
  limit: number,
): value is number[][] {
  if (!Array.isArray(value) || value.length > limit) return false;
  const ids = new Set<number>();
  for (const row of value) {
    if (!Array.isArray(row) || row.length !== width) return false;
    for (const cell of row)
      if (!integer(cell, -MAX_TICK, MAX_TICK)) return false;
    const id: number = row[0];
    if (id < 0 || ids.has(id)) return false;
    ids.add(id);
  }
  return true;
}

/** Validates bounded row collections before any decode, replay or seat allocation. */
export function isSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;
  if (Object.keys(snapshot).some((key) => !SNAPSHOT_KEYS.has(key)))
    return false;
  if (
    snapshot.n !== 2 ||
    !integer(snapshot.t, 0, MAX_TICK) ||
    !integer(snapshot.s, 0, Number.MAX_SAFE_INTEGER)
  )
    return false;
  if (
    snapshot.r !== undefined &&
    (!integer(snapshot.r, 0, snapshot.t - 1) ||
      !Array.isArray(snapshot.x) ||
      snapshot.x.length > MAX_VEHICLES ||
      snapshot.x.some((id) => !integer(id, 0, MAX_TICK)) ||
      new Set(snapshot.x).size !== snapshot.x.length)
  )
    return false;
  if (snapshot.r === undefined && snapshot.x !== undefined) return false;
  if (
    !rows(snapshot.p, 19, MAX_ARENA_PLAYERS) ||
    !rows(snapshot.v, 10, MAX_VEHICLES) ||
    !rows(snapshot.d, 6, MAX_PEDS) ||
    !rows(snapshot.c, 5, MAX_COPS) ||
    !rows(snapshot.b, 7, MAX_BULLETS) ||
    !rows(snapshot.k, 5, MAX_PICKUPS) ||
    !rows(snapshot.q, 2, MAX_ARENA_PLAYERS)
  )
    return false;
  if (snapshot.q.some((row) => row[1]! < 0)) return false;
  if (
    snapshot.p.some(
      (row) =>
        !integer(row[3], 0, 255) ||
        !integer(row[5], 0, 100) ||
        !integer(row[6], 0, 6) ||
        !integer(row[7], 0, 10_000) ||
        !integer(row[8], 0, 10_000) ||
        !integer(row[9], -1, MAX_TICK) ||
        !integer(row[10], 0, 100) ||
        !integer(row[11], 0, MAX_TICK) ||
        !integer(row[12], -1, MAX_TICK) ||
        !integer(row[13], 0, MAX_TICK) ||
        !integer(row[14], 0, 10_000) ||
        !integer(row[15], -100, 100) ||
        !integer(row[16], 0, 10_000) ||
        !integer(row[17], 0, 10_000) ||
        !integer(row[18], 0, 100),
    )
  )
    return false;
  if (
    snapshot.v.some(
      (row) =>
        !integer(row[1], 0, VEHICLE_KINDS.length - 1) ||
        !integer(row[4], 0, 255) ||
        !integer(row[7], 0, 10_000) ||
        !integer(row[8], 0, 1) ||
        !integer(row[9], 0, 255),
    )
  )
    return false;
  if (
    snapshot.d.some(
      (row) =>
        !integer(row[3], 0, 255) ||
        !integer(row[4], 0, 1000) ||
        !integer(row[5], 0, 2),
    )
  )
    return false;
  if (
    snapshot.c.some(
      (row) => !integer(row[3], 0, 255) || !integer(row[4], 0, 1000),
    )
  )
    return false;
  if (
    snapshot.k.some(
      (row) => !integer(row[1], 0, 4) || !integer(row[4], -1, MAX_TICK),
    )
  )
    return false;
  if (snapshot.y !== undefined && !rows(snapshot.y, 3, 64)) return false;
  if (
    Array.isArray(snapshot.y) &&
    snapshot.y.some((row) => row[1] < 0 || row[2] < 0)
  )
    return false;
  if (
    snapshot.f !== undefined &&
    (!Array.isArray(snapshot.f) ||
      snapshot.f.length !== 2 ||
      !integer(snapshot.f[0], 0, 3) ||
      !integer(snapshot.f[1], 0, MAX_TICK))
  )
    return false;
  for (const [value, limit] of [
    [snapshot.m, MAX_ARENA_PLAYERS],
    [snapshot.a, 64],
  ] as const) {
    if (value === undefined) continue;
    if (!Array.isArray(value) || value.length > limit) return false;
    const clients = new Set<string>();
    const seats = new Set<number>();
    for (const row of value) {
      if (
        !Array.isArray(row) ||
        row.length !== 2 ||
        typeof row[0] !== "string" ||
        row[0].length < 1 ||
        row[0].length > 64 ||
        !integer(row[1], 0, MAX_TICK) ||
        clients.has(row[0]) ||
        seats.has(row[1])
      )
        return false;
      clients.add(row[0]);
      seats.add(row[1]);
    }
  }
  return (
    new TextEncoder().encode(JSON.stringify(snapshot)).byteLength <=
    MAX_WIRE_SNAPSHOT_BYTES
  );
}
