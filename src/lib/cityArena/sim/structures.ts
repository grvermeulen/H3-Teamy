/**
 * Structure damage, collapse and rebuild (spec §3): buildings absorb bullet damage, collapse once
 * their health runs out — crushing whatever stands inside or right up against the wall — and
 * quietly rebuild once nobody stands in the footprint any more. `ArenaState.structures` is sparse:
 * a building nobody has hit has no entry and is implicitly at full health.
 */
import { distancePointToPolygon, polygonCentroid } from "../mapBuild/geometry";
import type { Obstacle } from "../world/collisionGrid";
import type { Point } from "../world/projection";
import { aliveCops, damageCop } from "./cops";
import { damagePlayer, damageVehicle, isDead } from "./damage";
import { pushEvent } from "./events";
import { alivePeds, damagePed } from "./peds";
import { orderedPlayers } from "./players";
import type {
  ArenaPlayerState,
  ArenaState,
  CopState,
  PedState,
  StructureState,
  VehicleState,
} from "./types";

/** Sparse structure-state cap (spec §3.4): the least-damaged intact entry is dropped first. */
export const MAX_STRUCTURES = 48;
/** Ticks of no hits before an intact structure's damage heals away (spec §3.4: 90 s). */
export const STRUCTURE_HEAL_TICKS = 2700;
/** Ticks after a collapse before the structure rebuilds, once its footprint is empty (spec §3.4: 4 min). */
export const STRUCTURE_REBUILD_TICKS = 7200;
/** Share of a bullet's damage that reaches the building it hits (spec §3.3). */
export const BULLET_STRUCTURE_FACTOR = 0.25;
/** Damage a collapse deals to a person caught in or near the footprint (spec §3.5). */
export const CRUSH_PERSON_DAMAGE = 60;
/** Damage a collapse deals to a car whose centre is in or near the footprint (spec §3.5). */
export const CRUSH_VEHICLE_DAMAGE = 120;
/** Margin beyond a footprint's edge that still counts as caught in the collapse. */
export const CRUSH_MARGIN_M = 1.5;

/** One hit against a building: which obstacle, how much damage, and who is credited if it collapses. */
export type StructureHit = {
  obstacle: Obstacle;
  amount: number;
  killerId: number | null;
};

/** The ids of every collapsed structure, for `withoutStructures` (`world/collisionView.ts`). */
export function destroyedStructureIds(
  state: Pick<ArenaState, "structures">,
): ReadonlySet<number> {
  const destroyed = (state.structures ?? []).filter(
    (entry) => entry.destroyedAtTick !== null,
  );
  return new Set(destroyed.map((entry) => entry.id));
}

/** Fraction of `maxHealth` a structure has absorbed, 0 for an absent (untouched) entry. */
export function structureDamageShare(
  entry: StructureState | undefined,
  maxHealth: number,
): number {
  if (!entry || !Number.isFinite(maxHealth) || maxHealth <= 0) return 0;
  return Math.min(1, entry.damage / maxHealth);
}

/** Greatest distance from `centre` to a footprint vertex: the circle the rebuild check uses. */
function circumradius(ring: readonly Point[], centre: Point): number {
  let radius = 0;
  for (const point of ring) {
    const distance = Math.hypot(point[0] - centre[0], point[1] - centre[1]);
    if (distance > radius) radius = distance;
  }
  return radius;
}

/** Drops one entry to respect {@link MAX_STRUCTURES}: the least-damaged intact entry, or — once
 * everything left is rubble — the one that collapsed longest ago. */
function dropForCap(structures: StructureState[]): StructureState[] {
  if (structures.length <= MAX_STRUCTURES) return structures;
  const intact = structures.filter((entry) => entry.destroyedAtTick === null);
  const victim =
    intact.length > 0
      ? intact.reduce((least, entry) =>
          entry.damage < least.damage ? entry : least,
        )
      : structures.reduce((oldest, entry) =>
          (entry.destroyedAtTick ?? 0) < (oldest.destroyedAtTick ?? 0)
            ? entry
            : oldest,
        );
  return structures.filter((entry) => entry.id !== victim.id);
}

/** A person or vehicle a collapse killed, for the `kill` event it pushes. */
type CrushVictim = { id: number; x: number; y: number };

