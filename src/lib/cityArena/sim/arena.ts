import type { Rect } from "../mapBuild/geometry";
import type { CollisionGrid } from "../world/collisionGrid";
import type { MapIndex, MapZone } from "../world/mapTypes";
import type { Point } from "../world/projection";
import type { RoadGraph } from "../world/roadGraph";
import { findZone, findZoneByKey } from "../world/zone";
import {
  MAX_BULLETS,
  createShots,
  stepBullets,
  type PlayerTarget,
  type BulletHit,
} from "./bullets";
import { driveStep, type DriveStep } from "./driveInput";
import {
  CAR_BODY_RADIUS_M,
  resolveVehicleAgainstPlayer,
  resolveVehiclePairs,
} from "./collisions";
import {
  EXPLOSION_DAMAGE,
  IMPACT_DAMAGE_THRESHOLD_MPS,
  INVULNERABLE_TICKS,
  LETHAL_DAMAGE,
  PLAYER_MAX_HEALTH,
  RESPAWN_DELAY_TICKS,
  damagePlayer,
  damageVehicle,
  impactDamage,
  inBlastRadius,
  isDead,
} from "./damage";
import { addEffect, pruneEffects } from "./effects";
import { pushEvent } from "./events";
import { applyEntityHit } from "./hits";
import { applyPopulation, populateZone } from "./populate";
import { aliveCops, blastCops, manageCops, stepCops } from "./cops";
import { alivePeds, blastPeds, stepPeds } from "./peds";
import { stepPickups } from "./pickups";
import { managePoliceCars, policeChase } from "./police";
import { PLAYER_RADIUS_M, stepPlayer } from "./player";
import {
  chooseRespawnNode,
  chooseSpawnNode,
  nearestZone,
  spawnParkedCars,
  type SpawnGraph,
} from "./spawn";
import { stepDrivers } from "./traffic";
import { applyWanted } from "./wanted";
import { applyZoneRule } from "./zoneRule";
import type {
  ArenaPlayerState,
  ArenaState,
  BulletState,
  EffectState,
  HeldButtons,
  HitTargetKind,
  ArenaEvent,
  VehicleState,
  WorldInput,
} from "./types";
import {
  NO_CONTROLS,
  distanceToVehicle,
  forwardSpeed,
  localToWorld,
  stepVehicle,
  type VehicleControls,
} from "./vehicle";
import {
  SPAWN_AMMO,
  WEAPONS,
  consumeAmmo,
  cooldownTicks,
  hasAmmo,
  nextWeapon,
} from "./weapons";

/** Distance from the car body within which Instappen works (spec §5). */
export const ENTER_RANGE_M = 1.5;
/** Ticks the driver needs to get in before the car answers the controls (spec §5: 0.6 s). */
export const BOARDING_TICKS = 18;
/** The local player's id; Plan 3 assigns real ids. */
export const LOCAL_PLAYER_ID = 0;
/** First id handed to entities (the player is 0). */
const FIRST_ENTITY_ID = 1;
/** Gap between the player and the car body after stepping out (m); keeps the door within ENTER_RANGE_M. */
const EXIT_CLEARANCE_M = 0.2;
/** How far from the car centre a player stands after Uitstappen: just outside the car–player contact circle. */
const EXIT_OFFSET_M = CAR_BODY_RADIUS_M + PLAYER_RADIUS_M + EXIT_CLEARANCE_M;

/** What the arena step reads from the world. */
export type ArenaWorld = {
  collision: Pick<CollisionGrid, "resolveCircle" | "query">;
  index: MapIndex;
  graph: RoadGraph;
  viewRect?: Rect;
};

/** What a session is created from. */
export type ArenaSetup = {
  index: MapIndex;
  graph: SpawnGraph;
  seed: number;
  zone: MapZone | null;
};

/** A player standing at `position` with the spawn loadout, ready to fire from `tick`. */
export function createArenaPlayer(
  position: Point,
  tick: number,
): ArenaPlayerState {
  return {
    id: LOCAL_PLAYER_ID,
    x: position[0],
    y: position[1],
    facing: -Math.PI / 2,
    speed: 0,
    health: PLAYER_MAX_HEALTH,
    weapon: "pistol",
    ammo: SPAWN_AMMO,
    vehicleId: null,
    boardingTicksLeft: 0,
    nextShotTick: tick,
    diedAtTick: null,
    invulnerableUntilTick: tick,
    heat: 0,
    heatTick: tick,
    outsideSinceTick: null,
    driveSteer: 0,
    held: { enter: false, weaponNext: false },
  };
}

