/**
 * Firing, bullets, hits and explosions. Every player on foot is a bullet target and every player in
 * range takes the blast — the bullet layer below already excludes the shooter by owner id.
 */
import {
  driverPlayer,
  orderedPlayers,
  playerById,
  replacePlayer,
} from "./players";
import type { Point } from "../world/projection";
import {
  MAX_BULLETS,
  createShots,
  stepBullets,
  type BulletHit,
  type PlayerTarget,
} from "./bullets";
import {
  EXPLOSION_DAMAGE,
  LETHAL_DAMAGE,
  damagePlayer,
  damageVehicle,
  inBlastRadius,
  isDead,
} from "./damage";
import { addEffect } from "./effects";
import { pushEvent } from "./events";
import { applyEntityHit } from "./hits";
import { aliveCops, blastCops } from "./cops";
import { alivePeds, blastPeds } from "./peds";
import type {
  ArenaPlayerState,
  ArenaState,
  BulletState,
  EffectState,
  HitTargetKind,
  VehicleState,
  WorldInput,
} from "./types";
import { WEAPONS, consumeAmmo, cooldownTicks, hasAmmo } from "./weapons";
import { exitVehicle } from "./boarding";
import type { ArenaWorld } from "./arenaWorld";

/** Ammo, weapon and cooldown after one trigger pull; an emptied magazine falls back to the pistol. */
function afterShot(player: ArenaPlayerState, tick: number): ArenaPlayerState {
  const ammo = consumeAmmo(player.ammo, player.weapon);
  return {
    ...player,
    ammo,
    weapon: hasAmmo(ammo, player.weapon) ? player.weapon : "pistol",
    nextShotTick: tick + cooldownTicks(player.weapon),
  };
}

/** True when the trigger can fire this tick: alive, cooldown elapsed, ammo left and under the bullet cap. */
function canFire(
  state: ArenaState,
  player: ArenaPlayerState,
  input: WorldInput,
  tick: number,
): boolean {
  return (
    input.fire &&
    !isDead(player) &&
    tick >= player.nextShotTick &&
    hasAmmo(player.ammo, player.weapon) &&
    state.bullets.length < MAX_BULLETS
  );
}

/** The pellets, effects list and next free id produced by one trigger pull. */
type FireResult = {
  shots: BulletState[];
  effects: EffectState[];
  nextId: number;
};

/** Creates the pellets of one trigger pull and, for anything but the fist, its muzzle flash. */
function fireShots(
  state: ArenaState,
  player: ArenaPlayerState,
  angle: number,
  tick: number,
  random: () => number,
): FireResult {
  // canFire only checks that firing is allowed at all; a multi-pellet weapon
  // (shotgun) can still overflow MAX_BULLETS close to the cap, so trim the
  // surplus pellets here rather than let applyFire exceed the invariant.
  const remainingCapacity = Math.max(0, MAX_BULLETS - state.bullets.length);
  const shots = createShots(
    WEAPONS[player.weapon],
    player.weapon,
    [player.x, player.y],
    angle,
    {
      ownerId: player.id,
      ignoreVehicleId: player.vehicleId,
      firstId: state.nextId,
    },
    random,
  ).slice(0, remainingCapacity);
  const muzzleId = state.nextId + shots.length;
  const effects =
    player.weapon === "fist"
      ? state.effects
      : addEffect(state.effects, {
          id: muzzleId,
          kind: "muzzle",
          x: player.x,
          y: player.y,
          angle,
          bornTick: tick,
        });
  return { shots, effects, nextId: muzzleId + 1 };
}

/** Fires while the trigger is held, the cooldown has passed and there is ammo; drive-bys fire from the car and ignore it. */
export function applyFire(
  state: ArenaState,
  player: ArenaPlayerState,
  input: WorldInput,
  tick: number,
  random: () => number,
): ArenaState {
  if (!canFire(state, player, input, tick)) return state;
  const angle = input.aim ?? player.facing;
  const { shots, effects, nextId } = fireShots(
    state,
    player,
    angle,
    tick,
    random,
  );
  const fired: ArenaState = {
    ...state,
    nextId,
    bullets: [...state.bullets, ...shots],
    effects,
    events: pushEvent(state.events, {
      kind: "shot",
      weapon: player.weapon,
      ownerId: player.id,
      x: player.x,
      y: player.y,
    }),
  };
  return replacePlayer(fired, afterShot(player, tick));
}

/** Adds a hit event for an entity impact. */
function withHitEvent(
  state: ArenaState,
  target: HitTargetKind,
  point: Point,
): ArenaState {
  return {
    ...state,
    events: pushEvent(state.events, {
      kind: "hit",
      target,
      x: point[0],
      y: point[1],
    }),
  };
}

