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
import type { Rect } from "../mapBuild/geometry";
import type { Obstacle } from "../world/collisionGrid";
import type { Point } from "../world/projection";
import {
  MAX_BULLETS,
  createShots,
  stepBullets,
  type BulletHit,
  type PlayerTarget,
} from "./bullets";
import { applyBlast, CAR_BLAST } from "./blast";
import { BULLET_STRUCTURE_FACTOR, damageStructure } from "./structures";
import { LETHAL_DAMAGE, damagePlayer, damageVehicle, isDead } from "./damage";
import { addEffect } from "./effects";
import { pushEvent } from "./events";
import { applyEntityHit } from "./hits";
import { aliveCops } from "./cops";
import { alivePeds } from "./peds";
import type {
  ArenaPlayerState,
  ArenaState,
  BulletState,
  EffectState,
  HitTargetKind,
  VehicleState,
  WeaponKind,
  WorldInput,
} from "./types";
import {
  EXPLOSIVES,
  WEAPONS,
  consumeAmmo,
  cooldownTicks,
  hasAmmo,
  isMelee,
} from "./weapons";
import { exitVehicle, occupiedVehicle } from "./boarding";
import { drunkDamageFactor } from "./beer";
import { activeBonus, BONUS_BALANCE } from "./landmarkBonuses";
import { firesCannon, lengthOf } from "./vehicle";
import type { ArenaWorld } from "./arenaWorld";

/** What the trigger fires and from where: the tank's cannon from its muzzle at the wheel of a tank, otherwise what the player carries from where they stand. */
type Trigger = { weapon: WeaponKind; origin: Point };

/**
 * The trigger for this tick. A tank's driver fires the cannon, whatever they hold, and the shell
 * leaves the barrel's end so it never starts inside a car parked against the hull.
 */
function triggerOf(
  state: ArenaState,
  player: ArenaPlayerState,
  angle: number,
): Trigger {
  const car = occupiedVehicle(state, player);
  if (!car || car.wrecked || !firesCannon(car.kind))
    return { weapon: player.weapon, origin: [player.x, player.y] };
  const muzzle = lengthOf(car.kind) / 2;
  return {
    weapon: "cannon",
    origin: [
      player.x + Math.cos(angle) * muzzle,
      player.y + Math.sin(angle) * muzzle,
    ],
  };
}

/** Ammo, weapon and cooldown after one trigger pull; an emptied magazine falls back to the pistol, and the cannon costs the tank nothing. */
function afterShot(
  player: ArenaPlayerState,
  weapon: WeaponKind,
  tick: number,
): ArenaPlayerState {
  if (weapon === "cannon")
    return { ...player, nextShotTick: tick + cooldownTicks(weapon) };
  const ammo = consumeAmmo(player.ammo, weapon);
  return {
    ...player,
    ammo,
    weapon: hasAmmo(ammo, weapon) ? weapon : "pistol",
    nextShotTick: tick + cooldownTicks(weapon),
  };
}

/** True when the trigger can fire this tick: alive, cooldown elapsed, ammo left and under the bullet cap. */
function canFire(
  state: ArenaState,
  player: ArenaPlayerState,
  input: WorldInput,
  weapon: WeaponKind,
  tick: number,
): boolean {
  return (
    input.fire &&
    !isDead(player) &&
    tick >= player.nextShotTick &&
    hasAmmo(player.ammo, weapon) &&
    state.bullets.length < MAX_BULLETS
  );
}

/** The pellets, effects list and next free id produced by one trigger pull. */
type FireResult = {
  shots: BulletState[];
  effects: EffectState[];
  nextId: number;
};

/**
 * Creates the pellets of one trigger pull and, for anything but a melee weapon, its muzzle
 * flash. A drunk shooter's pellets carry less damage ({@link drunkDamageFactor}).
 */
