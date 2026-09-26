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
  DriverState,
  PedState,
  PickupState,
  StructureState,
  VehicleState,
} from "../sim/types";
import { WEAPONS } from "../sim/weapons";
import type { Point } from "../world/projection";
import type {
  SnapshotBullet,
  SnapshotCop,
  SnapshotPed,
  SnapshotPlayer,
  SnapshotStructure,
  SnapshotView,
} from "./snapshotWire";

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
    drunk: row.drunk,
    bonus: row.bonus,
    mission: row.mission,
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

/** Where each shooter in the snapshot stands: its players and cops, the only bullet owners. */
function shooterPositions(view: SnapshotView): Map<number, Point> {
  const positions = new Map<number, Point>();
  for (const row of view.players) positions.set(row.id, [row.x, row.y]);
  for (const row of view.cops) positions.set(row.id, [row.x, row.y]);
  return positions;
}

/**
 * Range a round first seen on the wire has left: its weapon's full range less how far it now is
 * from whoever fired it, never below 0; a shooter the snapshot does not list leaves the full range.
 * Clients never step bullets, so this estimate is what the 3D tracers measure a round's flight by.
 */
function estimatedRangeLeft(
  row: SnapshotBullet,
  shooter: Point | undefined,
): number {
  const range = WEAPONS[row.weapon].rangeM;
  if (!shooter) return range;
  const flown = Math.hypot(row.x - shooter[0], row.y - shooter[1]);
  return Math.max(0, range - flown);
}

/**
 * One bullet from the snapshot, keeping what the client already knew about it. A round the client
 * has never seen gets its weapon's speed and a range left estimated from its shooter's position.
 */
function patchBullet(
  row: SnapshotBullet,
  local: BulletState | undefined,
  shooters: ReadonlyMap<number, Point>,
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
    speedMps: local?.speedMps ?? WEAPONS[row.weapon].speedMps,
    rangeLeftM:
      local?.rangeLeftM ?? estimatedRangeLeft(row, shooters.get(row.ownerId)),
    weapon: row.weapon,
  };
}

/**
 * One structure from the snapshot, adopted wholesale (spec §3.6: prediction never changes it).
 * Footprint centre and radius are not on the wire, so a client keeps its own for an id it already
 * knew, or 0 for one it has never seen — matching how the host treats a fresh entry.
 */
function patchStructure(
  row: SnapshotStructure,
  local: StructureState | undefined,
): StructureState {
  return {
    id: row.id,
    damage: row.damage,
    destroyedAtTick: row.destroyedAtTick,
    lastHitTick: row.lastHitTick,
    x: local?.x ?? 0,
    y: local?.y ?? 0,
    radius: local?.radius ?? 0,
  };
}

/** The snapshot's bullets, each patched over the client's own copy of it. */
function patchBullets(view: SnapshotView, known: BulletState[]): BulletState[] {
  const bullets = byId(known);
  const shooters = shooterPositions(view);
  return view.bullets.map((row) =>
    patchBullet(row, bullets.get(row.id), shooters),
  );
}

/** The ambient drivers whose car the host still lists intact and nobody in a seat drives. */
function survivingTraffic(
  traffic: DriverState[],
  view: SnapshotView,
  vehicles: VehicleState[],
): DriverState[] {
  const intact = new Set(
    vehicles.filter((vehicle) => !vehicle.wrecked).map((vehicle) => vehicle.id),
  );
  return traffic.filter(
    (driver) =>
      intact.has(driver.vehicleId) &&
      !view.players.some((row) => row.vehicleId === driver.vehicleId),
  );
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
  const structures = byId(state.structures ?? []);

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
    boarding: row.boarding,
  }));
  const nextPickups: PickupState[] = view.pickups.map((row) => ({
    id: row.id,
    kind: row.kind,
    x: row.x,
    y: row.y,
    takenAtTick: row.takenAtTick,
  }));

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
    roundTicksLeft: view.roundTicksLeft,
    nextId: highestId + 1,
    players: view.players.map((row) => patchPlayer(row, players.get(row.id))),
    vehicles: nextVehicles,
    peds: view.peds.map((row) => patchPed(row, peds.get(row.id))),
    cops: view.cops.map((row) => patchCop(row, cops.get(row.id), view.tick)),
    bullets: patchBullets(view, state.bullets),
    pickups: nextPickups,
    structures: view.structures.map((row) =>
      patchStructure(row, structures.get(row.id)),
    ),
    traffic: survivingTraffic(state.traffic, view, nextVehicles),
    events: [],
  };
}