/** A fresh session: the player on a spawn node of `zone` (the map origin without one) and parked cars in every zone. */
export function createArenaState(
  setup: ArenaSetup,
  random: () => number,
): ArenaState {
  const spawn: Point = setup.zone
    ? chooseSpawnNode(setup.zone, [], random)
    : [0, 0];
  const vehicles = spawnParkedCars(
    setup.index,
    setup.graph,
    random,
    [spawn],
    FIRST_ENTITY_ID,
  );
  const activeZone = setup.zone ?? nearestZone(setup.index, spawn);
  const base: ArenaState = {
    tick: 0,
    seed: setup.seed,
    nextId: FIRST_ENTITY_ID + vehicles.length,
    player: createArenaPlayer(spawn, 0),
    vehicles,
    bullets: [],
    effects: [],
    zoneKey: findZone(setup.index, spawn)?.key ?? null,
    peds: [],
    cops: [],
    pickups: [],
    traffic: [],
    events: [],
    activeZoneKey: null,
    enforcedZoneKey: null,
    zoneEnforced: false,
  };
  return activeZone
    ? populateZone(base, activeZone, setup.index, setup.graph, random)
    : base;
}

/** Rising edges of `player`'s edge-triggered buttons plus the held state to remember. */
function detectEdges(
  player: ArenaPlayerState,
  input: WorldInput,
): { enterPressed: boolean; weaponPressed: boolean; held: HeldButtons } {
  return {
    enterPressed: input.enter && !player.held.enter,
    weaponPressed: input.weaponNext && !player.held.weaponNext,
    held: { enter: input.enter, weaponNext: input.weaponNext },
  };
}

/** The car the player sits in, if any. */
export function occupiedVehicle(state: ArenaState): VehicleState | null {
  return (
    state.vehicles.find((vehicle) => vehicle.id === state.player.vehicleId) ??
    null
  );
}

/** Instappen: board the nearest intact car whose body is within reach. */
function enterVehicle(state: ArenaState): ArenaState {
  const at: Point = [state.player.x, state.player.y];
  let best: VehicleState | null = null;
  let bestDistance = ENTER_RANGE_M;
  for (const vehicle of state.vehicles) {
    if (vehicle.wrecked) continue;
    const distance = distanceToVehicle(vehicle, at);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = vehicle;
    }
  }
  if (!best) return state;
  const boarded = best.id;
  return {
    ...state,
    traffic: state.traffic.filter((driver) => driver.vehicleId !== boarded),
    player: {
      ...state.player,
      vehicleId: best.id,
      boardingTicksLeft: BOARDING_TICKS,
      x: best.x,
      y: best.y,
      facing: best.heading,
      speed: 0,
      driveSteer: 0,
    },
  };
}

/** Where a player stands after leaving a car: beside the driver's door, pushed out of walls. */
export function exitPosition(
  vehicle: VehicleState,
  collision: Pick<CollisionGrid, "resolveCircle">,
): Point {
  const beside = localToWorld(vehicle, [0, -EXIT_OFFSET_M]);
  return collision.resolveCircle(beside, PLAYER_RADIUS_M);
}

/** Uitstappen (also used when the driver dies): the player steps out beside the car. */
function exitVehicle(state: ArenaState, world: ArenaWorld): ArenaState {
  const vehicle = occupiedVehicle(state);
  const [x, y] = vehicle
    ? exitPosition(vehicle, world.collision)
    : [state.player.x, state.player.y];
  return {
    ...state,
    player: {
      ...state.player,
      vehicleId: null,
      boardingTicksLeft: 0,
      x,
      y,
      facing: vehicle ? vehicle.heading : state.player.facing,
      speed: 0,
      driveSteer: 0,
    },
  };
}

/** Handles the Instappen/Uitstappen edge for a living player. */
function applyEnterExit(
  state: ArenaState,
  pressed: boolean,
  world: ArenaWorld,
): ArenaState {
  if (!pressed || isDead(state.player)) return state;
  return state.player.vehicleId === null
    ? enterVehicle(state)
    : exitVehicle(state, world);
}

/** Handles the Wapen edge. */
function applyWeaponSwitch(state: ArenaState, pressed: boolean): ArenaState {
  if (!pressed || isDead(state.player)) return state;
  const weapon = nextWeapon(state.player.weapon, state.player.ammo);
  return { ...state, player: { ...state.player, weapon } };
}

/** Steps every car (only the occupied one gets controls), then applies building and car–car impact damage. */
function isAsleep(
  vehicle: VehicleState,
  controls: VehicleControls | undefined,
): boolean {
  return (
    controls === undefined && vehicle.velocityX === 0 && vehicle.velocityY === 0
  );
}

function withImpactEvent(
  events: ArenaEvent[],
  vehicleId: number,
  otherVehicleId: number | null,
  impactSpeed: number,
): ArenaEvent[] {
  if (impactSpeed <= IMPACT_DAMAGE_THRESHOLD_MPS) return events;
  return pushEvent(events, {
    kind: "impact",
    vehicleId,
    otherVehicleId,
    impactSpeed,
  });
}

