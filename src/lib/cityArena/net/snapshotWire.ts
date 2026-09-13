/**
 * The snapshot half of the wire format (spec §6.3): the whole world for one tick, as flat integer
 * rows, published ten times a second.
 *
 * AI memory — pedestrian rails, cop paths, repath and shot schedules — is deliberately left out.
 * Spec §6.6 accepts that a new host rebuilds it lazily, and carrying it would cost every client
 * bandwidth ten times a second for state nobody renders.
 */

import { VEHICLE_KINDS } from "../sim/vehicle";
import type { MatchPhase, MatchState } from "./matchPhase";
import type { ScoreRow, Tally } from "./scoreboard";
import type {
  AmmoState,
  ArenaState,
  BulletState,
  CopState,
  PedMode,
  PedState,
  PickupKind,
  PickupState,
  VehicleKind,
  VehicleState,
  WeaponKind,
} from "../sim/types";
import {
  MOVE_SCALE,
  NONE,
  POSITION_SCALE,
  STEER_SCALE,
  entryAt,
  indexIn,
  packAngle,
  packOptional,
  quantise,
  unpackAngle,
  unpackOptional,
} from "./wire";

/**
 * Ceiling for one encoded snapshot, well inside Ably's 64 KB message limit (spec §6.4).
 * The test asserting it is a tripwire: adding a field to the hot path should have to justify
 * itself here rather than quietly cost every client bandwidth.
 */
export const MAX_SNAPSHOT_BYTES = 8192;

/** Weapons in wire order; the index travels, not the name. */
const WEAPONS: readonly WeaponKind[] = [
  "fist",
  "pistol",
  "uzi",
  "shotgun",
  "bat",
  "rifle",
  "cannon",
];
/** Pickup kinds in wire order. */
const PICKUP_KINDS: readonly PickupKind[] = [
  "uzi",
  "shotgun",
  "health",
  "rifle",
  "bat",
];
/** Pedestrian modes in wire order. */
const PED_MODES: readonly PedMode[] = ["walk", "flee", "dead"];
/** Match phases in wire order. */
const MATCH_PHASES: readonly MatchPhase[] = [
  "lobby",
  "countdown",
  "playing",
  "scoreboard",
];

/** One full snapshot as it travels; single-letter keys keep the JSON small. */
export type Snapshot = {
  /** Wire protocol version; incompatible snapshots are rejected before decoding. */
  n: 2;
  /** Vehicle baseline tick and removals; absent on full keyframes. */
  r?: number;
  x?: number[];
  t: number;
  s: number;
  p: number[][];
  v: number[][];
  d: number[][];
  c: number[][];
  b: number[][];
  k: number[][];
  q: number[][];
  /**
   * Who drives which player: `[clientId, playerId]`. Player ids are entity ids handed out by the
   * host as people join, not seat numbers, so a client can only learn its own id — and everyone
   * else's, for the scorebord — from the host.
   */
  m?: [string, number][];
  /** Retained seat history for players who left during a round. */
  a?: [string, number][];
  /** The host's tally: `[playerId, kills, deaths]`. A client's predicted kills are not real. */
  y?: number[][];
  /**
   * Where the potje is: `[phase, sinceTick]`. Only the host advances the match (spec §2), so a
   * client reads its countdown and scorebord from here rather than keeping a clock of its own.
   */
  f?: [number, number];
};

/** A player as the snapshot carries them: render state plus what the step needs to continue. */
export type SnapshotPlayer = {
  id: number;
  x: number;
  y: number;
  facing: number;
  speed: number;
  health: number;
  weapon: WeaponKind;
  ammo: AmmoState;
  vehicleId: number | null;
  boardingTicksLeft: number;
  nextShotTick: number;
  diedAtTick: number | null;
  invulnerableUntilTick: number;
  heat: number;
  driveSteer: number;
  drunk: number;
};

/** `drunk` travels as a whole percentage. */
const DRUNK_SCALE = 100;

/** A car as the snapshot carries them. */
export type SnapshotVehicle = Pick<
  VehicleState,
  "id" | "kind" | "x" | "y" | "heading" | "health" | "wrecked" | "colour"
> & { velocityX: number; velocityY: number };

/** A pedestrian as the snapshot carries them; the rail is AI memory, rebuilt locally. */
export type SnapshotPed = Pick<
  PedState,
  "id" | "x" | "y" | "facing" | "health" | "mode"
>;

/** A cop as the snapshot carries them; the path is AI memory, rebuilt locally (spec §6.6). */
export type SnapshotCop = Pick<
  CopState,
  "id" | "x" | "y" | "facing" | "health"
>;

/** A bullet as the snapshot carries them. */
export type SnapshotBullet = Pick<
  BulletState,
  "id" | "ownerId" | "x" | "y" | "damage"
> & { directionX: number; directionY: number };

/** A pickup as the snapshot carries them. */
export type SnapshotPickup = Pick<PickupState, "id" | "kind" | "x" | "y"> & {
  takenAtTick: number | null;
};