/** True for a point at or within {@link CRUSH_MARGIN_M} of a footprint. */
function inCrushZone(point: Point, ring: readonly Point[]): boolean {
  return distancePointToPolygon(point, [...ring]) <= CRUSH_MARGIN_M;
}

/** Crushes every player on foot inside the footprint or its margin. */
function crushPlayers(
  players: ArenaPlayerState[],
  ring: readonly Point[],
  tick: number,
): { players: ArenaPlayerState[]; killed: CrushVictim[] } {
  const killed: CrushVictim[] = [];
  const next = players.map((player) => {
    if (player.vehicleId !== null || isDead(player)) return player;
    if (!inCrushZone([player.x, player.y], ring)) return player;
    const hurt = damagePlayer(player, CRUSH_PERSON_DAMAGE, tick);
    if (hurt.diedAtTick !== null && player.diedAtTick === null)
      killed.push({ id: hurt.id, x: hurt.x, y: hurt.y });
    return hurt;
  });
  return { players: next, killed };
}

/** Crushes every living pedestrian inside the footprint or its margin. */
function crushPeds(
  peds: PedState[],
  ring: readonly Point[],
  tick: number,
): { peds: PedState[]; killed: CrushVictim[] } {
  const killed: CrushVictim[] = [];
  const next = peds.map((ped) => {
    if (ped.mode === "dead" || !inCrushZone([ped.x, ped.y], ring)) return ped;
    const hurt = damagePed(ped, CRUSH_PERSON_DAMAGE, tick);
    if (hurt.mode === "dead")
      killed.push({ id: hurt.id, x: hurt.x, y: hurt.y });
    return hurt;
  });
  return { peds: next, killed };
}

/** Crushes every living cop inside the footprint or its margin. */
function crushCops(
  cops: CopState[],
  ring: readonly Point[],
  tick: number,
): { cops: CopState[]; killed: CrushVictim[] } {
  const killed: CrushVictim[] = [];
  const next = cops.map((cop) => {
    if (cop.diedAtTick !== null || !inCrushZone([cop.x, cop.y], ring))
      return cop;
    const hurt = damageCop(cop, CRUSH_PERSON_DAMAGE, tick);
    if (hurt.diedAtTick !== null)
      killed.push({ id: hurt.id, x: hurt.x, y: hurt.y });
    return hurt;
  });
  return { cops: next, killed };
}

/** Crushes every car whose centre lies inside the footprint or its margin; no kill event — a
 * wrecked car is picked up by `applyExplosions` on a later tick once its health reaches 0. */
function crushVehicles(
  vehicles: VehicleState[],
  ring: readonly Point[],
): VehicleState[] {
  return vehicles.map((vehicle) =>
    inCrushZone([vehicle.x, vehicle.y], ring)
      ? damageVehicle(vehicle, CRUSH_VEHICLE_DAMAGE)
      : vehicle,
  );
}

/** Pushes one `kill` event per crush victim, all attributed to the same killer. */
function crushKillEvents(
  state: ArenaState,
  victim: "player" | "ped" | "cop",
  killed: CrushVictim[],
  killerId: number | null,
): ArenaState {
  let events = state.events;
  for (const dead of killed)
    events = pushEvent(events, {
      kind: "kill",
      victim,
      victimId: dead.id,
      killerId,
      x: dead.x,
      y: dead.y,
    });
  return { ...state, events };
}

/**
 * Crushes everything caught in or near a collapsing footprint and pushes the `collapse` event
 * (spec §3.5), mirroring `explodeVehicle` in `combat.ts`: damage every kind of victim, then record
 * a `kill` for each one the crush finished off.
 */
function collapseStructure(
  state: ArenaState,
  obstacle: Obstacle,
  entry: StructureState,
  killerId: number | null,
  tick: number,
): ArenaState {
  const ring = obstacle.ring;
  const players = crushPlayers(state.players, ring, tick);
  const peds = crushPeds(state.peds, ring, tick);
  const cops = crushCops(state.cops, ring, tick);
  const vehicles = crushVehicles(state.vehicles, ring);
  let next: ArenaState = {
    ...state,
    players: players.players,
    peds: peds.peds,
    cops: cops.cops,
    vehicles,
    events: pushEvent(state.events, {
      kind: "collapse",
      structureId: entry.id,
      x: entry.x,
      y: entry.y,
      killerId,
    }),
  };
  next = crushKillEvents(next, "player", players.killed, killerId);
  next = crushKillEvents(next, "ped", peds.killed, killerId);
  next = crushKillEvents(next, "cop", cops.killed, killerId);
  return next;
}

