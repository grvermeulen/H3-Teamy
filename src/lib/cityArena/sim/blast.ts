/**
 * Attributed area damage (spec §3.3, §4, §5): the blast a wrecked car has always dealt, and — once
 * an explosive projectile detonates on impact (`combat.ts`) — the same shape for a shooter's shell
 * or rocket. A car's own blast is flat inside its radius; a projectile's fades linearly to half at
 * the edge ({@link blastFalloff}), and every source scales its structure damage that way.
 */
import { distancePointToPolygon, type Rect } from "../mapBuild/geometry";
import type { Point } from "../world/projection";
import type { ArenaWorld } from "./arenaWorld";
import { damageCop } from "./cops";
import { damagePlayer, damageVehicle } from "./damage";
import { addEffect } from "./effects";
import { pushEvent } from "./events";
import { damagePed } from "./peds";
import { damageStructure } from "./structures";
import type {
  ArenaEvent,
  ArenaPlayerState,
  ArenaState,
  CopState,
  PedState,
  VehicleState,
} from "./types";

/** Damage at the edge of a blast radius, as a fraction of its centre damage. */
export const BLAST_EDGE_FACTOR = 0.5;

/**
 * Fraction of a blast's damage that reaches `distance` from its centre: 1 at the centre, fading
 * linearly to {@link BLAST_EDGE_FACTOR} at `radius`, then 0 beyond it.
 *
 * @param distance - Distance from the blast centre, in metres.
 * @param radius - The blast's radius, in metres.
 * @returns The damage fraction, in `[0, 1]`.
 */
export function blastFalloff(distance: number, radius: number): number {
  if (distance > radius) return 0;
  if (radius <= 0) return distance <= 0 ? 1 : 0;
  return 1 - (1 - BLAST_EDGE_FACTOR) * (distance / radius);
}

/**
 * One area-damage event: a circle of `entityRadius` that hits people and cars, and a (usually
 * larger) circle of `structureRadius` that hits buildings.
 */
export type Blast = {
  x: number;
  y: number;
  /** Radius, in metres, within which people on foot, peds, cops and cars take damage. */
  entityRadius: number;
  /** Damage to a person (player on foot, ped or cop) inside `entityRadius`. */
  entityDamage: number;
  /** Damage to a car whose centre is inside `entityRadius`. */
  vehicleDamage: number;
  /** Radius, in metres, within which a building's footprint takes damage. */
  structureRadius: number;
  /** Damage to a building at its centre; scaled by {@link blastFalloff} at its footprint's nearest point. */
  structureDamage: number;
  /** Who caused the blast, credited on any kill it causes; `null` for a car that exploded on its own. */
  ownerId: number | null;
  /** Whether entity and vehicle damage fades with {@link blastFalloff} (an explosive projectile)
   * or is flat out to `entityRadius` (a car's own explosion, spec §5). Structure damage always
   * uses the falloff, regardless of this flag. */
  entityFalloff: boolean;
};

/** A car explosion's blast (spec §5): flat damage to people and cars, falloff on structures. */
export const CAR_BLAST: Omit<Blast, "x" | "y" | "ownerId"> = {
  entityRadius: 3,
  entityDamage: 80,
  vehicleDamage: 80,
  structureRadius: 6,
  structureDamage: 260,
  entityFalloff: false,
};

/** Damage a blast of `damage` at `radius` deals at `distance`: flat out to the radius, or
 * feathered by {@link blastFalloff} for an explosive projectile. */
function blastAmount(
  distance: number,
  radius: number,
  damage: number,
  entityFalloff: boolean,
): number {
  if (entityFalloff) return damage * blastFalloff(distance, radius);
  return distance < radius ? damage : 0;
}

/** Distance from a blast's centre to a point. */
function blastDistance(blast: Pick<Blast, "x" | "y">, point: Point): number {
  return Math.hypot(point[0] - blast.x, point[1] - blast.y);
}

/** Damages living pedestrians inside a blast, returning those it killed. */
export function blastPeds(
  peds: PedState[],
  blast: Blast,
  tick: number,
): { peds: PedState[]; killed: PedState[] } {
  const killed: PedState[] = [];
  const blasted = peds.map((ped) => {
    const amount = blastAmount(
      blastDistance(blast, [ped.x, ped.y]),
      blast.entityRadius,
      blast.entityDamage,
      blast.entityFalloff,
    );
    const hurt = damagePed(ped, amount, tick);
    if (hurt.mode === "dead" && ped.mode !== "dead") killed.push(hurt);
    return hurt;
  });
  return { peds: blasted, killed };
}