/** A snapshot decoded back into named fields, ready for the client loop to reconcile against. */
export type SnapshotView = {
  tick: number;
  serverTimeMs: number;
  players: SnapshotPlayer[];
  vehicles: SnapshotVehicle[];
  peds: SnapshotPed[];
  cops: SnapshotCop[];
  bullets: SnapshotBullet[];
  pickups: SnapshotPickup[];
  lastInputSeqs: Record<number, number>;
  /** Client id to player id, as the host seated them. */
  seats: ReadonlyMap<string, number>;
  accounts: ReadonlyMap<string, number>;
  /** The host's kills and deaths per player. */
  tally: Tally;
  /** Where the host says the potje is; `null` from a host that predates the field. */
  match: MatchState | null;
};

/** What a host adds to a snapshot beyond the world itself. */
export type SnapshotExtras = {
  seats: ReadonlyMap<string, number>;
  accounts?: ReadonlyMap<string, number>;
  tally: Tally;
  match: MatchState;
};

/** The player rows of a snapshot. */
function encodePlayers(state: ArenaState): number[][] {
  return state.players.map((player) => [
    player.id,
    Math.round(player.x * POSITION_SCALE),
    Math.round(player.y * POSITION_SCALE),
    packAngle(player.facing),
    Math.round(player.speed * POSITION_SCALE),
    Math.round(player.health),
    indexIn(WEAPONS, player.weapon),
    player.ammo.uzi,
    player.ammo.shotgun,
    packOptional(player.vehicleId),
    player.boardingTicksLeft,
    player.nextShotTick,
    packOptional(player.diedAtTick),
    player.invulnerableUntilTick,
    Math.round(player.heat),
    quantise(player.driveSteer, STEER_SCALE, STEER_SCALE),
    // Appended past the original sixteen, so an older row still decodes.
    player.ammo.rifle,
    player.ammo.bat,
    // Appended again for the brewery (Plan 10), for the same reason.
    Math.round(player.drunk * DRUNK_SCALE),
  ]);
}

/** The car rows of a snapshot. */
function encodeVehicles(state: ArenaState): number[][] {
  return state.vehicles.map((vehicle) => [
    vehicle.id,
    indexIn(VEHICLE_KINDS, vehicle.kind),
    Math.round(vehicle.x * POSITION_SCALE),
    Math.round(vehicle.y * POSITION_SCALE),
    packAngle(vehicle.heading),
    Math.round(vehicle.velocityX * POSITION_SCALE),
    Math.round(vehicle.velocityY * POSITION_SCALE),
    Math.round(vehicle.health),
    vehicle.wrecked ? 1 : 0,
    vehicle.colour,
  ]);
}

/** The host's additions to a snapshot: who sits where, the tally, and where the potje is. */
function encodeExtras(
  extras: SnapshotExtras,
): Pick<Snapshot, "m" | "a" | "y" | "f"> {
  return {
    m: [...extras.seats.entries()],
    ...(extras.accounts ? { a: [...extras.accounts.entries()] } : {}),
    y: [...extras.tally.values()].map((row) => [
      row.playerId,
      row.kills,
      row.deaths,
    ]),
    f: [indexIn(MATCH_PHASES, extras.match.phase), extras.match.since],
  };
}

/**
 * Encodes the whole world for one tick.
 *
 * @param state - The host's arena state.
 * @param serverTimeMs - The host's server time, which clients interpolate against.
 * @param lastInputSeqs - The last input sequence number applied, per player id.
 * @returns The snapshot to publish.
 */
export function encodeSnapshot(
  state: ArenaState,
  serverTimeMs: number,
  lastInputSeqs: Record<number, number>,
  extras?: SnapshotExtras,
): Snapshot {
  return {
    ...(extras ? encodeExtras(extras) : {}),
    n: 2,
    t: state.tick,
    s: Math.round(serverTimeMs),
    p: encodePlayers(state),
    v: encodeVehicles(state),
    d: state.peds.map((ped) => [
      ped.id,
      Math.round(ped.x * POSITION_SCALE),
      Math.round(ped.y * POSITION_SCALE),
      packAngle(ped.facing),
      Math.round(ped.health),
      indexIn(PED_MODES, ped.mode),
    ]),
    c: state.cops.map((cop) => [
      cop.id,
      Math.round(cop.x * POSITION_SCALE),
      Math.round(cop.y * POSITION_SCALE),
      packAngle(cop.facing),
      Math.round(cop.health),
    ]),
    b: state.bullets.map((bullet) => [
      bullet.id,
      bullet.ownerId,
      Math.round(bullet.x * POSITION_SCALE),
      Math.round(bullet.y * POSITION_SCALE),
      quantise(bullet.directionX, MOVE_SCALE, MOVE_SCALE),
      quantise(bullet.directionY, MOVE_SCALE, MOVE_SCALE),
      Math.round(bullet.damage),
    ]),
    k: state.pickups.map((pickup) => [
      pickup.id,
      indexIn(PICKUP_KINDS, pickup.kind),
      Math.round(pickup.x * POSITION_SCALE),
      Math.round(pickup.y * POSITION_SCALE),
      packOptional(pickup.takenAtTick),
    ]),
    q: Object.entries(lastInputSeqs).map(([id, seq]) => [Number(id), seq]),
  };
}