function fireShots(
  state: ArenaState,
  player: ArenaPlayerState,
  trigger: Trigger,
  angle: number,
  tick: number,
  random: () => number,
): FireResult {
  // canFire only checks that firing is allowed at all; a multi-pellet weapon
  // (shotgun) can still overflow MAX_BULLETS close to the cap, so trim the
  // surplus pellets here rather than let applyFire exceed the invariant.
  const remainingCapacity = Math.max(0, MAX_BULLETS - state.bullets.length);
  const shots = createShots(
    WEAPONS[trigger.weapon],
    trigger.weapon,
    trigger.origin,
    angle,
    {
      ownerId: player.id,
      ignoreVehicleId: player.vehicleId,
      firstId: state.nextId,
    },
    random,
  )
    .slice(0, remainingCapacity)
    .map((shot) => ({
      ...shot,
      damage:
        shot.damage *
        drunkDamageFactor(player.drunk) *
        (isMelee(trigger.weapon) && activeBonus(player, tick) === "power"
          ? BONUS_BALANCE.meleeFactor
          : 1),
    }));
  const muzzleId = state.nextId + shots.length;
  const effects = isMelee(trigger.weapon)
    ? state.effects
    : addEffect(state.effects, {
        id: muzzleId,
        kind: "muzzle",
        x: trigger.origin[0],
        y: trigger.origin[1],
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
  const angle = input.aim ?? player.facing;
  if (state.vehicles.some((vehicle) => vehicle.boarding?.ownerId === player.id))
    return state;
  const trigger = triggerOf(state, player, angle);
  if (!canFire(state, player, input, trigger.weapon, tick)) return state;
  const { shots, effects, nextId } = fireShots(
    state,
    player,
    trigger,
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
      weapon: trigger.weapon,
      ownerId: player.id,
      x: trigger.origin[0],
      y: trigger.origin[1],
    }),
  };
  const shooter = afterShot(player, trigger.weapon, tick);
  if (activeBonus(player, tick) === "focus")
    shooter.nextShotTick =
      tick +
      Math.max(
        1,
        Math.ceil(
          (shooter.nextShotTick - tick) * BONUS_BALANCE.shotCooldownFactor,
        ),
      );
  return replacePlayer(fired, shooter);
}

/** Adds a hit event for an entity impact. */
function withHitEvent(
  state: ArenaState,
  target: HitTargetKind,
  point: Point,
  ownerId: number,
): ArenaState {
  return {
    ...state,
    events: pushEvent(state.events, {
      kind: "hit",
      target,
      ownerId,
      x: point[0],
      y: point[1],
    }),
  };
}

/** Padding added to a hit-point query rect (every side) so a raycast's float intersection point,
 * which can land a hair outside the obstacle's own bounds, still resolves to it. */
export const STRUCTURE_LOOKUP_PAD_M = 0.01;

/** The building obstacle a hit's structure id names, found by querying the collision view around
 * the impact point, padded by {@link STRUCTURE_LOOKUP_PAD_M} (the raycast that produced the hit
 * already knows it crossed this building's outline, so the id always resolves to an obstacle near
 * `point`, even when floating-point error puts the point a hair outside its bounds). */
export function structureObstacle(
  world: ArenaWorld,
  point: Point,
  structureId: number,
): Obstacle | null {
  const rect: Rect = {
    minX: point[0] - STRUCTURE_LOOKUP_PAD_M,
    minY: point[1] - STRUCTURE_LOOKUP_PAD_M,
    maxX: point[0] + STRUCTURE_LOOKUP_PAD_M,
    maxY: point[1] + STRUCTURE_LOOKUP_PAD_M,
  };
  return (
    world.collision
      .query(rect)
      .find((obstacle) => obstacle.structure?.id === structureId) ?? null
  );
}

/** Bullet damage to the building it hit, unless the weapon is melee or the id cannot be resolved
 * (spec §3.3: a bullet deals a quarter of its damage to the structure). */
function applyBuildingHit(
  state: ArenaState,
  hit: BulletHit,
  world: ArenaWorld,
  tick: number,
): ArenaState {
  const structureId =
    hit.target.kind === "building" ? hit.target.structureId : null;
  if (structureId === null || isMelee(hit.bullet.weapon)) return state;
  const obstacle = structureObstacle(world, hit.point, structureId);
  if (!obstacle) return state;
  return damageStructure(
    state,
    {
      obstacle,
      amount: hit.bullet.damage * BULLET_STRUCTURE_FACTOR,
      killerId: hit.bullet.ownerId,
    },
    tick,
  );
}