/** Replaces or appends `updated` in `structures`, capping and re-sorting by id when it is new. */
function upsertStructure(
  structures: StructureState[],
  updated: StructureState,
  isNew: boolean,
): StructureState[] {
  const merged = isNew
    ? dropForCap([...structures, updated])
    : structures.map((entry) => (entry.id === updated.id ? updated : entry));
  return [...merged].sort((a, b) => a.id - b.id);
}

/**
 * Applies one hit to the building `hit.obstacle` names, ignoring landmarks (`maxHealth ===
 * Infinity`), non-positive damage and hits on an already-destroyed entry. Once accumulated damage
 * reaches the building's `maxHealth`, it collapses: a `collapse` event, and a crush pass over
 * everything in or near the footprint (spec §3).
 */
export function damageStructure(
  state: ArenaState,
  hit: StructureHit,
  tick: number,
): ArenaState {
  const structure = hit.obstacle.structure;
  if (!structure || hit.amount <= 0 || structure.maxHealth === Infinity)
    return state;
  const structures = state.structures ?? [];
  const existing = structures.find((entry) => entry.id === structure.id);
  if (existing && existing.destroyedAtTick !== null) return state;

  const centre = polygonCentroid(hit.obstacle.ring);
  const damage = (existing?.damage ?? 0) + hit.amount;
  const destroyed = damage >= structure.maxHealth;
  const updated: StructureState = {
    id: structure.id,
    damage,
    destroyedAtTick: destroyed ? tick : null,
    lastHitTick: tick,
    x: centre[0],
    y: centre[1],
    radius: circumradius(hit.obstacle.ring, centre),
  };
  const next: ArenaState = {
    ...state,
    structures: upsertStructure(structures, updated, existing === undefined),
  };
  return destroyed
    ? collapseStructure(next, hit.obstacle, updated, hit.killerId, tick)
    : next;
}

/** True when a living player, pedestrian, cop or car sits within `radius` of `(x, y)`. */
function anyLivingWithin(
  state: ArenaState,
  entry: Pick<StructureState, "x" | "y">,
  radius: number,
): boolean {
  const within = (x: number, y: number): boolean =>
    Math.hypot(x - entry.x, y - entry.y) <= radius;
  if (
    orderedPlayers(state).some(
      (player) => !isDead(player) && within(player.x, player.y),
    )
  )
    return true;
  if (alivePeds(state.peds).some((ped) => within(ped.x, ped.y))) return true;
  if (aliveCops(state.cops).some((cop) => within(cop.x, cop.y))) return true;
  return state.vehicles.some(
    (vehicle) => !vehicle.wrecked && within(vehicle.x, vehicle.y),
  );
}

/** True when an intact entry should keep its accumulated damage: it was hit within the last
 * {@link STRUCTURE_HEAL_TICKS} ticks. */
function stillDamaged(entry: StructureState, tick: number): boolean {
  return tick - entry.lastHitTick < STRUCTURE_HEAL_TICKS;
}

/** True when a destroyed entry should stay rubble: either its rebuild timer has not elapsed, or
 * (having elapsed) something still occupies the footprint — skipped for a radius-0 entry, which
 * carries no footprint to check (spec §3.4). */
function stillRubble(
  state: ArenaState,
  entry: StructureState,
  tick: number,
): boolean {
  if (entry.destroyedAtTick === null) return false;
  if (tick - entry.destroyedAtTick < STRUCTURE_REBUILD_TICKS) return true;
  return entry.radius > 0 && anyLivingWithin(state, entry, entry.radius);
}

/**
 * Heals undamaged-since entries and rebuilds destroyed ones whose footprint has stood empty for
 * long enough (spec §3.4), dropping them from the sparse list either way.
 */
export function stepStructures(state: ArenaState, tick: number): ArenaState {
  const structures = state.structures;
  if (!structures || structures.length === 0) return state;
  const next = structures.filter((entry) =>
    entry.destroyedAtTick === null
      ? stillDamaged(entry, tick)
      : stillRubble(state, entry, tick),
  );
  return next.length === structures.length
    ? state
    : { ...state, structures: next };
}
