/**
 * Folding a host snapshot back into a client's world.
 *
 * The snapshot is not a whole `ArenaState` and is not meant to be: it leaves out AI memory (ped
 * rails, cop paths) and everything render-only (effects, ambient drivers, the event list), because
 * carrying those ten times a second would cost bandwidth for state nobody else needs. So a client
 * keeps a full local state and the snapshot **patches** the authoritative parts of it, entity by
 * entity, preserving the local-only fields of anything it already knows about.
 *
 * Where a field is both absent from the snapshot and load-bearing for the invariant checker — a
 * cop's `diedAtTick` against its health, say — it is derived rather than defaulted, so a patched
 * state is a legal state.
 */

import type {
  ArenaPlayerState,
  ArenaState,
  BulletState,
  CopState,
  PedState,
  PickupState,
  VehicleState,
} from "../sim/types";
import type {
  SnapshotBullet,
  SnapshotCop,
  SnapshotPed,
  SnapshotPlayer,
  SnapshotView,
} from "./snapshotWire";

/** Speed a bullet is assumed to carry when the client has never seen it before. */
const ASSUMED_BULLET_SPEED_MPS = 300;
/** Range a bullet is assumed to have left when the client has never seen it before. */
const ASSUMED_BULLET_RANGE_M = 40;

/** Indexes a list by entity id. */
function byId<T extends { id: number }>(items: T[]): Map<number, T> {
  return new Map(items.map((item) => [item.id, item]));
}

/** One player from the snapshot, keeping the fields it does not carry. */
function patchPlayer(
  row: SnapshotPlayer,
  local: ArenaPlayerState | undefined,
): ArenaPlayerState {
  return {
    id: row.id,
    x: row.x,
    y: row.y,
    facing: row.facing,
    speed: row.speed,
    health: row.health,
    weapon: row.weapon,
    ammo: row.ammo,
    vehicleId: row.vehicleId,
    boardingTicksLeft: row.boardingTicksLeft,
    nextShotTick: row.nextShotTick,
    diedAtTick: row.diedAtTick,
    invulnerableUntilTick: row.invulnerableUntilTick,
    heat: row.heat,
    driveSteer: row.driveSteer,
    // Not on the wire: bookkeeping the host owns but nobody renders.
    heatTick: local?.heatTick ?? 0,
    outsideSinceTick: local?.outsideSinceTick ?? null,
    held: local?.held ?? { enter: false, weaponNext: false },
  };
}

/** One pedestrian from the snapshot, keeping its local rail and schedule. */
function patchPed(row: SnapshotPed, local: PedState | undefined): PedState {
  return {
    id: row.id,
    x: row.x,
    y: row.y,
    facing: row.facing,
    health: row.health,
    mode: row.mode,
    modeUntilTick: local?.modeUntilTick ?? 0,
    rail: local?.rail ?? null,
    fleeX: local?.fleeX ?? 0,
    fleeY: local?.fleeY ?? 0,
  };
}

/**
 * One cop from the snapshot, keeping its local path.
 *
 * `diedAtTick` is derived from health rather than defaulted: the invariant checker requires the
 * two to agree, so a cop the host has killed must arrive dead, not merely at zero health.
 */
function patchCop(
  row: SnapshotCop,
  local: CopState | undefined,
  tick: number,
): CopState {
  const died = row.health === 0 ? (local?.diedAtTick ?? tick) : null;
  return {
    id: row.id,
    x: row.x,
    y: row.y,
    facing: row.facing,
    health: row.health,
    diedAtTick: died,
    weapon: local?.weapon ?? "pistol",
    path: local?.path ?? [],
    repathTick: local?.repathTick ?? tick,
    nextShotTick: local?.nextShotTick ?? tick,
  };
}

/** One bullet from the snapshot, keeping what the client already knew about it. */
function patchBullet(
  row: SnapshotBullet,
  local: BulletState | undefined,
): BulletState {
  return {
    id: row.id,
    ownerId: row.ownerId,
    x: row.x,
    y: row.y,
    directionX: row.directionX,
    directionY: row.directionY,
    damage: row.damage,
    ignoreVehicleId: local?.ignoreVehicleId ?? null,
    speedMps: local?.speedMps ?? ASSUMED_BULLET_SPEED_MPS,
    rangeLeftM: local?.rangeLeftM ?? ASSUMED_BULLET_RANGE_M,
    weapon: local?.weapon ?? "pistol",
  };
}

/**
 * Folds a decoded snapshot into a client's state.
 *
 * Ambient traffic drivers are dropped rather than kept: they reference cars by id, and a driver
 * left pointing at a car the host has since wrecked breaks the invariant that every driver has an
 * intact car. The host owns them, and the client rebuilds them from the next snapshot it steps.
 *
 * @param state - The client's current world, whose local-only fields are preserved.
 * @param view - The decoded snapshot from the host.
 * @returns The client's world, brought up to the host's authoritative state.
 */
export function applySnapshot(
  state: ArenaState,
  view: SnapshotView,
): ArenaState {
  const players = byId(state.players);
  const vehicles = byId(state.vehicles);
  const peds = byId(state.peds);
  const cops = byId(state.cops);
  const bullets = byId(state.bullets);

  const nextVehicles: VehicleState[] = view.vehicles.map((row) => ({
    ...row,
    ...(vehicles.get(row.id) ?? {}),
    id: row.id,
    kind: row.kind,
    x: row.x,
    y: row.y,
    heading: row.heading,
    velocityX: row.velocityX,
    velocityY: row.velocityY,
    health: row.health,
    wrecked: row.wrecked,
    colour: row.colour,
  }));
  const nextPickups: PickupState[] = view.pickups.map((row) => ({
    id: row.id,
    kind: row.kind,
    x: row.x,
    y: row.y,
    takenAtTick: row.takenAtTick,
  }));

  const liveVehicleIds = new Set(nextVehicles.map((vehicle) => vehicle.id));
  const highestId = Math.max(
    state.nextId - 1,
    ...view.players.map((row) => row.id),
    ...nextVehicles.map((vehicle) => vehicle.id),
    ...view.peds.map((row) => row.id),
    ...view.cops.map((row) => row.id),
    ...nextPickups.map((pickup) => pickup.id),
  );

  return {
    ...state,
    tick: view.tick,
    nextId: highestId + 1,
    players: view.players.map((row) => patchPlayer(row, players.get(row.id))),
    vehicles: nextVehicles,
    peds: view.peds.map((row) => patchPed(row, peds.get(row.id))),
    cops: view.cops.map((row) => patchCop(row, cops.get(row.id), view.tick)),
    bullets: view.bullets.map((row) => patchBullet(row, bullets.get(row.id))),
    pickups: nextPickups,
    traffic: state.traffic.filter(
      (driver) =>
        liveVehicleIds.has(driver.vehicleId) &&
        !view.players.some((row) => row.vehicleId === driver.vehicleId) &&
        !nextVehicles.some(
          (vehicle) => vehicle.id === driver.vehicleId && vehicle.wrecked,
        ),
    ),
    events: [],
  };
}