/** Applies one bullet hit to a pedestrian, car, player on foot or building. */
function applyHit(
  state: ArenaState,
  hit: BulletHit,
  tick: number,
  world: ArenaWorld,
): ArenaState {
  const entity = applyEntityHit(state, hit, tick);
  if (entity) return entity;
  if (hit.target.kind === "building")
    return applyBuildingHit(state, hit, world, tick);
  if (hit.target.kind === "vehicle") {
    const vehicleId = hit.target.vehicleId;
    const vehicles = state.vehicles.map((vehicle) =>
      vehicle.id === vehicleId
        ? damageVehicle(vehicle, hit.bullet.damage)
        : vehicle,
    );
    return withHitEvent(
      { ...state, vehicles },
      "vehicle",
      hit.point,
      hit.bullet.ownerId,
    );
  }
  if (hit.target.kind === "player") {
    const struck = playerById(state, hit.target.playerId);
    if (!struck) return state;
    const damaged = damagePlayer(struck, hit.bullet.damage, tick);
    const hurt = withHitEvent(
      replacePlayer(state, damaged),
      "player",
      hit.point,
      hit.bullet.ownerId,
    );
    // The shot that finishes a player is the only place the killer is known, so the scoreboard
    // is built from this event rather than from watching health drop to zero.
    if (damaged.diedAtTick !== null && struck.diedAtTick === null)
      return {
        ...hurt,
        events: pushEvent(hurt.events, {
          kind: "kill",
          victim: "player",
          victimId: damaged.id,
          killerId: hit.bullet.ownerId,
          x: damaged.x,
          y: damaged.y,
        }),
      };
    return hurt;
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

/** Detonates `shooter`'s blast at `point` when their weapon is explosive; a direct hit's own
 * damage (bullet or structure) has already been applied by the caller. */
function detonate(
  state: ArenaState,
  weapon: WeaponKind,
  ownerId: number,
  point: Point,
  world: ArenaWorld,
  tick: number,
): ArenaState {
  const spec = EXPLOSIVES[weapon];
  if (!spec) return state;
  return applyBlast(
    state,
    { ...spec, x: point[0], y: point[1], ownerId },
    world,
    tick,
  );
}

/** Sweeps the bullets, applies their hits and spawns an impact effect per hit; an explosive
 * weapon also detonates at every hit and, once it runs out of range, at its end point. A shell
 * that wrecks a car here still gets a second, separate explosion from `applyExplosions` right
 * after (Ruling 17) — the shell bursts, then the car it wrecked blows up too; deliberate, not a
 * double-fire bug. */
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
    const struck = applyHit(next, hit, tick, world);
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
    next = detonate(
      next,
      hit.bullet.weapon,
      hit.bullet.ownerId,
      hit.point,
      world,
      tick,
    );
  }
  for (const bullet of swept.expired)
    next = detonate(
      next,
      bullet.weapon,
      bullet.ownerId,
      [bullet.x, bullet.y],
      world,
      tick,
    );
  return next;
}

/**
 * Kills the occupant of an exploding car outright: unlike every other passenger's car, its own
 * body cannot shield it from its own blast (spec §5). A no-op push if they are already dead or the
 * blast could not touch them (invulnerability, `damagePlayer`'s own guard).
 */
function killOccupant(
  state: ArenaState,
  occupant: ArenaPlayerState,
  tick: number,
): ArenaState {
  const dead = damagePlayer(occupant, LETHAL_DAMAGE, tick);
  const next = replacePlayer(state, dead);
  if (dead.diedAtTick === null || occupant.diedAtTick !== null) return next;
  return {
    ...next,
    events: pushEvent(next.events, {
      kind: "kill",
      victim: "player",
      victimId: dead.id,
      killerId: null,
      x: dead.x,
      y: dead.y,
    }),
  };
}

/** Wrecks one car that reached 0 health, applies its blast (spec §5, shared with an explosive
 * projectile via {@link applyBlast}) and kills its occupant outright. */
function explodeVehicle(
  state: ArenaState,
  vehicle: VehicleState,
  world: ArenaWorld,
  tick: number,
): ArenaState {
  const wrecked: ArenaState = {
    ...state,
    vehicles: state.vehicles.map((other) =>
      other.id === vehicle.id
        ? { ...other, wrecked: true, velocityX: 0, velocityY: 0 }
        : other,
    ),
  };
  const blasted = applyBlast(
    wrecked,
    { ...CAR_BLAST, x: vehicle.x, y: vehicle.y, ownerId: null },
    world,
    tick,
  );
  const occupant = driverPlayer(blasted, vehicle.id);
  return occupant ? killOccupant(blasted, occupant, tick) : blasted;
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
    next = explodeVehicle(next, vehicle, world, tick);
    const driver = driverPlayer(next, vehicle.id);
    if (driver) next = exitVehicle(next, driver, world);
  }
  return next;
}