/** Decodes the player rows of a snapshot. */
function decodePlayers(rows: number[][]): SnapshotPlayer[] {
  return rows.map((row) => ({
    id: row[0] ?? 0,
    x: (row[1] ?? 0) / POSITION_SCALE,
    y: (row[2] ?? 0) / POSITION_SCALE,
    facing: unpackAngle(row[3] ?? 0),
    speed: (row[4] ?? 0) / POSITION_SCALE,
    health: row[5] ?? 0,
    weapon: entryAt(WEAPONS, row[6] ?? 0),
    ammo: {
      uzi: row[7] ?? 0,
      shotgun: row[8] ?? 0,
      rifle: row[16] ?? 0,
      bat: row[17] ?? 0,
    },
    vehicleId: unpackOptional(row[9] ?? NONE),
    boardingTicksLeft: row[10] ?? 0,
    nextShotTick: row[11] ?? 0,
    diedAtTick: unpackOptional(row[12] ?? NONE),
    invulnerableUntilTick: row[13] ?? 0,
    heat: row[14] ?? 0,
    driveSteer: (row[15] ?? 0) / STEER_SCALE,
    drunk: (row[18] ?? 0) / DRUNK_SCALE,
  }));
}

/** Decodes the car rows of a snapshot. */
function decodeVehicles(rows: number[][]): SnapshotVehicle[] {
  return rows.map((row) => ({
    id: row[0] ?? 0,
    kind: entryAt(VEHICLE_KINDS, row[1] ?? 0),
    x: (row[2] ?? 0) / POSITION_SCALE,
    y: (row[3] ?? 0) / POSITION_SCALE,
    heading: unpackAngle(row[4] ?? 0),
    velocityX: (row[5] ?? 0) / POSITION_SCALE,
    velocityY: (row[6] ?? 0) / POSITION_SCALE,
    health: row[7] ?? 0,
    wrecked: (row[8] ?? 0) === 1,
    colour: row[9] ?? 0,
  }));
}

/**
 * Decodes a snapshot back into named fields.
 *
 * @param snapshot - A snapshot produced by {@link encodeSnapshot}.
 * @returns The world it carried, with positions back in metres and angles in radians.
 */
export function decodeSnapshot(snapshot: Snapshot): SnapshotView {
  const lastInputSeqs: Record<number, number> = {};
  for (const [id = 0, seq = 0] of snapshot.q) lastInputSeqs[id] = seq;
  const tally = new Map<number, ScoreRow>();
  for (const [playerId = 0, kills = 0, deaths = 0] of snapshot.y ?? [])
    tally.set(playerId, { playerId, kills, deaths });
  return {
    seats: new Map(snapshot.m ?? []),
    accounts: new Map(snapshot.a ?? snapshot.m ?? []),
    tally,
    match: snapshot.f
      ? { phase: entryAt(MATCH_PHASES, snapshot.f[0]), since: snapshot.f[1] }
      : null,
    tick: snapshot.t,
    serverTimeMs: snapshot.s,
    players: decodePlayers(snapshot.p),
    vehicles: decodeVehicles(snapshot.v),
    peds: snapshot.d.map((row) => ({
      id: row[0] ?? 0,
      x: (row[1] ?? 0) / POSITION_SCALE,
      y: (row[2] ?? 0) / POSITION_SCALE,
      facing: unpackAngle(row[3] ?? 0),
      health: row[4] ?? 0,
      mode: entryAt(PED_MODES, row[5] ?? 0),
    })),
    cops: snapshot.c.map((row) => ({
      id: row[0] ?? 0,
      x: (row[1] ?? 0) / POSITION_SCALE,
      y: (row[2] ?? 0) / POSITION_SCALE,
      facing: unpackAngle(row[3] ?? 0),
      health: row[4] ?? 0,
    })),
    bullets: snapshot.b.map((row) => ({
      id: row[0] ?? 0,
      ownerId: row[1] ?? 0,
      x: (row[2] ?? 0) / POSITION_SCALE,
      y: (row[3] ?? 0) / POSITION_SCALE,
      directionX: (row[4] ?? 0) / MOVE_SCALE,
      directionY: (row[5] ?? 0) / MOVE_SCALE,
      damage: row[6] ?? 0,
    })),
    pickups: snapshot.k.map((row) => ({
      id: row[0] ?? 0,
      kind: entryAt(PICKUP_KINDS, row[1] ?? 0),
      x: (row[2] ?? 0) / POSITION_SCALE,
      y: (row[3] ?? 0) / POSITION_SCALE,
      takenAtTick: unpackOptional(row[4] ?? NONE),
    })),
    lastInputSeqs,
  };
}

/**
 * The size one snapshot takes on the wire.
 *
 * @param snapshot - The snapshot to measure.
 * @returns Its length in bytes as JSON, which is what Ably counts.
 */
export function snapshotBytes(snapshot: Snapshot): number {
  return new TextEncoder().encode(JSON.stringify(snapshot)).length;
}