/** Damages living cops inside a blast, returning those it killed. */
export function blastCops(
  cops: CopState[],
  blast: Blast,
  tick: number,
): { cops: CopState[]; killed: CopState[] } {
  const killed: CopState[] = [];
  const blasted = cops.map((cop) => {
    const amount = blastAmount(
      blastDistance(blast, [cop.x, cop.y]),
      blast.entityRadius,
      blast.entityDamage,
      blast.entityFalloff,
    );
    const hurt = damageCop(cop, amount, tick);
    if (hurt.diedAtTick !== null && cop.diedAtTick === null) killed.push(hurt);
    return hurt;
  });
  return { cops: blasted, killed };
}

/** Damages every player on foot inside a blast; a player riding in a car is protected by its
 * body (that car's own occupant, if it is the one exploding, is the caller's business). */
function blastPlayers(
  players: ArenaPlayerState[],
  blast: Blast,
  tick: number,
): { players: ArenaPlayerState[]; killed: ArenaPlayerState[] } {
  const blasted = players.map((player) => {
    if (player.vehicleId !== null) return player;
    const amount = blastAmount(
      blastDistance(blast, [player.x, player.y]),
      blast.entityRadius,
      blast.entityDamage,
      blast.entityFalloff,
    );
    return damagePlayer(player, amount, tick);
  });
  const killed = blasted.filter(
    (player, position) =>
      player.diedAtTick !== null && players[position]?.diedAtTick === null,
  );
  return { players: blasted, killed };
}

/** Damages every car whose centre lies inside `entityRadius`. */
function blastVehicles(vehicles: VehicleState[], blast: Blast): VehicleState[] {
  return vehicles.map((vehicle) => {
    const amount = blastAmount(
      blastDistance(blast, [vehicle.x, vehicle.y]),
      blast.entityRadius,
      blast.vehicleDamage,
      blast.entityFalloff,
    );
    return damageVehicle(vehicle, amount);
  });
}

/** Pushes one `kill` event per blast victim, all credited to the same `killerId`. */
function blastKillEvents(
  events: ArenaEvent[],
  victim: "ped" | "cop" | "player",
  killed: { id: number; x: number; y: number }[],
  killerId: number | null,
): ArenaEvent[] {
  let next = events;
  for (const dead of killed)
    next = pushEvent(next, {
      kind: "kill",
      victim,
      victimId: dead.id,
      killerId,
      x: dead.x,
      y: dead.y,
    });
  return next;
}

/** Every structure whose footprint the blast's `structureRadius` circle overlaps, damaged by
 * {@link blastFalloff} at the nearest footprint point. */
function blastStructures(
  state: ArenaState,
  blast: Blast,
  world: ArenaWorld,
  tick: number,
): ArenaState {
  const rect: Rect = {
    minX: blast.x - blast.structureRadius,
    minY: blast.y - blast.structureRadius,
    maxX: blast.x + blast.structureRadius,
    maxY: blast.y + blast.structureRadius,
  };
  let next = state;
  for (const obstacle of world.collision.query(rect)) {
    if (!obstacle.structure) continue;
    const distance = distancePointToPolygon([blast.x, blast.y], obstacle.ring);
    if (distance > blast.structureRadius) continue;
    const amount =
      blast.structureDamage * blastFalloff(distance, blast.structureRadius);
    next = damageStructure(
      next,
      { obstacle, amount, killerId: blast.ownerId },
      tick,
    );
  }
  return next;
}

/**
 * Applies one blast (spec §3.3, §4, §5): an `explosion` event and effect at its centre, damage to
 * every person, car and structure it reaches, and a `kill` event — credited to `blast.ownerId` —
 * for each victim it finishes off.
 */
export function applyBlast(
  state: ArenaState,
  blast: Blast,
  world: ArenaWorld,
  tick: number,
): ArenaState {
  const pedBlast = blastPeds(state.peds, blast, tick);
  const copBlast = blastCops(state.cops, blast, tick);
  const playerBlast = blastPlayers(state.players, blast, tick);
  const vehicles = blastVehicles(state.vehicles, blast);

  let events = pushEvent(state.events, {
    kind: "explosion",
    x: blast.x,
    y: blast.y,
  });
  events = blastKillEvents(events, "ped", pedBlast.killed, blast.ownerId);
  events = blastKillEvents(events, "cop", copBlast.killed, blast.ownerId);
  events = blastKillEvents(events, "player", playerBlast.killed, blast.ownerId);

  const next: ArenaState = {
    ...state,
    peds: pedBlast.peds,
    cops: copBlast.cops,
    players: playerBlast.players,
    vehicles,
    nextId: state.nextId + 1,
    events,
    effects: addEffect(state.effects, {
      id: state.nextId,
      kind: "explosion",
      x: blast.x,
      y: blast.y,
      angle: 0,
      bornTick: tick,
    }),
  };
  return blastStructures(next, blast, world, tick);
}