type VehiclesStep = { vehicles: VehicleState[]; events: ArenaEvent[] };

function stepVehicles(
  state: ArenaState,
  playerControls: VehicleControls,
  dt: number,
  world: ArenaWorld,
  aiControls: Map<number, VehicleControls>,
): VehiclesStep {
  let events = state.events;
  const stepped = state.vehicles.map((vehicle) => {
    const controls =
      vehicle.id === state.player.vehicleId
        ? playerControls
        : aiControls.get(vehicle.id);
    if (isAsleep(vehicle, controls)) return vehicle;
    const result = stepVehicle(
      vehicle,
      controls ?? NO_CONTROLS,
      dt,
      world.collision,
    );
    events = withImpactEvent(events, vehicle.id, null, result.impactSpeed);
    return damageVehicle(result.vehicle, impactDamage(result.impactSpeed));
  });
  const pairs = resolveVehiclePairs(stepped);
  const damaged = [...pairs.vehicles];
  for (const impact of pairs.impacts) {
    const amount = impactDamage(impact.impactSpeed);
    damaged[impact.first] = damageVehicle(damaged[impact.first], amount);
    damaged[impact.second] = damageVehicle(damaged[impact.second], amount);
    events = withImpactEvent(
      events,
      damaged[impact.first].id,
      damaged[impact.second].id,
      impact.impactSpeed,
    );
  }
  return { vehicles: damaged, events };
}

/** The driver follows the car while the boarding countdown runs out. */
function ridePlayer(
  player: ArenaPlayerState,
  vehicle: VehicleState,
  driveSteer: number,
): ArenaPlayerState {
  return {
    ...player,
    x: vehicle.x,
    y: vehicle.y,
    facing: vehicle.heading,
    speed: Math.abs(forwardSpeed(vehicle)),
    boardingTicksLeft: Math.max(0, player.boardingTicksLeft - 1),
    driveSteer,
  };
}

/** Walks a living player, then lets every car push (and, when fast, hurt) them. */
function walkPlayer(
  state: ArenaState,
  input: WorldInput,
  dt: number,
  world: ArenaWorld,
  vehicles: VehicleState[],
  tick: number,
): ArenaPlayerState {
  let player = isDead(state.player)
    ? state.player
    : {
        ...state.player,
        ...stepPlayer(state.player, input, dt, world.collision),
      };
  for (const vehicle of vehicles) {
    const contact = resolveVehicleAgainstPlayer(vehicle, player);
    player = damagePlayer(contact.player, contact.damage, tick);
  }
  return player;
}