/** Applies one bullet hit to a pedestrian, car or player on foot. */
function applyHit(state: ArenaState, hit: BulletHit, tick: number): ArenaState {
  const entity = applyEntityHit(state, hit, tick);
  if (entity) return entity;
  if (hit.target.kind === "vehicle") {
    const vehicleId = hit.target.vehicleId;
    const vehicles = state.vehicles.map((vehicle) =>
      vehicle.id === vehicleId
        ? damageVehicle(vehicle, hit.bullet.damage)
        : vehicle,
    );
    return withHitEvent({ ...state, vehicles }, "vehicle", hit.point);
  }
  if (hit.target.kind === "player") {
    const struck = playerById(state, hit.target.playerId);
    if (!struck) return state;
    return withHitEvent(
      replacePlayer(state, damagePlayer(struck, hit.bullet.damage, tick)),
      "player",
      hit.point,
    );
  }
  return state;
}

/** Every circle a bullet can hit this tick: the players on foot and living pedestrians. */
function bulletTargets(state: ArenaState): PlayerTarget[] {
  const targets: PlayerTarget[] = [];
  for (const player of orderedPlayers(state))
    if (!isDead(player) && player.vehicleId === null)
      targets.push({ id: player.id, x: player.x, y: player.y });
  for (const ped of alivePeds(state.peds))
    targets.push({ id: ped.id, x: ped.x, y: ped.y });
  for (const cop of aliveCops(state.cops))
    targets.push({ id: cop.id, x: cop.x, y: cop.y });
  return targets;
}

/** Sweeps the bullets, applies their hits and spawns an impact effect per hit. */
export function advanceBullets(
  state: ArenaState,
  dt: number,
  world: ArenaWorld,
  tick: number,
): ArenaState {
  const swept = stepBullets(state.bullets, dt, {
    collision: world.collision,
    vehicles: state.vehicles,
    players: bulletTargets(state),
  });
  let next: ArenaState = { ...state, bullets: swept.bullets };
  for (const hit of swept.hits) {
    const struck = applyHit(next, hit, tick);
    next = {
      ...struck,
      nextId: struck.nextId + 1,
      effects: addEffect(struck.effects, {
        id: struck.nextId,
        kind: "impact",
        x: hit.point[0],
        y: hit.point[1],
        angle: 0,
        bornTick: tick,
      }),
    };
  }
  return next;
}

/** Blast damage to the player: lethal for the occupant, 80 inside the radius on foot. */
function blastPlayer(
  player: ArenaPlayerState,
  vehicle: VehicleState,
  tick: number,
): ArenaPlayerState {
  if (player.vehicleId === vehicle.id)
    return damagePlayer(player, LETHAL_DAMAGE, tick);
  if (player.vehicleId === null && inBlastRadius(vehicle, [player.x, player.y]))
    return damagePlayer(player, EXPLOSION_DAMAGE, tick);
  return player;
}

/** Wrecks one car that reached 0 health and applies its explosion blast. */
function explodeVehicle(
  state: ArenaState,
  vehicle: VehicleState,
  tick: number,
): ArenaState {
  const vehicles = state.vehicles.map((other) => {
    if (other.id === vehicle.id)
      return { ...other, wrecked: true, velocityX: 0, velocityY: 0 };
    return inBlastRadius(vehicle, [other.x, other.y])
      ? damageVehicle(other, EXPLOSION_DAMAGE)
      : other;
  });
  const blast = blastPeds(state.peds, vehicle, tick);
  const copBlast = blastCops(state.cops, vehicle, tick);
  let events = pushEvent(state.events, {
    kind: "explosion",
    x: vehicle.x,
    y: vehicle.y,
  });
  for (const ped of blast.killed)
    events = pushEvent(events, {
      kind: "kill",
      victim: "ped",
      killerId: null,
      x: ped.x,
      y: ped.y,
    });
  for (const cop of copBlast.killed)
    events = pushEvent(events, {
      kind: "kill",
      victim: "cop",
      killerId: null,
      x: cop.x,
      y: cop.y,
    });
  return {
    ...state,
    vehicles,
    peds: blast.peds,
    cops: copBlast.cops,
    nextId: state.nextId + 1,
    players: state.players.map((player) => blastPlayer(player, vehicle, tick)),
    events,
    effects: addEffect(state.effects, {
      id: state.nextId,
      kind: "explosion",
      x: vehicle.x,
      y: vehicle.y,
      angle: 0,
      bornTick: tick,
    }),
  };
}

/** Explodes every car whose health reached 0 this tick and throws its occupant out. */
export function applyExplosions(
  state: ArenaState,
  world: ArenaWorld,
  tick: number,
): ArenaState {
  let next = state;
  for (const vehicle of state.vehicles) {
    if (vehicle.health > 0 || vehicle.wrecked) continue;
    next = explodeVehicle(next, vehicle, tick);
    const driver = driverPlayer(next, vehicle.id);
    if (driver) next = exitVehicle(next, driver, world);
  }
  return next;
}