/** Moves the cars and the player for one tick. */
function moveEntities(
  state: ArenaState,
  input: WorldInput,
  dt: number,
  world: ArenaWorld,
  tick: number,
  random: () => number,
): ArenaState {
  const driving = occupiedVehicle(state);
  const canDrive =
    !isDead(state.player) && state.player.boardingTicksLeft === 0;
  const drive: DriveStep =
    driving && canDrive
      ? driveStep(input, driving.heading, state.player.driveSteer, dt)
      : { controls: NO_CONTROLS, steer: 0 };
  const drivers = stepDrivers(state, world, random, policeChase(state));
  const moved = stepVehicles(
    state,
    drive.controls,
    dt,
    world,
    drivers.controls,
  );
  const next: ArenaState = {
    ...state,
    traffic: drivers.traffic,
    vehicles: moved.vehicles,
    events: moved.events,
  };
  if (driving) {
    const ridden =
      moved.vehicles.find((vehicle) => vehicle.id === driving.id) ?? driving;
    return { ...next, player: ridePlayer(state.player, ridden, drive.steer) };
  }
  return {
    ...next,
    player: walkPlayer(next, input, dt, world, moved.vehicles, tick),
  };
}

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
function canFire(state: ArenaState, input: WorldInput, tick: number): boolean {
  const { player } = state;
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
  angle: number,
  tick: number,
  random: () => number,
): FireResult {
  const { player } = state;
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
function applyFire(
  state: ArenaState,
  input: WorldInput,
  tick: number,
  random: () => number,
): ArenaState {
  if (!canFire(state, input, tick)) return state;
  const angle = input.aim ?? state.player.facing;
  const { shots, effects, nextId } = fireShots(state, angle, tick, random);
  return {
    ...state,
    nextId,
    bullets: [...state.bullets, ...shots],
    effects,
    events: pushEvent(state.events, {
      kind: "shot",
      weapon: state.player.weapon,
      ownerId: state.player.id,
      x: state.player.x,
      y: state.player.y,
    }),
    player: afterShot(state.player, tick),
  };
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
  if (hit.target.kind === "player" && hit.target.playerId === state.player.id)
    return withHitEvent(
      { ...state, player: damagePlayer(state.player, hit.bullet.damage, tick) },
      "player",
      hit.point,
    );
  return state;
}

/** Every circle a bullet can hit this tick: the player on foot and living pedestrians. */
function bulletTargets(state: ArenaState): PlayerTarget[] {
  const { player } = state;
  const targets: PlayerTarget[] =
    !isDead(player) && player.vehicleId === null
      ? [{ id: player.id, x: player.x, y: player.y }]
      : [];
  for (const ped of alivePeds(state.peds))
    targets.push({ id: ped.id, x: ped.x, y: ped.y });
  for (const cop of aliveCops(state.cops))
    targets.push({ id: cop.id, x: cop.x, y: cop.y });
  return targets;
}

/** Sweeps the bullets, applies their hits and spawns an impact effect per hit. */
function advanceBullets(
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
    player: blastPlayer(state.player, vehicle, tick),
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
function applyExplosions(
  state: ArenaState,
  world: ArenaWorld,
  tick: number,
): ArenaState {
  let next = state;
  for (const vehicle of state.vehicles) {
    if (vehicle.health > 0 || vehicle.wrecked) continue;
    next = explodeVehicle(next, vehicle, tick);
    if (next.player.vehicleId === vehicle.id) next = exitVehicle(next, world);
  }
  return next;
}

/** Safety net: a player who died while seated is placed beside the car. */
function ejectIfDead(state: ArenaState, world: ArenaWorld): ArenaState {
  if (!isDead(state.player) || state.player.vehicleId === null) return state;
  return exitVehicle(state, world);
}

/** After 90 ticks: full health and the spawn loadout on a node of the current (else nearest) zone, shielded for 60 ticks. */
function applyRespawn(
  state: ArenaState,
  world: ArenaWorld,
  tick: number,
  random: () => number,
): ArenaState {
  const { player } = state;
  if (
    player.diedAtTick === null ||
    tick < player.diedAtTick + RESPAWN_DELAY_TICKS
  )
    return state;
  const zone =
    (state.zoneKey ? findZoneByKey(world.index, state.zoneKey) : null) ??
    nearestZone(world.index, [player.x, player.y]);
  const intactVehicles: Point[] = state.vehicles
    .filter((vehicle) => !vehicle.wrecked)
    .map((vehicle) => [vehicle.x, vehicle.y]);
  const pickupSpots: Point[] = state.pickups.map((pickup) => [
    pickup.x,
    pickup.y,
  ]);
  const spawn: Point = zone
    ? chooseRespawnNode(zone, [...intactVehicles, ...pickupSpots], random)
    : [player.x, player.y];
  return {
    ...state,
    player: {
      ...createArenaPlayer(spawn, tick),
      invulnerableUntilTick: tick + INVULNERABLE_TICKS,
    },
  };
}

/** One fixed step of the arena: the single simulation entry point. */
export function stepArena(
  state: ArenaState,
  input: WorldInput,
  dt: number,
  world: ArenaWorld,
  random: () => number,
): ArenaState {
  const tick = state.tick + 1;
  const edges = detectEdges(state.player, input);
  let next: ArenaState = {
    ...state,
    tick,
    player: { ...state.player, held: edges.held },
    events: [],
  };
  next = applyPopulation(next, world, tick, random);
  next = applyRespawn(next, world, tick, random);
  next = stepPickups(next, tick);
  next = applyWeaponSwitch(next, edges.weaponPressed);
  next = applyEnterExit(next, edges.enterPressed, world);
  next = moveEntities(next, input, dt, world, tick, random);
  next = applyFire(next, input, tick, random);
  next = stepCops(next, world, dt, tick, random);
  next = stepPeds(next, world, dt, tick, random);
  next = advanceBullets(next, dt, world, tick);
  next = applyExplosions(next, world, tick);
  next = applyZoneRule(next, world.index, tick);
  next = applyWanted(next, tick);
  next = manageCops(next, world, tick, random);
  next = managePoliceCars(next, world, tick, random);
  next = ejectIfDead(next, world);
  const zone = findZone(world.index, [next.player.x, next.player.y]);
  return {
    ...next,
    effects: pruneEffects(next.effects, tick),
    zoneKey: zone?.key ?? null,
  };
}

/** Moves the player instantly (zone picker), leaving any car and in-flight bullets behind. */
export function teleportArenaPlayer(
  state: ArenaState,
  position: Point,
  index: MapIndex,
): ArenaState {
  return {
    ...state,
    player: {
      ...state.player,
      x: position[0],
      y: position[1],
      speed: 0,
      vehicleId: null,
      boardingTicksLeft: 0,
    },
    bullets: [],
    zoneKey: findZone(index, position)?.key ?? null,
  };
}
